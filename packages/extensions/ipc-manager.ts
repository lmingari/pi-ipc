import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Client, Server } from "ipc";

type ClientStatus = "connected" | "disconnected";

type ClientInfo = {
  status: ClientStatus;
  lastSeen: number;
};

type LogToolInput = {
  client: string;
  message: string;
};

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
  const clients = new Map<string, ClientInfo>();

  const updateClientWidget = (ctx: ExtensionContext) => {
    if (!ctx.hasUI || mode !== "server") return;

    const names = [...clients.keys()].sort((a, b) => a.localeCompare(b));
    if (names.length === 0) {
      ctx.ui.setWidget("ipc-clients", ["IPC clients: none"]);
      ctx.ui.setStatus("ipc-clients", "IPC: 0 connected");
      return;
    }

    const lines = ["IPC clients:"];
    let connectedCount = 0;

    for (const name of names) {
      const info = clients.get(name);
      if (!info) continue;
      if (info.status === "connected") {
        connectedCount += 1;
      }
      const statusIcon = info.status === "connected" ? "" : "";
      lines.push(`${statusIcon} ${name} (${info.status})`);
    }

    ctx.ui.setWidget("ipc-clients", lines);
    ctx.ui.setStatus("ipc-clients", `IPC: ${connectedCount} connected`);
  };

  const handleClientLog = (ctx: ExtensionContext, msg: { message?: string }) => {
    if (typeof msg?.message !== "string") return;

    const text = `IPC log from server: ${msg.message}`;

    ctx.ui.notify(text, "info");
    pi.sendMessage({
      customType: "ipc-log",
      content: text,
      display: true,
    });
  };

  const getConfiguredClientName = () => {
    const clientFlag = pi.getFlag("client");
    if (typeof clientFlag !== "string") return null;
    const name = clientFlag.trim();
    return name || null;
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
    client.on("log", (msg) => handleClientLog(ctx, msg as { message?: string }));
    client.onDisconnect(() => {
      client = null;
      ctx.ui.notify("IPC server disconnected", "warning");
      ctx.ui.setStatus("ipc-client", "IPC: disconnected");
    });

    ctx.ui.setStatus("ipc-client", `IPC: connected as ${name}`);
    ctx.ui.notify(`IPC client connected as ${name}`, "success");
    return true;
  };

  pi.registerCommand("ipc-connect", {
    description: "Connect IPC client using --client flag name",
    handler: async (_args, ctx) => {
      const name = getConfiguredClientName();
      if (!name) {
        ctx.ui.setStatus("ipc-client", "IPC: disconnected");
        ctx.ui.notify("IPC: set --client <name> to use /ipc-connect.", "error");
        return;
      }

      await connectClient(ctx, name);
    },
  });

  pi.registerTool({
    name: "ipc_send_log",
    label: "IPC Send Log",
    description: "Send a log message to a connected IPC client",
    promptSnippet: "Send log messages to connected IPC clients",
    promptGuidelines: [
      "Use this tool for todo planning instead of direct file edits when the user asks for a task list."
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
          clients.set(name, { status: "connected", lastSeen: Date.now() });
          updateClientWidget(ctx);
          ctx.ui.notify(`IPC client connected: ${name}`, "info");
        });

        server.onDisconnect((name) => {
          clients.set(name, { status: "disconnected", lastSeen: Date.now() });
          updateClientWidget(ctx);
          ctx.ui.notify(`IPC client disconnected: ${name}`, "warning");
        });
      }

      updateClientWidget(ctx);
      ctx.ui.notify("IPC server started", "success");
      return;
    }

    if (clientFlag !== undefined && !wantsClient) {
      ctx.ui.notify("IPC: --client requires a name (e.g. --client charly).", "error");
      return;
    }

    if (wantsClient) {
      const name = getConfiguredClientName();
      if (!name) {
        ctx.ui.setStatus("ipc-client", "IPC: disconnected");
        ctx.ui.notify("IPC: --client requires a non-empty name.", "error");
        return;
      }

      await connectClient(ctx, name);
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (client) {
      await client.close();
      client = null;
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
