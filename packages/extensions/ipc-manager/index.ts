import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createServerRole } from "./server";
import { createClientRole } from "./client";
import { getFlagString } from "./helpers";
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

  pi.registerFlag("agent", {
    description: "Load subagent config from subagents/<name>.md: --agent <name>.md",
    type: "string",
  });

  type IpcRole = ReturnType<typeof createServerRole> | ReturnType<typeof createClientRole>;
  let activeRole: IpcRole | null = null;
  let resolvedSystemPrompt: string | null = null;

  pi.on("session_start", async (_event, ctx) => {
    const serverName = getFlagString(pi, "server");
    const clientName = getFlagString(pi, "client");
    const agentFile  = getFlagString(pi, "agent");
    
    const wantsServer = !!serverName;
    const wantsClient = !!clientName;
    const wantsAgent  = !!agentFile;

    if (!wantsServer && !wantsClient && !wantsAgent) return;

    if (wantsAgent) {
      const config = await loadAndApplySessionConfig(pi, ctx, agentFile!);
      resolvedSystemPrompt = config?.mdPromptBody || null;
    }

    if (wantsServer && wantsClient) {
      ctx.ui.notify("IPC: both --server and --client set. Pick one.", "error");
      return;
    }

    if (wantsServer) {
      activeRole = createServerRole(pi);
      await activeRole.start(ctx, serverName!);
    } else if (wantsClient) {
      activeRole = createClientRole(pi);
      await activeRole.start(ctx, clientName!);
    }
  });

  pi.on("before_agent_start", async (event) => {
    if (!resolvedSystemPrompt) return;
    return {
      systemPrompt: `${event.systemPrompt}\n\n${resolvedSystemPrompt}`,
    };
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    resolvedSystemPrompt = null;
    if (!activeRole) return;
    await activeRole.shutdown(ctx);
    activeRole = null;
  });
}
