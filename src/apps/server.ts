import { Server } from "../server/Server";

async function main() {
  const server = new Server();

  await server.start();

  server.on("sum", async (msg, clientName) => {
    console.log(`sum from ${clientName}`);

    const result = msg.a + msg.b;

    await server.send(clientName, {
      type: "log",
      message: `Result: ${result}`,
      clientName: "server",
    });
  });
}

main();
