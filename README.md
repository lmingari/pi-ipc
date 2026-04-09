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

## Important limitation

**Asynchronous communication is not supported yet.**

- `ipc_request` is a request/reply flow that waits for a final reply (or timeout).
- There is no async job queue, background callback, or non-blocking "submit now, collect later" protocol in this extension.

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

Delegate a task from server to one client and wait for final reply.

**Mode:** server

**Parameters:**

- `client: string` – target client name
- `task: string` – delegated task text
- `expectedFormat?: string` – optional output format hint
- `timeoutMs?: number` – optional timeout (default: `120000`)

**Returns:** final reply payload (answer/summary/details) or throws on timeout/error.

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
