import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Client } from "ipc";
import type { ClientInfo, ClientPresence } from "./types";

export const updateClientWidget = (
  ctx: ExtensionContext,
  mode: "server" | "client" | null,
  clients: Map<string, ClientInfo>,
) => {
  if (!ctx.hasUI || mode !== "server") return;

  const names = [...clients.keys()].sort((a, b) => a.localeCompare(b));
  if (names.length === 0) {
    ctx.ui.setWidget("ipc-clients", ["IPC clients: none"]);
    ctx.ui.setStatus("ipc-clients", "IPC: 0 connected");
    return;
  }

  const lines = ["IPC clients:"];
  let connectedCount = 0;

  for (const name of names) {
    const info = clients.get(name);
    if (!info) continue;
    if (info.status === "connected") connectedCount += 1;
    const statusIcon = info.status === "connected" ? "" : "";
    const presence = info.status === "connected" ? `, ${info.presence}` : "";
    lines.push(`${statusIcon} ${name} (${info.status}${presence})`);
  }

  ctx.ui.setWidget("ipc-clients", lines);
  ctx.ui.setStatus("ipc-clients", `IPC: ${connectedCount} connected`);
};

export const handleClientLog = (pi: ExtensionAPI, ctx: ExtensionContext, msg: { message?: string }) => {
  if (typeof msg?.message !== "string") return;

  const text = `IPC log from server: ${msg.message}`;

  ctx.ui.notify(text, "info");
  pi.sendMessage({
    customType: "ipc-log",
    content: text,
    display: true,
  });
};

export const getConfiguredClientName = (pi: ExtensionAPI) => {
  const clientFlag = pi.getFlag("client");
  if (typeof clientFlag !== "string") return null;
  const name = clientFlag.trim();
  return name || null;
};

export const sendClientPresence = async (client: Client | null, presence: ClientPresence) => {
  if (!client || !client.isConnected()) return;

  try {
    await client.send({
      type: "status",
      status: presence,
      timestamp: Date.now(),
    });
  } catch {
    // best-effort presence update; disconnect handler will reflect connection state
  }
};

export const setClientStatus = (ctx: ExtensionContext, name: string | null, presence: ClientPresence | null) => {
  if (!name) {
    ctx.ui.setStatus("ipc-client", "IPC: disconnected");
    return;
  }

  const suffix = presence ? ` (${presence})` : "";
  ctx.ui.setStatus("ipc-client", `IPC: connected as ${name}${suffix}`);
};

export const recomputeClientPresence = (
  ctx: ExtensionContext,
  mode: "server" | "client" | null,
  setPresence: (presence: ClientPresence) => void,
) => {
  if (mode !== "client") return;
  const nextPresence: ClientPresence = ctx.isIdle() ? "idle" : "busy";
  setPresence(nextPresence);
};
