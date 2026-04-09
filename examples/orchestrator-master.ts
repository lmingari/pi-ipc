import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Server } from "ipc";
import { Orchestrator } from "ipc-orchestrator";
import { IpcServerTransport } from "ipc-orchestrator/adapters/ipc";

async function main() {
  const targetClient = process.argv[2] ?? "worker-1";

  const server = new Server();
  await server.start();

  console.log(`[master] server started. waiting for '${targetClient}'...`);

  let resolveTargetConnected: (() => void) | null = null;
  const targetConnected = new Promise<void>((resolve) => {
    resolveTargetConnected = resolve;
  });

  server.onConnect((name) => {
    console.log(`[master] client connected: ${name}`);
    if (name === targetClient) {
      resolveTargetConnected?.();
    }
  });

  server.onDisconnect((name) => {
    console.log(`[master] client disconnected: ${name}`);
  });

  const orchestrator = new Orchestrator("master", new IpcServerTransport(server), 30_000);

  orchestrator.onProgress((progress) => {
    console.log(`[master] progress ${progress.requestId} from ${progress.from}: ${progress.payload.message}`);
  });

  try {
    console.log(`[master] waiting for target client '${targetClient}' to connect...`);

    await Promise.race([
      targetConnected,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timed out waiting for client '${targetClient}'`)), 60_000),
      ),
    ]);

    console.log(`[master] target '${targetClient}' connected.`);
    console.log("[master] Type a task and press Enter. Type '/exit' to quit.");

    const rl = createInterface({ input, output });

    while (true) {
      const task = (await rl.question("> ")).trim();
      if (!task) continue;
      if (task === "/exit") {
        rl.close();
        break;
      }

      try {
        console.log(`[master] sending task to ${targetClient}: ${task}`);
        const reply = await orchestrator.sendRequest(
          targetClient,
          {
            task,
            expectedFormat: "plain text",
          },
          30_000,
        );

        console.log(`\n[master] reply received`);
        console.log(`requestId: ${reply.requestId}`);
        console.log(`from: ${reply.from}`);
        console.log(`ok: ${reply.payload.ok}`);
        if (reply.payload.summary) {
          console.log(`summary: ${reply.payload.summary}`);
        }
        console.log(`answer: ${reply.payload.answer}\n`);
      } catch (error) {
        console.error("[master] request failed:", error);
      }
    }
  } finally {
    orchestrator.close();
    await server.stop();
    console.log("[master] shutdown");
  }
}

main().catch((error) => {
  console.error("[master] fatal:", error);
  process.exit(1);
});
