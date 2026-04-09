import { Client } from "ipc";

async function main() {
  const name = process.argv[2];
  if (!name) {
    console.error("Usage: client <name>");
    process.exit(1);
  }

  const client = new Client(name);

  client.onDisconnect(() => {
    console.warn("[client] server disconnected");
  });

  try {
    await client.connect();
  } catch (error) {
    console.error("[client] failed to connect:", error);
    process.exit(1);
  }

  client.on("log", (msg) => {
    console.log("received:", msg);
  });

  try {
    await client.send({
      type: "sum",
      a: 10,
      b: 20,
    });
  } catch (error) {
    console.error("[client] send failed:", error);
  }

  console.log("[client] waiting... press Ctrl+C to exit");
  process.stdin.resume();
}

main().catch((error) => {
  console.error("[client] fatal:", error);
  process.exit(1);
});
