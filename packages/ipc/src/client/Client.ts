import { createTransport } from "../core/createTransport.js";

type Handler = (msg: any) => Promise<void> | void;

type Message = {
  type: string;
  [key: string]: unknown;
};

export class Client {
  private transport = createTransport("client");
  private connected = false;
  private disconnectHandlers: (() => void)[] = [];
  private handlers = new Map<string, Handler>();

  constructor(private name: string) {}

  async connect() {
    if (this.connected) return;

    await this.transport.connect();

    this.transport.onDisconnect(() => {
      this.connected = false;
  
      // notify user handlers
      for (const h of this.disconnectHandlers) {
        h();
      }
    });

    this.transport.onMessage(async (msg) => {
      if (!msg || typeof msg !== "object") return;
      const message = msg as Message;
      if (typeof message.type !== "string") return;

      const handler = this.handlers.get(message.type);
      if (handler) {
        await handler(message);
      }
    });

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

  on(type: string, handler: Handler) {
    this.handlers.set(type, handler);
  }

  onDisconnect(handler: () => void) {
    this.disconnectHandlers.push(handler);
  }

  async close() {
    if (!this.connected) return;

    await this.transport.close();
    this.connected = false;
  }

  isConnected() {
    return this.connected;
  }
}
