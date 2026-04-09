# PI-IPC

IPC package + Pi extension for orchestrating multi-agent sessions over Unix sockets.

## Repo structure

- `packages/ipc` → core IPC library
  - `Server` / `Client`
  - protocol types + guards
  - `Orchestrator` (request/reply/progress)
- `packages/extensions/ipc-manager/` → Pi extension (entrypoint: `index.ts`)
- `examples/` → runnable local examples

---

## Pi extension (important)

This repo uses the folder-based extension layout:

- ✅ extension entrypoint: `packages/extensions/ipc-manager/index.ts`
- ❌ no separate `packages/extensions/ipc-manager.ts` file needed

According to Pi extension conventions, the extension is discovered from `index.ts` in the extension folder.

### Extension behavior

`ipc-manager` supports two modes:

- `--server` → master session (starts IPC server)
- `--client <name>` → child session (connects as named IPC client)

It provides:

- client presence/status UI
- server→client notifications (`ipc_send_log`)
- delegated request/reply workflow:
  - server tool: `ipc_request`
  - client tool: `ipc_send_reply`
  - client commands: `/ipc-reply`, `/ipc-pending`, `/ipc-connect`

---

## Install & build

```bash
npm install
npm run build
```

Build is required after changing `packages/ipc`, because extension code imports the built `ipc` output from `dist/`.

---

## Run examples

### Low-level IPC

```bash
npm run example:server
npm run example:client -- alice
```

### Orchestrator flow

```bash
# terminal 1
npm run example:orchestrator:master -- worker-1

# terminal 2
npm run example:orchestrator:worker -- worker-1
```

In master terminal, type tasks and press Enter.

---

## Notes

- Keep sub-agent contexts isolated by sending scoped tasks and returning only final result envelopes.
- For large outputs, return artifact/file references in replies instead of huge inline text.
- Use request timeouts to avoid indefinite waits.
