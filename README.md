# ipc-manager extension

`ipc-manager` is a Pi extension located at `packages/extensions/ipc-manager/`.

It adds IPC-based coordination between Pi sessions using Unix sockets.

> Dependency note: this extension depends on the `ipc` package in this repo (`packages/ipc`), but this README focuses only on the extension behavior.

## Building

To build the IPC package (required for the extension to work):

1. Ensure you have Node.js 18+ and npm installed.
2. Clone this repository.
3. Run `npm install` in the root directory.
4. Run `npm run build` (or `cd packages/ipc && npm run build`).

> If you modify the IPC package source code, re-run the build step.

This repository uses npm workspaces; running `npm install` in the root directory installs dependencies for both the `ipc` package and the extension.

The extension itself is written in TypeScript and does not need separate compilation; Pi loads it via tsx. The build step compiles the `ipc` dependency, which provides the underlying IPC transport.

You can run the IPC package tests with `npm test` in the `packages/ipc` directory.

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

### Package manifest example (`package.json`)

```json
{
  "pi": {
    "extensions": [
      "packages/extensions/ipc-manager/index.ts",
    ]
  }
}
```

### How to run Pi

**Server or client with explicit agent config (recommended for sharing configs):**

```bash
# Server with explicit agent config
pi \
  -e ./packages/extensions/ipc-manager/index.ts \
  --server master \
  --agent master.md

# Client with shared worker config (multiple clients can use same file)
pi \
  -e ./packages/extensions/ipc-manager/index.ts \
  --client worker1 \
  --agent worker.md

pi \
  -e ./packages/extensions/ipc-manager/index.ts \
  --client worker2 \
  --agent worker.md
```

**Using `--agent` alone (for non-IPC sessions):**

```bash
# Load a config file without starting IPC (e.g., for regular session with tools/role config)
pi \
  -e ./packages/extensions/ipc-manager/index.ts \
  --agent worker.md
```

Just a single server session is allowed (multiple client sessions are possible).

## Flags

Registered flags:

- `--server <name>` (string)
  - Run the session as IPC server (master). Optionally load config from `--agent <file>.md`.
- `--client <name>` (string)
  - Run the session as IPC client with a required non-empty client name. Optionally load config from `--agent <file>.md`.
- `--agent <name>.md` (string)
  - Load subagent config from `.pi/subagents/<name.md>`. This flag can be used:
    - Combined with `--server` or `--client` to apply role-specific configuration
    - Alone (without `--server`/`--client`) to load a config file for a non-IPC session

Rules:

- `--server` and `--client` are mutually exclusive.
- `--server` and `--client` without a valid name are rejected.
- When `--agent` is used with `--server` or `--client`, it specifies the config file instead of the old implicit `.pi/subagents/<name.md>` lookup.
- When `--agent` is used alone (without `--server`/`--client`), only the config is loaded without starting IPC.

### Role config from `.pi/subagents/*.md`

When using `--agent <name.md>` with `--server` or `--client`:

- Loads config from `.pi/subagents/<name.md>` (relative to current directory or parent directories)
- Multiple clients can now share the same config file by using the same `--agent <name.md>`

When `--agent` is NOT specified and using `--server` or `--client`:

- Use default context config file for the subagent

When using `--agent` alone (without `--server`/`--client`):

- Loads the config file without starting IPC (for regular sessions with tools/role configuration)

If found:

- Frontmatter is applied **only when corresponding CLI flags are not set**.
- Markdown body is appended to the system prompt for turns in that role

Supported frontmatter keys:

- `model` (e.g. `openai/gpt-5` or `openai/gpt-5:low`)
- `thinking` (`off|minimal|low|medium|high|xhigh`)
- `tools` (comma/space-separated string or array)
- `no-tools: true` (disables tools)

Example (`.pi/subagents/worker.md`):

```md
---
model: anthropic/claude-sonnet-4
thinking: medium
tools: read,edit,bash
---

You are Worker, focused on backend changes.
Prefer concise updates and include file paths in outputs.
```

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
  - starts server when `--server <name>`
  - connects client when `--client <name>`
- During run:
  - server tracks client connect/disconnect/status events
  - client receives requests and can answer via tool or slash command
- On `session_shutdown`:
  - closes orchestrator/client/server and clears UI state
