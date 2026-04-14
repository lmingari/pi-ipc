import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Client, Orchestrator } from "ipc";
import {
  getFlagString,
  handleClientLog,
  recomputeClientPresence,
  sendClientPresence,
  setClientStatus,
} from "./helpers";
import type { ClientPresence, ReplyToolInput } from "./types";

const PRESENCE_EVENTS = [
  "before_agent_start",
  "agent_start",
  "tool_execution_start",
  "tool_execution_end",
  "turn_end",
  "agent_end",
] as const;

export const createClientRole = (pi: ExtensionAPI) => {
  let client: Client | null = null;
  let orchestrator: Orchestrator | null = null;
  let clientPresence: ClientPresence | null = null;
  let active = false;
  let initialized = false;
  const inboundRequests = new Map<string, { from: string; task: string; receivedAt: number }>();

  const emitClientPresenceIfChanged = (presence: ClientPresence) => {
    if (clientPresence === presence) return;
    clientPresence = presence;
    pi.events.emit("ipc:presence-changed", { status: presence, timestamp: Date.now() });
  };

  const setClientPresence = (ctx: ExtensionContext, presence: ClientPresence) => {
    const name = getFlagString(pi, "client");
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
      pi.sendUserMessage([
          { type: "text", text: `Sub-agent task from '${request.from}` },
          { type: "text", text: `Task: ${request.payload.task}` },
          { type: "text", text: `Request ID: ${request.requestId}` },
      ],  { deliverAs: "followUp" }
      );
//      pi.sendMessage(
//        {
//          customType: "ipc-request",
//          content: [
//            `Sub-agent task from '${request.from}'.`,
//            `requestId: ${request.requestId}`,
//            `Task: ${request.payload.task}`,
//            "Provide the full final answer in this client session.",
//            "Then call tool 'ipc_send_reply' with the same requestId, answer, and summary.",
//            "Keep your own context isolated and only return final scoped result.",
//          ].join("\n"),
//          display: true,
//          details: {
//            requestId: request.requestId,
//            from: request.from,
//            task: request.payload.task,
//            expectedFormat: request.payload.expectedFormat,
//          },
//        },
//        {
//          triggerTurn: true,
//          deliverAs: "followUp",
//        },
//      );
    });

    orchestrator.onProgress((progress) => {
      ctx.ui.notify(
        `IPC progress ${progress.requestId} from ${progress.from}: ${progress.payload.message}`,
        "info",
      );
    });
  };

  const connect = async (ctx: ExtensionContext, rawName: string) => {
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
    recomputeClientPresence(ctx, active ? "client" : null, (presence) => setClientPresence(ctx, presence));

    return true;
  };

  const registerCommandsAndTools = () => {
    pi.registerCommand("ipc-connect", {
      description: "Connect IPC client using --client flag name",
      handler: async (_args, ctx) => {
        const name = getFlagString(pi, "client");
        if (!name) {
          ctx.ui.setStatus("ipc-client", "IPC: disconnected");
          ctx.ui.notify("IPC: set --client <name> to use /ipc-connect.", "error");
          return;
        }

        active = true;
        await connect(ctx, name);
      },
    });

    pi.registerCommand("ipc-reply", {
      description: "Reply manually to a pending IPC request: /ipc-reply <requestId> <answer>",
      handler: async (args, ctx) => {
        if (!active || !orchestrator) {
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
      name: "ipc_send_reply",
      label: "IPC Send Reply",
      description: "Send final response for a pending IPC request",
      promptSnippet: "Reply to a previously received IPC request",
      promptGuidelines: [
        "Use only in client mode after receiving an IPC request.",
        "Use the exact requestId from the received task.",
        "Return only the final scoped result for that task.",
        "Set ok=false and provide error when the task failed.",
        "Keep answer and summary aligned with the final client response.",
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
        if (!active || !orchestrator) {
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
              text: [
                  `Sent IPC reply for ${params.requestId} to ${target}`,
                  `Answer: ${params.answer}`,
              ].join("\n"),
            },
          ],
          details: { ok: true, requestId: params.requestId, to: target },
        };
      },
    });
  };

  const registerPresenceHandlers = () => {
    pi.events.on("ipc:presence-changed", async (event) => {
      if (!active) return;
      const presence = event?.status;
      if (presence !== "idle" && presence !== "busy") return;

      await sendClientPresence(client, presence);
    });

    for (const eventName of PRESENCE_EVENTS) {
      pi.on(eventName, async (_event, ctx) => {
        if (!active) return;

        if (eventName === "agent_end") {
          setClientPresence(ctx, "idle");
          return;
        }

        recomputeClientPresence(ctx, "client", (presence) => setClientPresence(ctx, presence));
      });
    }
  };

  return {
    async start(ctx: ExtensionContext, configuredName: string) {
      if (!initialized) {
        registerCommandsAndTools();
        registerPresenceHandlers();
        initialized = true;
      }

      active = true;
      return connect(ctx, configuredName);
    },

    async shutdown(ctx: ExtensionContext) {
      active = false;
      orchestrator?.close();
      orchestrator = null;
      inboundRequests.clear();

      if (!client) {
        clientPresence = null;
        ctx.ui.setStatus("ipc-client", undefined);
        return;
      }

      await client.close();
      client = null;
      clientPresence = null;
      ctx.ui.setStatus("ipc-client", undefined);
    },
  };
};
