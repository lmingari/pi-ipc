import { createTransport } from "../core/createTransport.js";
import { isMessage } from "../protocol/guards.js";
import type { Message } from "../protocol/types.js";

type Handler = (msg: Message) => Promise<void> | void;

export class Client {
  private transport = createTransport("client");
  private connected = false;
  private closing = false;
  private disconnectHandlers: (() => void)[] = [];
  private handlers = new Map<string, Handler>();

  constructor(private name: string) {}

  async connect() {
    if (this.connected) return;

    await this.transport.connect();
    this.closing = false;

    this.transport.onDisconnect(() => {
      this.connected = false;

      if (this.closing) return;

      // notify user handlers
      for (const h of this.disconnectHandlers) {
        h();
      }
    });

    this.transport.onMessage(async (msg) => {
      if (!isMessage(msg)) return;

      const handler = this.handlers.get(msg.type);
      if (handler) {
        await handler(msg);
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

  on(type: Message["type"], handler: Handler) {
    this.handlers.set(type, handler);
  }

  onDisconnect(handler: () => void) {
    this.disconnectHandlers.push(handler);
  }

  async close() {
    if (!this.connected) return;

    this.closing = true;
    try {
      await this.transport.close();
    } finally {
      this.connected = false;
      this.closing = false;
    }
  }

  isConnected() {
    return this.connected;
  }
}
