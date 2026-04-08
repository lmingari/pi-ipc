import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Server } from "../src/server/Server";

export default function (pi: ExtensionAPI) {
  let server: Server | null = null;

  pi.registerCommand("start-ipc-server", {
    description: "Start IPC server",

    handler: async (_args, ctx) => {
      if (server) {
        ctx.ui.notify("Server already running", "warning");
        return;
      }

      server = new Server();

      await server.start();

      ctx.ui.notify("IPC server started", "success");

      // 🔥 Register handlers
      server.on("sum", async (msg, clientName) => {
        ctx.ui.notify(
          `sum from ${clientName}: ${msg.a} + ${msg.b}`,
          "info"
        );

        const result = msg.a + msg.b;

        await server!.send(clientName, {
          type: "log",
          message: `Result: ${result}`,
          clientName: "server",
        });
      });

      server.on("log", async (msg, clientName) => {
        pi.sendUserMessage(msg.message);
        ctx.ui.notify(
          `[${clientName}] ${msg.message}`,
          "info"
        );
      });
    },
  });

  pi.registerCommand("stop-ipc-server", {
    description: "Stop IPC server",

    handler: async (_args, ctx) => {
      if (!server) {
        ctx.ui.notify("Server not running", "warning");
        return;
      }

      await server.broadcast({
        type: "log",
        message: "Server shutting down",
        clientName: "server",
      });

      await server.stop();
      server = null;

      ctx.ui.notify("IPC server stopped", "info");
    },
  });
}
