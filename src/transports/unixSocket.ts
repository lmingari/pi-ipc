import net from "net";
import fs from "fs";
import { Transport } from "../core/transport";

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

      socket.on("connect", () => {
        this.socket = socket;
        this.attachSocket(socket);
        resolve();
      });

      socket.on("error", reject);
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

  // ✅ CLIENT → SERVER
  async send(data: unknown): Promise<void> {
    if (this.mode !== "client") {
      throw new Error("send() can only be used in client mode");
    }

    const payload = JSON.stringify(data) + "\n";

    await new Promise<void>((resolve, reject) => {
      const ok = this.socket!.write(payload, (err) => {
        if (err) reject(err);
        else resolve();
      });

      if (!ok) {
        this.socket!.once("drain", resolve);
      }
    });
  }

  // ✅ SERVER → ONE CLIENT
  async sendTo(clientId: string, data: unknown): Promise<void> {
    if (this.mode !== "server") {
      throw new Error("sendTo() can only be used in server mode");
    }

    const socket = this.sockets.get(clientId);
    if (!socket) return;

    const payload = JSON.stringify(data) + "\n";

    await new Promise<void>((resolve, reject) => {
      const ok = socket.write(payload, (err) => {
        if (err) reject(err);
        else resolve();
      });

      if (!ok) {
        socket.once("drain", resolve);
      }
    });
  }

  // ✅ SERVER → ALL CLIENTS
  async broadcast(data: unknown): Promise<void> {
    if (this.mode !== "server") {
      throw new Error("broadcast() can only be used in server mode");
    }

    const payload = JSON.stringify(data) + "\n";

    const writes = Array.from(this.sockets.values()).map((socket) => {
      return new Promise<void>((resolve, reject) => {
        const ok = socket.write(payload, (err) => {
          if (err) reject(err);
          else resolve();
        });

        if (!ok) {
          socket.once("drain", resolve);
        }
      });
    });

    await Promise.all(writes);
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
