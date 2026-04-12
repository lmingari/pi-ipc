import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createServerRole } from "./server";
import { createClientRole } from "./client";
import { getConfiguredServerName, getConfiguredClientName } from "./helpers";
import { loadAndApplySessionConfig } from "./sessionConfig";

export { createServerRole } from "./server";
export { createClientRole } from "./client";

export default function (pi: ExtensionAPI) {
  pi.registerFlag("server", {
    description: "Run IPC server (master session) with required name: --server <name>",
    type: "string",
  });

  pi.registerFlag("client", {
    description: "Run IPC client (child session) with required name: --client <name>",
    type: "string",
  });

  let serverRole: ReturnType<typeof createServerRole> | null = null;
  let clientRole: ReturnType<typeof createClientRole> | null = null;
  let activeRole: ReturnType<typeof createServerRole> | ReturnType<typeof createClientRole> | null = null;
  let resolvedSystemPrompt: string | null = null;

  pi.on("session_start", async (_event, ctx) => {
    const serverName = getConfiguredServerName(pi);
    const clientName = getConfiguredClientName(pi);
    const wantsServer = !!serverName;
    const wantsClient = !!clientName;

    if (!wantsServer && !wantsClient) return;

    if (wantsServer && wantsClient) {
      ctx.ui.notify("IPC: both --server and --client set. Pick one.", "error");
      return;
    }

    if (wantsServer) {
      serverRole ??= createServerRole(pi);
      const config = await loadAndApplySessionConfig(pi, ctx, serverName);
      resolvedSystemPrompt = config?.mdPromptBody || null;
      activeRole = serverRole;
      await serverRole.start(ctx, serverName);
      return;
    }

    clientRole ??= createClientRole(pi);
    const config = await loadAndApplySessionConfig(pi, ctx, clientName);
    resolvedSystemPrompt = config?.mdPromptBody || null;
    activeRole = clientRole;
    await clientRole.start(ctx, clientName);
  });

  pi.on("before_agent_start", async (event) => {
    if (!resolvedSystemPrompt) return;
    return {
      systemPrompt: `${event.systemPrompt}\n\n${resolvedSystemPrompt}`,
    };
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (!activeRole) return;
    resolvedSystemPrompt = null;
    await activeRole.shutdown(ctx);
    activeRole = null;
  });
}
