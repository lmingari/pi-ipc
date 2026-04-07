import net from "net";
import fs from "fs";
import { Transport } from "../core/transport";

export class UnixSocketTransport implements Transport {
  private socket?: net.Socket;              // client mode
  private server?: net.Server;              // server mode
  private sockets = new Set<net.Socket>();  // server: all clients

  private messageHandler?: (data: unknown) => void;
  private disconnectHandler?: () => void;

  constructor(
    private path: string,
    private mode: "server" | "client"
  ) {}

  async connect(): Promise<void> {
    if (this.mode === "server") {
      // Clean previous socket file
      if (fs.existsSync(this.path)) {
        fs.unlinkSync(this.path);
      }

      this.server = net.createServer((socket) => {
        this.sockets.add(socket);

        this.attachSocket(socket);

        socket.on("close", () => {
          this.sockets.delete(socket);
          this.disconnectHandler?.();
        });
      });

      return new Promise((resolve) => {
        this.server!.listen(this.path, () => {
          resolve();
        });
      });
    }

    // CLIENT MODE
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

  private attachSocket(socket: net.Socket) {
    let buffer = "";

    socket.on("data", (data) => {
      buffer += data.toString();

      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);

        try {
          const parsed = JSON.parse(raw);
          this.messageHandler?.(parsed);
        } catch {
          console.error("Invalid JSON:", raw);
        }
      }
    });
  }

  async send(data: unknown): Promise<void> {
    const payload = JSON.stringify(data) + "\n";

    // CLIENT → single socket
    if (this.socket) {
      await new Promise<void>((resolve, reject) => {
        const ok = this.socket!.write(payload, (err) => {
          if (err) reject(err);
          else resolve();
        });

        if (!ok) {
          this.socket!.once("drain", resolve);
        }
      });

      return;
    }

    // SERVER → broadcast to all clients
    const writes = Array.from(this.sockets).map((socket) => {
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

  onMessage(cb: (data: unknown) => void): void {
    this.messageHandler = cb;
  }

  onDisconnect(cb: () => void): void {
    this.disconnectHandler = cb;
  }

  async close(): Promise<void> {
    const tasks: Promise<void>[] = [];

    // Close client socket
    if (this.socket) {
      tasks.push(
        new Promise((resolve) => {
          this.socket!.end();
          this.socket!.once("close", resolve);
        })
      );
    }

    // Close all server-side sockets
    for (const socket of this.sockets) {
      tasks.push(
        new Promise((resolve) => {
          socket.end();
          socket.once("close", resolve);
        })
      );
    }

    // Close server listener
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
