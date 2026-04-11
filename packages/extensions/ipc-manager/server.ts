import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Orchestrator, Server } from "ipc";
import { AsyncRequestStore } from "./asyncRequests";
import { updateClientWidget } from "./helpers";
import type {
  ClientInfo,
  LogToolInput,
  RequestListToolInput,
  RequestStatusToolInput,
  RequestToolInput,
} from "./types";

export const createServerRole = (pi: ExtensionAPI) => {
  let server: Server | null = null;
  let orchestrator: Orchestrator | null = null;
  let initialized = false;
  const clients = new Map<string, ClientInfo>();
  const asyncRequests = new AsyncRequestStore();

  const setupServerOrchestrator = (ctx: ExtensionContext) => {
    if (!server) return;

    orchestrator?.close();
    orchestrator = new Orchestrator("master", server);

    orchestrator.onReply((reply) => {
      const tracked = asyncRequests.markCompleted(reply);
      const suffix = tracked ? " (async request completed)" : "";
      ctx.ui.notify(`IPC reply ${reply.requestId} from ${reply.from}${suffix}`, "success");

      if (!tracked) return;

      const summary = reply.payload.summary ? `\nSummary: ${reply.payload.summary}` : "";
      pi.sendMessage(
        {
          customType: "ipc-reply",
          content: [ 
              `Async IPC reply from '${reply.from}'.`,
              `requestId: ${reply.requestId}`,
              `ok: ${reply.payload.ok}`,
              `Answer: ${reply.payload.answer}${summary}`,
          ].join("\n"),
          display: true,
          details: {
            requestId: reply.requestId,
            from: reply.from,
            ok: reply.payload.ok,
            summary: reply.payload.summary,
            answer: reply.payload.answer,
            artifactRefs: reply.payload.artifactRefs ?? [],
          },
        },
        {
          triggerTurn: true,
          deliverAs: "followUp",
        },
      );
    });

    orchestrator.onProgress((progress) => {
      ctx.ui.notify(
        `IPC progress ${progress.requestId} from ${progress.from}: ${progress.payload.message}`,
        "info",
      );
    });
  };

  const getServer = () => {
    if (!server) {
      throw new Error("IPC server is not running.");
    }

    return server;
  };

  const getOrchestrator = () => {
    if (!server || !orchestrator) {
      throw new Error("IPC request is only available when server orchestrator is running.");
    }

    return orchestrator;
  };

  const registerTools = () => {
    pi.registerTool({
      name: "ipc_send_log",
      label: "IPC Send Log",
      description: "Send a log message to a connected IPC client",
      promptSnippet: "Send log messages to connected IPC clients",
      promptGuidelines: [
        "Use only in server mode.",
        "Send short, informational messages to one specific connected client.",
        "Use the exact client name; if ambiguous or missing, ask first.",
        "On failure, report the error clearly and suggest reconnecting the client.",
      ],
      parameters: Type.Object({
        client: Type.String({ description: "Client name" }),
        message: Type.String({ description: "Log message to send" }),
      }),
      async execute(_toolCallId, params: LogToolInput) {
        const runningServer = getServer();

        try {
          await runningServer.send(params.client, {
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
      description: "Send a task request to a client and return immediately with requestId",
      promptSnippet: "Delegate a task to a connected IPC client without waiting for the final result",
      promptGuidelines: [
        "Use only in server mode.",
        "Delegate one clear, scoped task to one connected client.",
        "Store the returned requestId and use ipc_request_status to track completion.",
      ],
      parameters: Type.Object({
        client: Type.String({ description: "Target client name" }),
        task: Type.String({ description: "Delegated task" }),
        expectedFormat: Type.Optional(Type.String({ description: "Expected output format" })),
      }),
      async execute(_toolCallId, params: RequestToolInput) {
        const runningOrchestrator = getOrchestrator();

        const requestId = await runningOrchestrator.sendRequestAsync(params.client, {
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
              text: `Submitted IPC request ${requestId} to ${params.client}`,
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
        "Provide the exact requestId returned by ipc_request.",
        "Use this to poll status/details for a single delegated request.",
      ],
      parameters: Type.Object({
        requestId: Type.String({ description: "Request id returned by ipc_request" }),
      }),
      async execute(_toolCallId, params: RequestStatusToolInput) {
        getServer();

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
        "Use status/client/limit filters to keep output focused.",
        "Prefer this when you need an overview of many tracked requests.",
      ],
      parameters: Type.Object({
        status: Type.Optional(
          Type.Union([Type.Literal("pending"), Type.Literal("completed"), Type.Literal("all")], {
            description: "Filter by request status",
          }),
        ),
        client: Type.Optional(Type.String({ description: "Filter by client name" })),
        limit: Type.Optional(Type.Number({ description: "Max items to return (default 20)" })),
      }),
      async execute(_toolCallId, params: RequestListToolInput) {
        getServer();

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

  };

  return {
    async start(ctx: ExtensionContext) {
      if (!initialized) {
        registerTools();
        initialized = true;
      }

      if (!server) {
        server = new Server();
        await server.start();

        server.onConnect((name) => {
          clients.set(name, { status: "connected", presence: "unknown", lastSeen: Date.now() });
          updateClientWidget(ctx, "server", clients);
          ctx.ui.notify(`IPC client connected: ${name}`, "info");
        });

        server.onDisconnect((name) => {
          const previousPresence = clients.get(name)?.presence ?? "unknown";
          clients.set(name, { status: "disconnected", presence: previousPresence, lastSeen: Date.now() });
          updateClientWidget(ctx, "server", clients);
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

          if (previous?.presence !== presence) {
            ctx.ui.notify(`IPC client ${clientName} is now ${presence}`, "info");
          }

          updateClientWidget(ctx, "server", clients);
        });
      }

      setupServerOrchestrator(ctx);
      updateClientWidget(ctx, "server", clients);
      ctx.ui.notify("IPC server started", "success");
    },

    async shutdown(ctx: ExtensionContext) {
      orchestrator?.close();
      orchestrator = null;
      asyncRequests.clear();

      if (!server) return;

      await server.stop();
      server = null;
      clients.clear();
      ctx.ui.setWidget("ipc-clients", undefined);
      ctx.ui.setStatus("ipc-clients", undefined);
    },
  };
};

export default function ipcServerExtension(pi: ExtensionAPI) {
  pi.registerFlag("server", {
    description: "Run IPC server (master session)",
    type: "boolean",
    default: false,
  });

  const serverRole = createServerRole(pi);

  pi.on("session_start", async (_event, ctx) => {
    const wantsServer = pi.getFlag("server") === true;
    const wantsClient = typeof pi.getFlag("client") === "string";

    if (!wantsServer) return;

    if (wantsClient) {
      ctx.ui.notify("IPC: both --server and --client set. Pick one.", "error");
      return;
    }

    await serverRole.start(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    await serverRole.shutdown(ctx);
  });
}
