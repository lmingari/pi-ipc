import { createTransport } from "../core/createTransport";
import { isMessage } from "../protocol/guards";

async function main() {
  const transport = createTransport("server");

  await transport.connect();
  console.log("Server ready");

  transport.onMessage((raw) => {
    if (!isMessage(raw)) {
      console.log("Invalid message:", raw);
      return;
    }

    console.log(`received message from ${raw.clientName}`);

    switch (raw.type) {
      case "sum":
        console.log("Result:", raw.a + raw.b);
        break;

      case "log":
        console.log("Log:", raw.message);
        break;
    }
  });
}

main();
