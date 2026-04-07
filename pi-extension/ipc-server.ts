import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createServer } from "../src/server/createServer";

export default function (pi: ExtensionAPI) {
  let serverInstance: { close: () => void } | null = null;

  pi.registerCommand("start-ipc-server", {
    description: "Start IPC server and display messages in TUI",

    handler: async (_args, ctx) => {
      if (serverInstance) {
        ctx.ui.notify("Server already running", "warning");
        return;
      }

      ctx.ui.notify("Starting IPC server...", "info");

      serverInstance = await createServer({
        onMessage: (msg) => {
          ctx.ui.notify(
            `Message received from ${msg.clientName}: ${JSON.stringify(msg)}`,
            "info"
          );

          switch (msg.type) {
            case "log":
              pi.sendUserMessage(msg.message);
            break;
          }

        },

        onInvalidMessage: (msg) => {
          ctx.ui.notify(
            `Invalid message: ${JSON.stringify(msg)}`,
            "error"
          );
        },

        onDisconnect: () => {
          ctx.ui.notify("Client disconnected", "warning");
        },
      });

      ctx.ui.notify("IPC server running", "success");
    },
  });

  pi.registerCommand("stop-ipc-server", {
    description: "Stop IPC server",

    handler: async (_args, ctx) => {
      if (!serverInstance) {
        ctx.ui.notify("Server not running", "warning");
        return;
      }

      serverInstance.close();
      serverInstance = null;

      ctx.ui.notify("Server stopped", "info");
    },
  });
}
