import { Server } from "ipc";

async function main() {
  const server = new Server();

  await server.start();

  server.onConnect((name) => {
    console.log(`Client connected: ${name}`);
  });
  
  server.onDisconnect((name) => {
    console.log(`Client disconnected: ${name}`);
  });

  server.on("sum", async (msg, clientName) => {
    console.log(`sum from ${clientName}`);

    const result = msg.a + msg.b;

    await server.send(clientName, {
      type: "log",
      message: `Result: ${result}`,
    });
  });
}

main();
