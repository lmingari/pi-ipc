# ipc

Unix-socket IPC package with:

- low-level `Server` / `Client` messaging
- protocol message types + runtime guards
- built-in `Orchestrator` for request/reply multi-agent flows

This package is ESM (`"type": "module"`).

---

## Install

```bash
npm i ipc
```

---

## Quick start (low-level IPC)

### Server

```ts
import { Server } from "ipc";

const server = new Server();
await server.start();

server.onConnect((name) => {
  console.log("connected:", name);
});

server.onDisconnect((name) => {
  console.log("disconnected:", name);
});

server.on("log", async (msg, clientName) => {
  console.log(`[${clientName}]`, msg.message);

  await server.send(clientName, {
    type: "log",
    message: `ack: ${msg.message}`,
  });
});
```

### Client

```ts
import { Client } from "ipc";

const client = new Client("worker-1");
await client.connect();

client.on("log", (msg) => {
  console.log("server says:", msg.message);
});

client.onDisconnect(() => {
  console.log("server disconnected");
});

await client.send({
  type: "log",
  message: "hello from worker-1",
});
```

---

## Orchestrator (request/reply API)

Use `Orchestrator` when you want correlation by `requestId`, timeout handling, and progress updates.

### Master (server side)

```ts
import { Orchestrator, Server } from "ipc";

const server = new Server();
await server.start();

const master = new Orchestrator("master", server, 30_000);

master.onProgress((progress) => {
  console.log(
    `progress ${progress.requestId} from ${progress.from}:`,
    progress.payload.message,
  );
});

const reply = await master.sendRequest("worker-1", {
  task: "Summarize docs in 3 bullets",
  expectedFormat: "markdown bullets",
});

console.log("final answer:", reply.payload.answer);
```

### Worker (client side)

```ts
import { Client, Orchestrator } from "ipc";

const client = new Client("worker-1");
await client.connect();

const worker = new Orchestrator("worker-1", client);

worker.onRequest(async (request) => {
  await worker.sendProgress(request.from, request.requestId, {
    message: "working...",
    percent: 50,
  });

  const answer = `Done: ${request.payload.task}`;

  await worker.sendReply(request.from, request.requestId, {
    ok: true,
    summary: "Task completed",
    answer,
  });
});
```

---

## Message model

There are two message families:

1. **Operational messages**
   - `register`
   - `log`
   - `status`

2. **Orchestrator envelope messages**
   - `request`
   - `reply`
   - `progress`
   - `cancel`
   - `ack`

Envelope messages include metadata:

- `v` protocol version (currently `1`)
- `requestId` correlation id (required for request/reply/progress)
- `from`, `to`
- `timestamp`
- `payload`

---

## Public API

## Classes

### `Server`

- `start(): Promise<void>`
- `onConnect(handler: (name: string) => void): void`
- `onDisconnect(handler: (name: string) => void): void`
- `on(type: string, handler: (msg: any, clientName: string) => Promise<void> | void): void`
- `send(name: string, msg: unknown): Promise<void>`
- `broadcast(msg: unknown): Promise<void>`
- `stop(): Promise<void>`

### `Client`

- `constructor(name: string)`
- `connect(): Promise<void>`
- `send(msg: unknown): Promise<void>`
- `on(type: string, handler: (msg: any) => Promise<void> | void): void`
- `onDisconnect(handler: () => void): void`
- `close(): Promise<void>`
- `isConnected(): boolean`

### `Orchestrator`

- `constructor(nodeId: string, endpoint: Server | Client, defaultTimeoutMs?: number)`
- `onRequest(handler)`
- `onReply(handler)`
- `onProgress(handler)`
- `sendRequest(target: string, payload: RequestPayload, timeoutMs?: number): Promise<ReplyEnvelope>`
- `sendRequestAsync(target: string, payload: RequestPayload): Promise<string>`
- `sendReply(target: string, requestId: string, payload: ReplyPayload): Promise<void>`
- `sendProgress(target: string, requestId: string, payload: ProgressPayload): Promise<void>`
- `close(): void`

### `TimeoutError`
Thrown by `sendRequest(...)` when no correlated reply is received before timeout.

---

## Types you can import

```ts
import type {
  Message,
  RegisterMessage,
  LogMessage,
  StatusMessage,
  EnvelopeMessage,
  EnvelopeType,
  RequestPayload,
  ReplyPayload,
  ProgressPayload,
  RequestEnvelope,
  ReplyEnvelope,
  ProgressEnvelope,
  OrchestratorEnvelope,
} from "ipc";
```

---

## Runtime guards you can import

```ts
import {
  isMessage,
  isRegisterMessage,
  isLogMessage,
  isStatusMessage,
  isEnvelopeMessage,
  isRequestEnvelope,
  isReplyEnvelope,
  isProgressEnvelope,
} from "ipc";
```

Use guards whenever you process unknown/untrusted input.

---

## Recommended usage pattern for multi-agent systems

- Keep each worker as its own `Client` + `Orchestrator` instance.
- Master sends scoped tasks via `sendRequest(...)`.
- Worker responds with a final reply envelope via `sendReply(...)`.
- Put large outputs in artifacts/files and return references in `artifactRefs`.
- Always set reasonable timeouts.
- Call `orchestrator.close()` during shutdown to reject pending requests cleanly.

---

## Examples in this repo

- `examples/server.ts` / `examples/client.ts` (low-level IPC)
- `examples/orchestrator-master.ts` / `examples/orchestrator-worker.ts` (request/reply orchestration)
