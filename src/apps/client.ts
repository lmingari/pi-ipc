import { createTransport } from "../core/createTransport";
import { Message } from "../protocol/types";

async function main() {
  const clientName = process.argv[2];

  if (!clientName) {
    console.error("Usage: client.ts <clientName>");
    process.exit(1);
  }

  const transport = createTransport("client");

  await transport.connect();

//  const msg: Message = {
//    type: "suma",
//    a: 20,
//    b: 25,
//    clientName,
//  };
  const msg: Message = {type: "log", message: "Hola!", clientName };

  await transport.send(msg);

  await transport.close();
}

main();
