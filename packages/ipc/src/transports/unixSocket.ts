import net from "node:net";
import fs from "node:fs";
import { Transport } from "../core/transport.js";

export class UnixSocketTransport implements Transport {
  private socket?: net.Socket; // client
  private server?: net.Server;

  private sockets = new Map<string, net.Socket>();
  private nextClientId = 1;

  private messageHandler?: (data: unknown, clientId?: string) => void;
  private disconnectHandler?: (clientId?: string) => void;

  constructor(
    private path: string,
    private mode: "server" | "client"
  ) {}

  async connect(): Promise<void> {
    if (this.mode === "server") {
      if (fs.existsSync(this.path)) fs.unlinkSync(this.path);

      this.server = net.createServer((socket) => {
        const clientId = String(this.nextClientId++);
        this.sockets.set(clientId, socket);

        this.attachSocket(socket, clientId);

        socket.on("close", () => {
          this.sockets.delete(clientId);
          this.disconnectHandler?.(clientId);
        });
      });

      return new Promise((resolve) => {
        this.server!.listen(this.path, resolve);
      });
    }

    // client mode
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.path);
      let connected = false;
      let disconnectNotified = false;

      const notifyDisconnect = () => {
        if (disconnectNotified) return;
        disconnectNotified = true;
        this.socket = undefined;
        this.disconnectHandler?.();
      };

      socket.on("connect", () => {
        connected = true;
        this.socket = socket;
        this.attachSocket(socket);
        resolve();
      });

      socket.on("close", () => {
        notifyDisconnect();
      });

      socket.on("end", () => {
        notifyDisconnect();
      });

      socket.on("error", (err) => {
        if (!connected) {
          reject(err);
          return;
        }

        notifyDisconnect();
      });
    });
  }

  private attachSocket(socket: net.Socket, clientId?: string) {
    let buffer = "";

    socket.on("data", (data) => {
      buffer += data.toString();

      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);

        try {
          const parsed = JSON.parse(raw);
          this.messageHandler?.(parsed, clientId);
        } catch {
          console.error("Invalid JSON:", raw);
        }
      }
    });
  }

  async write(data: unknown, clientId?: string): Promise<void> {
    const payload = JSON.stringify(data) + "\n";
  
    // CLIENT MODE
    if (this.mode === "client") {
      if (!this.socket || this.socket.destroyed) throw new Error("Not connected");

      await new Promise<void>((resolve, reject) => {
        const ok = this.socket!.write(payload, (err) => {
          if (err) reject(err);
          else resolve();
        });

        if (!ok) this.socket!.once("drain", resolve);
      });

      return;
    }
  
    // SERVER MODE
    if (!clientId) {
      throw new Error("clientId required in server mode");
    }
  
    const socket = this.sockets.get(clientId);
    if (!socket || socket.destroyed) {
      throw new Error(`IPC client socket unavailable: ${clientId}`);
    }

    await new Promise<void>((resolve, reject) => {
      const ok = socket.write(payload, (err) => {
        if (err) reject(err);
        else resolve();
      });

      if (!ok) socket.once("drain", resolve);
    });
  }

  onMessage(cb: (data: unknown, clientId?: string) => void): void {
    this.messageHandler = cb;
  }

  onDisconnect(cb: (clientId?: string) => void): void {
    this.disconnectHandler = cb;
  }

  async close(): Promise<void> {
    const tasks: Promise<void>[] = [];

    if (this.socket) {
      tasks.push(
        new Promise((resolve) => {
          this.socket!.end();
          this.socket!.once("close", resolve);
        })
      );
    }

    for (const socket of this.sockets.values()) {
      tasks.push(
        new Promise((resolve) => {
          socket.end();
          socket.once("close", resolve);
        })
      );
    }

    if (this.server) {
      tasks.push(
        new Promise((resolve) => {
          this.server!.close(() => resolve());
        })
      );
    }

    await Promise.all(tasks);
  }
}
