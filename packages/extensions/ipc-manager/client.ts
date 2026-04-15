import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Client, Orchestrator } from "ipc";
import {
  handleClientLog,
  sendClientPresence,
} from "./helpers";
import type { ClientPresence, ReplyToolInput } from "./types";

export const createClientRole = (pi: ExtensionAPI) => {
  let clientName: string | null = null;
  let client: Client | null = null;
  let orchestrator: Orchestrator | null = null;
  let clientPresence: ClientPresence | null = null;
  let initialized = false;
  const inboundRequests = new Map<string, { from: string; task: string; receivedAt: number }>();

  const setClientPresence = async (ctx: ExtensionContext, presence: ClientPresence | null) => {
    if (clientPresence === presence) return;
    clientPresence = presence;
    if (!client) {
      ctx.ui.setStatus("ipc-client", "IPC: disconnected");
      return;
    }
    const suffix = presence ? ` (${presence})` : "";
    ctx.ui.setStatus("ipc-client", `IPC: connected as ${clientName}${suffix}`);
    await sendClientPresence(client, presence);
  };

  const setupClientOrchestrator = (ctx: ExtensionContext) => {
    if (!client || !clientName) return;

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
          { type: "text", text: `Request from sub-agent '${request.from}'` },
          { type: "text", text: `requestId: ${request.requestId}` },
          { type: "text", text: `Task: ${request.payload.task}` },
      ],  { deliverAs: "followUp" }
      );
    });

    orchestrator.onProgress((progress) => {
      ctx.ui.notify(
        `IPC progress ${progress.requestId} from ${progress.from}: ${progress.payload.message}`,
        "info",
      );
    });
  };

  const connect = async (ctx: ExtensionContext) => {
    if (!clientName) {
      ctx.ui.notify("IPC: client name is required.", "error");
      return false;
    }

    if (client) {
      await client.close();
      client = null;
    }

    const nextClient = new Client(clientName);

    try {
      await nextClient.connect();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`IPC client failed to connect as ${clientName}: ${reason}`, "error");
      return false;
    }

    client = nextClient;
    client.on("log", (msg) => handleClientLog(pi, ctx, msg as { message?: string }));
    client.onDisconnect(async () => {
      client = null;
      inboundRequests.clear();
      orchestrator?.close();
      orchestrator = null;
      ctx.ui.notify("IPC server disconnected", "warning");
      await setClientPresence(ctx, null);
    });

    setupClientOrchestrator(ctx);
    ctx.ui.notify(`IPC client connected as ${clientName}`, "success");
    await setClientPresence(ctx, ctx.isIdle() ? "idle" : "busy");

    return true;
  };

  const registerCommandsAndTools = () => {
    pi.registerCommand("ipc-connect", {
      description: "Connect IPC client using --client flag name",
      handler: async (_args, ctx) => {
        if (!clientName) {
          ctx.ui.notify("IPC: set --client <name> to use /ipc-connect.", "error");
          return;
        }
        await connect(ctx);
      },
    });

    pi.registerCommand("ipc-reply", {
      description: "Reply manually to a pending IPC request: /ipc-reply <requestId> <answer>",
      handler: async (args, ctx) => {
        if (!client || !orchestrator) {
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
        if (!client || !orchestrator) {
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

    pi.on("agent_start", async (_event, ctx) => {
        if (!client) return;
        await setClientPresence(ctx, "busy");
      });

    pi.on("agent_end", async (_event, ctx) => {
        if (!client) return;
        await setClientPresence(ctx, "idle");
    });
  };

  return {
    async start(ctx: ExtensionContext, configuredName: string) {
      clientName = configuredName;

      if (!initialized) {
        registerCommandsAndTools();
        registerPresenceHandlers();
        initialized = true;
      }

      return connect(ctx);
    },

    async shutdown(ctx: ExtensionContext) {
      orchestrator?.close();
      orchestrator = null;
      inboundRequests.clear();

      if (client) {
          await client.close();
          client = null;
      }
      await setClientPresence(ctx, null);
    },
  };
};
