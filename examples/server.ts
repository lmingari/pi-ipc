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

  server.on("log", async (msg, clientName) => {
    console.log(`log from ${clientName}: ${msg.message}`);

    await server.send(clientName, {
      type: "log",
      message: `Ack: ${msg.message}`,
    });
  });
}

main();
