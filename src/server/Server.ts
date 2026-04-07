import { createTransport } from "../core/createTransport";
import { isMessage } from "../protocol/guards";
import { ClientRegistry } from "./ClientRegistry";

type Handler = (msg: any, clientName: string) => Promise<void> | void;

export class Server {
  private transport = createTransport("server");
  private registry = new ClientRegistry();
  private handlers = new Map<string, Handler>();

  async start() {
    await this.transport.connect();

    this.transport.onMessage(async (raw, clientId) => {
      if (!clientId || !isMessage(raw)) return;

      if (raw.type === "register") {
        this.registry.register(clientId, raw.clientName);
        return;
      }

      const name = this.registry.getName(clientId) || "unknown";

      const handler = this.handlers.get(raw.type);
      if (handler) {
        await handler(raw, name);
      }
    });

    this.transport.onDisconnect((clientId) => {
      if (!clientId) return;
      this.registry.unregister(clientId);
    });
  }

  on(type: string, handler: Handler) {
    this.handlers.set(type, handler);
  }

  async send(name: string, msg: unknown) {
    const id = this.registry.getId(name);
    if (!id) return;
  
    await this.transport.write(msg, id);
  }

  async broadcast(msg: unknown) {
    const ids = this.registry.getAllIds();
  
    await Promise.all(
      ids.map((id) => this.transport.write(msg, id))
    );
  }

  async stop() {
    await this.transport.close();
  }
}
