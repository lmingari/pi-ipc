# ipc-orchestrator

Transport-agnostic orchestration layer for multi-agent request/reply workflows.

This package is intentionally **independent from transport details** (Unix socket IPC, WebSocket, Redis, etc.).
You plug in a transport adapter and get:

- request/reply correlation with `requestId`
- timeout handling
- progress events
- typed envelopes and payloads

## Installation

```bash
npm i ipc-orchestrator
```

## Core concepts

### Envelope
All messages use a versioned envelope:

```ts
type Envelope<TPayload = unknown> = {
  v: 1;
  type: "request" | "reply" | "progress" | "cancel" | "ack" | "status";
  requestId?: string;
  from: string;
  to?: string;
  timestamp: number;
  payload: TPayload;
};
```

### Transport interface

```ts
interface Transport {
  send(target: string | null, message: Envelope): Promise<void>;
  onMessage(handler: (message: Envelope, source?: string) => void | Promise<void>): void;
}
```

The orchestrator only depends on this interface.

## Quick start

```ts
import { Orchestrator } from "ipc-orchestrator";
import { IpcServerTransport } from "ipc-orchestrator/adapters/ipc";

// `server` is an instance from the `ipc` package
const orchestrator = new Orchestrator("master", new IpcServerTransport(server));

// Server side request handler is usually on clients, shown here just for completeness.
orchestrator.onReply((reply) => {
  console.log("got reply", reply.requestId, reply.payload.answer);
});

const reply = await orchestrator.sendRequest("client-a", {
  task: "Summarize docs in 5 bullets",
  expectedFormat: "markdown bullets",
}, 60_000);

console.log(reply.payload.answer);
```

## Client-side handling

```ts
orchestrator.onRequest(async (request) => {
  // run task in local isolated context
  const answer = await runTask(request.payload.task);

  await orchestrator.sendReply(request.from, request.requestId, {
    ok: true,
    summary: answer.slice(0, 120),
    answer,
  });
});
```

## API

### `new Orchestrator(nodeId, transport, defaultTimeoutMs?)`
Creates an orchestrator bound to one node identity.

### `sendRequest(target, payload, timeoutMs?)`
Sends a request and waits for matching reply (`requestId` correlation).
Throws `TimeoutError` on timeout.

### `sendRequestAsync(target, payload)`
Fire-and-forget request, returns `requestId`.

### `sendReply(target, requestId, payload)`
Sends final reply envelope.

### `sendProgress(target, requestId, payload)`
Sends progress updates for an in-flight request.

### Event handlers

- `onRequest(handler)`
- `onReply(handler)`
- `onProgress(handler)`

### `close()`
Rejects all pending requests and clears timers.

## Testing

Run package tests:

```bash
npm -w packages/ipc-orchestrator test
```

## Notes

- This package does **not** know about Pi extension APIs (`pi.sendUserMessage`, UI widgets, tools/commands).
- Keep those in your extension adapter layer.
- For large payloads, prefer artifact references in reply payloads instead of huge inline strings.
