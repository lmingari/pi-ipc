import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Client, Orchestrator, Server } from "ipc";
import {
  getConfiguredClientName,
  handleClientLog,
  recomputeClientPresence,
  sendClientPresence,
  setClientStatus,
  updateClientWidget,
} from "./helpers";
import { AsyncRequestStore } from "./asyncRequests";
import type {
  ClientInfo,
  ClientPresence,
  LogToolInput,
  ReplyToolInput,
  RequestAsyncToolInput,
  RequestListToolInput,
  RequestStatusToolInput,
  RequestToolInput,
  RequestWaitToolInput,
} from "./types";

export default function ipcManagerExtension(pi: ExtensionAPI) {
  pi.registerFlag("server", {
    description: "Run IPC server (master session)",
    type: "boolean",
    default: false,
  });

  pi.registerFlag("client", {
    description: "Run IPC client (child session) with required name: --client <name>",
    type: "string",
  });

  let server: Server | null = null;
  let client: Client | null = null;
  let mode: "server" | "client" | null = null;
  let clientPresence: ClientPresence | null = null;
  let orchestrator: Orchestrator | null = null;
  const clients = new Map<string, ClientInfo>();
  const inboundRequests = new Map<string, { from: string; task: string; receivedAt: number }>();
  const asyncRequests = new AsyncRequestStore();

  const emitClientPresenceIfChanged = (presence: ClientPresence) => {
    if (clientPresence === presence) return;
    clientPresence = presence;
    pi.events.emit("ipc:presence-changed", { status: presence, timestamp: Date.now() });
  };

  const setClientPresence = (ctx: ExtensionContext, presence: ClientPresence) => {
    const name = getConfiguredClientName(pi);
    emitClientPresenceIfChanged(presence);
    setClientStatus(ctx, name, presence);
  };

  const setupClientOrchestrator = (ctx: ExtensionContext, clientName: string) => {
    if (!client) return;

    orchestrator?.close();
    orchestrator = new Orchestrator(clientName, client);

    orchestrator.onRequest((request) => {
      inboundRequests.set(request.requestId, {
        from: request.from,
        task: request.payload.task,
        receivedAt: Date.now(),
      });

      ctx.ui.notify(`IPC request ${request.requestId} from ${request.from}`, "info");
      pi.sendUserMessage(
        [
          `Sub-agent task from '${request.from}'.`,
          `requestId: ${request.requestId}`,
          `Task: ${request.payload.task}`,
          "When finished, call tool 'ipc_send_reply' with the same requestId.",
          "Keep your own context isolated and only return final scoped result.",
        ].join("\n"),
      );
    });

    orchestrator.onProgress((progress) => {
      ctx.ui.notify(
        `IPC progress ${progress.requestId} from ${progress.from}: ${progress.payload.message}`,
        "info",
      );
    });
  };

  const setupServerOrchestrator = (ctx: ExtensionContext) => {
    if (!server) return;

    orchestrator?.close();
    orchestrator = new Orchestrator("master", server);

    orchestrator.onReply((reply) => {
      const tracked = asyncRequests.markCompleted(reply);
      const suffix = tracked ? " (async request completed)" : "";
      ctx.ui.notify(`IPC reply ${reply.requestId} from ${reply.from}${suffix}`, "success");
    });

    orchestrator.onProgress((progress) => {
      ctx.ui.notify(
        `IPC progress ${progress.requestId} from ${progress.from}: ${progress.payload.message}`,
        "info",
      );
    });
  };

  const connectClient = async (ctx: ExtensionContext, rawName: string) => {
    const name = rawName.trim();
    if (!name) {
      ctx.ui.setStatus("ipc-client", "IPC: disconnected");
      ctx.ui.notify("IPC: client name is required.", "error");
      return false;
    }

    if (client) {
      await client.close();
      client = null;
    }

    mode = "client";
    const nextClient = new Client(name);

    try {
      await nextClient.connect();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      ctx.ui.setStatus("ipc-client", "IPC: disconnected");
      ctx.ui.notify(`IPC client failed to connect as ${name}: ${reason}`, "error");
      return false;
    }

    client = nextClient;
    client.on("log", (msg) => handleClientLog(pi, ctx, msg as { message?: string }));
    client.onDisconnect(() => {
      client = null;
      clientPresence = null;
      inboundRequests.clear();
      orchestrator?.close();
      orchestrator = null;
      ctx.ui.notify("IPC server disconnected", "warning");
      ctx.ui.setStatus("ipc-client", "IPC: disconnected");
    });

    setupClientOrchestrator(ctx, name);
    ctx.ui.notify(`IPC client connected as ${name}`, "success");
    recomputeClientPresence(ctx, mode, (presence) => setClientPresence(ctx, presence));

    return true;
  };

  pi.registerCommand("ipc-connect", {
    description: "Connect IPC client using --client flag name",
    handler: async (_args, ctx) => {
      const name = getConfiguredClientName(pi);
      if (!name) {
        ctx.ui.setStatus("ipc-client", "IPC: disconnected");
        ctx.ui.notify("IPC: set --client <name> to use /ipc-connect.", "error");
        return;
      }

      await connectClient(ctx, name);
    },
  });

  pi.registerCommand("ipc-reply", {
    description: "Reply manually to a pending IPC request: /ipc-reply <requestId> <answer>",
    handler: async (args, ctx) => {
      if (mode !== "client" || !orchestrator) {
        ctx.ui.notify("IPC: client orchestrator not ready.", "error");
        return;
      }

      const items = Array.isArray(args) ? args.map(String) : [];
      const requestId = items[0];
      const answer = items.slice(1).join(" ").trim();

      if (!requestId || !answer) {
        ctx.ui.notify("Usage: /ipc-reply <requestId> <answer>", "error");
        return;
      }

      const pending = inboundRequests.get(requestId);
      if (!pending) {
        ctx.ui.notify(`No pending IPC request '${requestId}'.`, "error");
        return;
      }

      await orchestrator.sendReply(pending.from, requestId, {
        ok: true,
        summary: answer.slice(0, 140),
        answer,
      });

      inboundRequests.delete(requestId);
      ctx.ui.notify(`IPC reply sent for ${requestId}`, "success");
    },
  });

  pi.registerCommand("ipc-pending", {
    description: "List pending IPC requests on this client",
    handler: async (_args, ctx) => {
      const ids = [...inboundRequests.keys()];
      if (ids.length === 0) {
        ctx.ui.notify("No pending IPC requests.", "info");
        return;
      }

      for (const id of ids) {
        const req = inboundRequests.get(id);
        if (!req) continue;
        ctx.ui.notify(`Pending ${id} from ${req.from}: ${req.task}`, "info");
      }
    },
  });

  pi.registerTool({
    name: "ipc_send_log",
    label: "IPC Send Log",
    description: "Send a log message to a connected IPC client",
    promptSnippet: "Send log messages to connected IPC clients",
    promptGuidelines: [
      "Use this tool only to send a short message to a specific IPC client.",
      "Only call it when the user explicitly asks to notify/message a client.",
      "Use the exact client name from user/context; if missing, ask first.",
      "If send fails, report client is disconnected/not found and suggest reconnecting.",
    ],
    parameters: Type.Object({
      client: Type.String({ description: "Client name" }),
      message: Type.String({ description: "Log message to send" }),
    }),
    async execute(_toolCallId, params: LogToolInput) {
      if (!server) {
        throw new Error("IPC server is not running.");
      }

      try {
        await server.send(params.client, {
          type: "log",
          message: params.message,
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to send IPC log to '${params.client}': ${reason}`);
      }

      return {
        content: [
          {
            type: "text",
            text: `Sent log to ${params.client}: ${params.message}`,
          },
        ],
        details: { ok: true },
      };
    },
  });

  pi.registerTool({
    name: "ipc_request",
    label: "IPC Request",
    description: "Send a task request to a client and wait for final reply",
    promptSnippet: "Delegate a task to a connected IPC client and wait for final result",
    promptGuidelines: [
      "Use only in server mode.",
      "Set a clear, scoped task.",
      "Use timeout to avoid waiting indefinitely.",
    ],
    parameters: Type.Object({
      client: Type.String({ description: "Target client name" }),
      task: Type.String({ description: "Delegated task" }),
      expectedFormat: Type.Optional(Type.String({ description: "Expected output format" })),
      timeoutMs: Type.Optional(Type.Number({ description: "Timeout in milliseconds" })),
    }),
    async execute(_toolCallId, params: RequestToolInput) {
      if (mode !== "server" || !orchestrator) {
        throw new Error("IPC request is only available when server orchestrator is running.");
      }

      const reply = await orchestrator.sendRequest(
        params.client,
        {
          task: params.task,
          expectedFormat: params.expectedFormat,
        },
        params.timeoutMs ?? 120000,
      );

      const summary = reply.payload.summary ? `\nSummary: ${reply.payload.summary}` : "";
      return {
        content: [
          {
            type: "text",
            text: `Reply from ${reply.from} (${reply.requestId}):\n${reply.payload.answer}${summary}`,
          },
        ],
        details: {
          ok: reply.payload.ok,
          requestId: reply.requestId,
          from: reply.from,
          artifactRefs: reply.payload.artifactRefs ?? [],
        },
      };
    },
  });

  pi.registerTool({
    name: "ipc_request_async",
    label: "IPC Request Async",
    description: "Send a task request to a client and return immediately with requestId",
    promptSnippet: "Delegate a task to a connected IPC client without waiting for the final result",
    promptGuidelines: [
      "Use only in server mode.",
      "Use this when work should continue in the background.",
      "Capture the returned requestId and inspect it later with ipc_request_status or ipc_request_wait.",
    ],
    parameters: Type.Object({
      client: Type.String({ description: "Target client name" }),
      task: Type.String({ description: "Delegated task" }),
      expectedFormat: Type.Optional(Type.String({ description: "Expected output format" })),
    }),
    async execute(_toolCallId, params: RequestAsyncToolInput) {
      if (mode !== "server" || !orchestrator) {
        throw new Error("Async IPC request is only available when server orchestrator is running.");
      }

      const requestId = await orchestrator.sendRequestAsync(params.client, {
        task: params.task,
        expectedFormat: params.expectedFormat,
      });

      const tracked = asyncRequests.trackSubmitted({
        requestId,
        client: params.client,
        task: params.task,
        expectedFormat: params.expectedFormat,
      });

      return {
        content: [
          {
            type: "text",
            text: `Submitted async IPC request ${requestId} to ${params.client}`,
          },
        ],
        details: {
          ok: true,
          requestId,
          status: tracked.status,
          submittedAt: tracked.submittedAt,
          client: tracked.client,
        },
      };
    },
  });

  pi.registerTool({
    name: "ipc_request_status",
    label: "IPC Request Status",
    description: "Get status of a previously submitted async IPC request",
    promptSnippet: "Check whether an async IPC request is pending or completed",
    promptGuidelines: [
      "Use only in server mode.",
      "Provide the exact requestId returned by ipc_request_async.",
      "If completed and full payload is needed, use ipc_request_wait (or inspect details).",
    ],
    parameters: Type.Object({
      requestId: Type.String({ description: "Request id returned by ipc_request_async" }),
    }),
    async execute(_toolCallId, params: RequestStatusToolInput) {
      if (mode !== "server") {
        throw new Error("IPC request status is only available in server mode.");
      }

      const tracked = asyncRequests.get(params.requestId);
      if (!tracked) {
        throw new Error(`Unknown async IPC request '${params.requestId}'.`);
      }

      const text =
        tracked.status === "pending"
          ? `IPC request ${tracked.requestId} is pending (client: ${tracked.client}).`
          : `IPC request ${tracked.requestId} completed by ${tracked.reply?.from ?? tracked.client}.`;

      return {
        content: [
          {
            type: "text",
            text,
          },
        ],
        details: {
          ok: true,
          requestId: tracked.requestId,
          status: tracked.status,
          client: tracked.client,
          submittedAt: tracked.submittedAt,
          completedAt: tracked.completedAt,
          reply: tracked.reply?.payload,
          from: tracked.reply?.from,
        },
      };
    },
  });

  pi.registerTool({
    name: "ipc_request_list",
    label: "IPC Request List",
    description: "List tracked async IPC requests",
    promptSnippet: "List pending/completed async IPC requests on master",
    promptGuidelines: [
      "Use only in server mode.",
      "Use filters to keep output focused.",
    ],
    parameters: Type.Object({
      status: Type.Optional(
        Type.Union([
          Type.Literal("pending"),
          Type.Literal("completed"),
          Type.Literal("all"),
        ], { description: "Filter by request status" }),
      ),
      client: Type.Optional(Type.String({ description: "Filter by client name" })),
      limit: Type.Optional(Type.Number({ description: "Max items to return (default 20)" })),
    }),
    async execute(_toolCallId, params: RequestListToolInput) {
      if (mode !== "server") {
        throw new Error("IPC request list is only available in server mode.");
      }

      const items = asyncRequests.list({
        status: params.status,
        client: params.client,
        limit: params.limit,
      });

      if (items.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No async IPC requests match the provided filters.",
            },
          ],
          details: { ok: true, count: 0, items: [] },
        };
      }

      const lines = items.map((entry) => {
        const done = entry.completedAt ? `, completedAt=${entry.completedAt}` : "";
        return `${entry.requestId} [${entry.status}] client=${entry.client}, submittedAt=${entry.submittedAt}${done}`;
      });

      return {
        content: [
          {
            type: "text",
            text: lines.join("\n"),
          },
        ],
        details: { ok: true, count: items.length, items },
      };
    },
  });

  pi.registerTool({
    name: "ipc_request_wait",
    label: "IPC Request Wait",
    description: "Wait for completion of a tracked async IPC request",
    promptSnippet: "Wait until an async IPC request completes and return its final reply",
    promptGuidelines: [
      "Use only in server mode.",
      "Provide requestId from ipc_request_async.",
      "Use timeoutMs to avoid waiting indefinitely.",
    ],
    parameters: Type.Object({
      requestId: Type.String({ description: "Request id returned by ipc_request_async" }),
      timeoutMs: Type.Optional(Type.Number({ description: "Wait timeout in milliseconds (default 120000)" })),
    }),
    async execute(_toolCallId, params: RequestWaitToolInput) {
      if (mode !== "server") {
        throw new Error("IPC request wait is only available in server mode.");
      }

      const tracked = await asyncRequests.waitFor(params.requestId, params.timeoutMs ?? 120000);
      const reply = tracked.reply;
      if (!reply) {
        throw new Error(`Async IPC request '${params.requestId}' completed without reply payload.`);
      }

      const summary = reply.payload.summary ? `\nSummary: ${reply.payload.summary}` : "";
      return {
        content: [
          {
            type: "text",
            text: `Reply from ${reply.from} (${reply.requestId}):\n${reply.payload.answer}${summary}`,
          },
        ],
        details: {
          ok: reply.payload.ok,
          requestId: reply.requestId,
          from: reply.from,
          artifactRefs: reply.payload.artifactRefs ?? [],
          completedAt: tracked.completedAt,
        },
      };
    },
  });

  pi.registerTool({
    name: "ipc_send_reply",
    label: "IPC Send Reply",
    description: "Send final response for a pending IPC request",
    promptSnippet: "Reply to a previously received IPC request",
    promptGuidelines: [
      "Use only in client mode after receiving an IPC request.",
      "Use the exact requestId.",
      "Keep the answer scoped to requested task.",
    ],
    parameters: Type.Object({
      requestId: Type.String({ description: "Request id to resolve" }),
      answer: Type.String({ description: "Final answer" }),
      summary: Type.Optional(Type.String({ description: "Short summary" })),
      ok: Type.Optional(Type.Boolean({ description: "Whether task succeeded" })),
      error: Type.Optional(Type.String({ description: "Error message when failed" })),
      to: Type.Optional(Type.String({ description: "Override target node id" })),
    }),
    async execute(_toolCallId, params: ReplyToolInput) {
      if (mode !== "client" || !orchestrator) {
        throw new Error("IPC reply is only available when client orchestrator is running.");
      }

      const pending = inboundRequests.get(params.requestId);
      const target = params.to ?? pending?.from;
      if (!target) {
        throw new Error(`Cannot resolve target for request '${params.requestId}'.`);
      }

      await orchestrator.sendReply(target, params.requestId, {
        ok: params.ok ?? true,
        summary: params.summary,
        answer: params.answer,
        error: params.error,
      });

      inboundRequests.delete(params.requestId);

      return {
        content: [
          {
            type: "text",
            text: `Sent IPC reply for ${params.requestId} to ${target}`,
          },
        ],
        details: { ok: true, requestId: params.requestId, to: target },
      };
    },
  });

  pi.events.on("ipc:presence-changed", async (event) => {
    if (mode !== "client") return;
    const presence = event?.status;
    if (presence !== "idle" && presence !== "busy") return;

    await sendClientPresence(client, presence);
  });

  pi.on("session_start", async (_event, ctx) => {
    const wantsServer = pi.getFlag("server") === true;
    const clientFlag = pi.getFlag("client");
    const wantsClient = typeof clientFlag === "string";

    if (wantsServer && wantsClient) {
      ctx.ui.notify("IPC: both --server and --client set. Pick one.", "error");
      return;
    }

    if (wantsServer) {
      mode = "server";

      if (!server) {
        server = new Server();
        await server.start();

        server.onConnect((name) => {
          clients.set(name, { status: "connected", presence: "unknown", lastSeen: Date.now() });
          updateClientWidget(ctx, mode, clients);
          ctx.ui.notify(`IPC client connected: ${name}`, "info");
        });

        server.onDisconnect((name) => {
          const previousPresence = clients.get(name)?.presence ?? "unknown";
          clients.set(name, { status: "disconnected", presence: previousPresence, lastSeen: Date.now() });
          updateClientWidget(ctx, mode, clients);
          ctx.ui.notify(`IPC client disconnected: ${name}`, "warning");
        });

        server.on("status", (msg, clientName) => {
          const presence = msg?.status;
          if (presence !== "idle" && presence !== "busy") return;

          const previous = clients.get(clientName);
          clients.set(clientName, {
            status: "connected",
            presence,
            lastSeen: Date.now(),
          });

          if (mode === "server" && previous?.presence !== presence) {
            ctx.ui.notify(`IPC client ${clientName} is now ${presence}`, "info");
          }

          updateClientWidget(ctx, mode, clients);
        });
      }

      setupServerOrchestrator(ctx);
      updateClientWidget(ctx, mode, clients);
      ctx.ui.notify("IPC server started", "success");
      return;
    }

    if (clientFlag !== undefined && !wantsClient) {
      ctx.ui.notify("IPC: --client requires a name (e.g. --client charly).", "error");
      return;
    }

    if (wantsClient) {
      const name = getConfiguredClientName(pi);
      if (!name) {
        ctx.ui.setStatus("ipc-client", "IPC: disconnected");
        ctx.ui.notify("IPC: --client requires a non-empty name.", "error");
        return;
      }

      await connectClient(ctx, name);
    }
  });

  const presenceEvents = [
    "before_agent_start",
    "agent_start",
    "tool_execution_start",
    "tool_execution_end",
    "turn_end",
    "agent_end",
  ] as const;

  for (const eventName of presenceEvents) {
    pi.on(eventName, async (_event, ctx) => {
      if (eventName === "agent_end") {
        setClientPresence(ctx, "idle");
        return;
      }
      recomputeClientPresence(ctx, mode, (presence) => setClientPresence(ctx, presence));
    });
  }

  pi.on("session_shutdown", async (_event, ctx) => {
    orchestrator?.close();
    orchestrator = null;
    inboundRequests.clear();
    asyncRequests.clear();

    if (client) {
      await client.close();
      client = null;
      clientPresence = null;
      ctx.ui.setStatus("ipc-client", undefined);
    }

    if (server) {
      await server.stop();
      server = null;
      clients.clear();
      ctx.ui.setWidget("ipc-clients", undefined);
      ctx.ui.setStatus("ipc-clients", undefined);
    }
  });
}
