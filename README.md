# ipc-manager extension

`ipc-manager` is a Pi extension located at `packages/extensions/ipc-manager/`.

It adds IPC-based coordination between Pi sessions using Unix sockets.

> Dependency note: this extension depends on the `ipc` package in this repo (`packages/ipc`), but this README focuses only on the extension behavior.

## What this extension does

`ipc-manager` supports two runtime modes:

- **Server mode (master session)**: manages connected clients and delegates tasks.
- **Client mode (child/sub-agent session)**: connects with a client name and receives delegated tasks.

Communication is centered around:

- server -> client notifications (`ipc_send_log`)
- server -> client task delegation (`ipc_request`)
- client -> server final response (`ipc_send_reply`)
- server-side request tracking (`ipc_request_status`, `ipc_request_list`)

## Async behavior

The extension uses async request flow:

- `ipc_request` is non-blocking and returns a `requestId` immediately.
- Requests are tracked on server and can be inspected later.
- On completion, server pushes a notification via UI and `pi.sendMessage(..., { triggerTurn: true, deliverAs: "followUp" })`.

## Extension entrypoints

The package uses role-stacked loading:

- `packages/extensions/ipc-manager/server.ts`
- `packages/extensions/ipc-manager/client.ts`

When Pi runs without `--server` or `--client`, the extension remains passive (no IPC tools/commands are registered for the session).

### Package manifest example (`package.json`)

```json
{
  "pi": {
    "extensions": [
      "packages/extensions/ipc-manager/server.ts",
      "packages/extensions/ipc-manager/client.ts"
    ]
  }
}
```

### How to run Pi

Stacked entrypoints:

```bash
pi \
  -e ./packages/extensions/ipc-manager/server.ts \
  -e ./packages/extensions/ipc-manager/client.ts \
  --server

pi \
  -e ./packages/extensions/ipc-manager/server.ts \
  -e ./packages/extensions/ipc-manager/client.ts \
  --client carlos
```

No IPC mode (standard Pi session unchanged):

```bash
pi \
  -e ./packages/extensions/ipc-manager/server.ts \
  -e ./packages/extensions/ipc-manager/client.ts
```

## Flags

Registered flags:

- `--server` (boolean, default `false`)
  - Run the session as IPC server (master).
- `--client <name>` (string)
  - Run the session as IPC client with a required non-empty client name.

Rules:

- `--server` and `--client` are mutually exclusive.
- `--client` without a valid name is rejected.

## Slash commands

### `/ipc-connect`

Connects the current session as a client using `--client <name>`.

- Requires `--client` flag to be set.
- Useful to retry connection manually.

### `/ipc-reply <requestId> <answer>`

Manual reply to a pending IPC request on a client session.

- Client mode only.
- Requires an existing pending `requestId`.

### `/ipc-pending`

Lists pending request IDs received by this client and not yet replied.

## Tools

## `ipc_send_log`

Send a short log/notification from server to a specific client.

**Mode:** server

**Parameters:**

- `client: string` – target client name
- `message: string` – log message

## `ipc_request`

Delegate a task from server to one client and return immediately with a `requestId`.

**Mode:** server

**Parameters:**

- `client: string` – target client name
- `task: string` – delegated task text
- `expectedFormat?: string` – optional output format hint

**Returns:** accepted request metadata including `requestId` and initial `pending` status.

## `ipc_request_status`

Check a tracked async request by `requestId`.

**Mode:** server

**Parameters:**

- `requestId: string` – id returned by `ipc_request`

**Returns:** request status (`pending` or `completed`) and, when completed, reply details.

## `ipc_request_list`

List tracked async requests on server.

**Mode:** server

**Parameters:**

- `status?: "pending" | "completed" | "all"` – optional status filter
- `client?: string` – optional client filter
- `limit?: number` – max number of returned entries (default `20`)

## `ipc_send_reply`

Send a final reply for a pending request from client back to server.

**Mode:** client

**Parameters:**

- `requestId: string` – request to resolve
- `answer: string` – final answer
- `summary?: string` – short summary
- `ok?: boolean` – success flag (default `true`)
- `error?: string` – optional error text
- `to?: string` – optional explicit target override

## Presence and UI behavior

- Client presence is tracked as `idle` or `busy` and reported to server.
- Server UI widget shows known clients and connection/presence state.
- Client UI status shows connection state and current presence.

## Session lifecycle summary

- On `session_start`:
  - starts server when `--server`
  - connects client when `--client <name>`
- During run:
  - server tracks client connect/disconnect/status events
  - client receives requests and can answer via tool or slash command
- On `session_shutdown`:
  - closes orchestrator/client/server and clears UI state
