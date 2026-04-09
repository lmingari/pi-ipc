import { Client } from "ipc";
import { Orchestrator } from "ipc-orchestrator";
import { IpcClientTransport } from "ipc-orchestrator/adapters/ipc";

async function main() {
  const workerName = process.argv[2] ?? "worker-1";

  const client = new Client(workerName);

  client.onDisconnect(() => {
    console.warn("[worker] server disconnected");
    process.exit(0);
  });

  await client.connect();
  console.log(`[worker] connected as ${workerName}`);

  const orchestrator = new Orchestrator(workerName, new IpcClientTransport(client), 30_000);

  orchestrator.onRequest(async (request) => {
    console.log(`[worker] request ${request.requestId} from ${request.from}: ${request.payload.task}`);

    await orchestrator.sendProgress(request.from, request.requestId, {
      message: "working...",
      percent: 25,
    });

    // Simulate local work.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const answer = `Worker '${workerName}' completed task: ${request.payload.task}`;

    await orchestrator.sendReply(request.from, request.requestId, {
      ok: true,
      summary: "Task completed",
      answer,
    });

    console.log(`[worker] replied to ${request.requestId}`);
  });

  console.log("[worker] waiting for requests... (Ctrl+C to exit)");
  process.stdin.resume();
}

main().catch((error) => {
  console.error("[worker] fatal:", error);
  process.exit(1);
});
