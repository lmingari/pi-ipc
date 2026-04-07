import { createTransport } from "../core/createTransport";

export class Client {
  private transport = createTransport("client");
  private connected = false;

  constructor(private name: string) {}

  async connect() {
    if (this.connected) return;

    await this.transport.connect();

    // 🔥 Register immediately after connection
    await this.transport.write({
      type: "register",
      clientName: this.name,
    });

    this.connected = true;
  }

  async send(msg: unknown) {
    if (!this.connected) {
      throw new Error("Client not connected");
    }

    await this.transport.write(msg);
  }

  onMessage(handler: (msg: unknown) => void) {
    this.transport.onMessage((msg) => {
      handler(msg);
    });
  }

  onDisconnect(handler: () => void) {
    this.transport.onDisconnect(() => {
      this.connected = false;
      handler();
    });
  }

  async close() {
    if (!this.connected) return;

    await this.transport.close();
    this.connected = false;
  }
}
