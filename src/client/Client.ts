import { createTransport } from "../core/createTransport";

export class Client {
  private transport = createTransport("client");

  constructor(private name: string) {}

  async connect() {
    await this.transport.connect();

    // auto-register
    await this.transport.send({
      type: "register",
      clientName: this.name,
    });
  }

  async send(msg: unknown) {
    await this.transport.send(msg);
  }

  onMessage(handler: (msg: unknown) => void) {
    this.transport.onMessage(handler);
  }

  async close() {
    await this.transport.close();
  }
}
