# pi-ipc

Unix socket IPC with a simple `Server` and `Client` API.

## Install

```bash
npm i pi-ipc
```

## Usage

```ts
import { Server, Client } from "pi-ipc";

// Server
const server = new Server();
await server.start();

server.onConnect((name) => console.log("connected", name));
server.onDisconnect((name) => console.log("disconnected", name));
server.on("sum", async (msg, clientName) => {
  await server.send(clientName, { type: "log", message: msg.a + msg.b });
});

// Client
const client = new Client("alice");
await client.connect();

client.on("log", (msg) => console.log("message", msg));
client.onDisconnect(() => console.log("server down"));

await client.send({ type: "sum", a: 1, b: 2 });
```

## API

### Server
- `start(): Promise<void>`
- `onConnect(handler: (name: string) => void): void`
- `onDisconnect(handler: (name: string) => void): void`
- `on(type: string, handler: (msg: any, clientName: string) => Promise<void> | void): void`
- `send(name: string, msg: unknown): Promise<void>`
- `broadcast(msg: unknown): Promise<void>`
- `stop(): Promise<void>`

### Client
- `connect(): Promise<void>`
- `send(msg: unknown): Promise<void>`
- `on(type: string, handler: (msg: any) => Promise<void> | void): void`
- `onDisconnect(handler: () => void): void`
- `close(): Promise<void>`
