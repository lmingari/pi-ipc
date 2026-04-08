import { createTransport } from "../core/createTransport.js";
import { isMessage } from "../protocol/guards.js";
import { ClientRegistry } from "./ClientRegistry.js";

type Handler = (msg: any, clientName: string) => Promise<void> | void;

export class Server {
  private transport = createTransport("server");
  private registry = new ClientRegistry();
  private handlers = new Map<string, Handler>();
  private onConnectHandlers: ((name: string) => void)[] = [];
  private onDisconnectHandlers: ((name: string) => void)[] = [];

  async start() {
    await this.transport.connect();

    this.transport.onMessage(async (raw, clientId) => {
      if (!clientId || !isMessage(raw)) return;

      // New client connection
      if (raw.type === "register") {
        this.registry.register(clientId, raw.clientName);

        for (const handler of this.onConnectHandlers) {
          handler(raw.clientName);
        }

        return;
      }

      const name = this.registry.getName(clientId) || "unknown";

      const handler = this.handlers.get(raw.type);
      if (handler) {
        await handler(raw, name);
      }
    });

    // Client disconnects
    this.transport.onDisconnect((clientId) => {
      if (!clientId) return;
    
      const name = this.registry.getName(clientId);
    
      this.registry.unregister(clientId);
    
      if (name) {
        for (const handler of this.onDisconnectHandlers) {
          handler(name);
        }
      }
    });
  }

  onConnect(handler: (name: string) => void) {
    this.onConnectHandlers.push(handler);
  }
  
  onDisconnect(handler: (name: string) => void) {
    this.onDisconnectHandlers.push(handler);
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
