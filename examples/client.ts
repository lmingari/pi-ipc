import { Client } from "ipc";

async function main() {
  const name = process.argv[2];
  if (!name) {
    console.error("Usage: client <name>");
    process.exit(1);
  }

  const client = new Client(name);

  await client.connect();

  client.onMessage((msg) => {
    console.log("received:", msg);
  });

//  await client.send({
//    type: "log",
//    message: "hola",
//  });

  await client.send({
    type: "sum",
    a: 10,
    b: 20,
  });
}

main();
