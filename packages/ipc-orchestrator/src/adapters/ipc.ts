import type { Client, Server } from "ipc";
import type { Envelope, EnvelopeType } from "../types.js";
import type { MessageHandler, Transport } from "../transport.js";

const MESSAGE_TYPES: EnvelopeType[] = ["request", "reply", "progress", "cancel", "ack", "status"];

export class IpcServerTransport implements Transport {
  private readonly handlers = new Set<MessageHandler>();

  constructor(private readonly server: Server) {
    for (const type of MESSAGE_TYPES) {
      this.server.on(type, async (msg, clientName) => {
        for (const handler of this.handlers) {
          await handler(msg as Envelope, clientName);
        }
      });
    }
  }

  async send(target: string | null, message: Envelope) {
    if (!target) {
      throw new Error("IpcServerTransport requires a target client name");
    }
    await this.server.send(target, message);
  }

  onMessage(handler: MessageHandler) {
    this.handlers.add(handler);
  }
}

export class IpcClientTransport implements Transport {
  private readonly handlers = new Set<MessageHandler>();

  constructor(private readonly client: Client) {
    for (const type of MESSAGE_TYPES) {
      (this.client as unknown as { on: (name: string, cb: (msg: unknown) => Promise<void>) => void }).on(
        type,
        async (msg) => {
          for (const handler of this.handlers) {
            await handler(msg as Envelope);
          }
        },
      );
    }
  }

  async send(_target: string | null, message: Envelope) {
    await this.client.send(message);
  }

  onMessage(handler: MessageHandler) {
    this.handlers.add(handler);
  }
}
