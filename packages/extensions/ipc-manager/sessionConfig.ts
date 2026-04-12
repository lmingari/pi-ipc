import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { parseFrontmatter } from "@mariozechner/pi-coding-agent";

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"] as const);
type ThinkingLevel = (typeof THINKING_LEVELS extends Set<infer U> ? U : never) & string;

type ModelHint = {
  provider?: string;
  id: string;
  thinking?: ThinkingLevel;
};

type MdConfig = {
  filePath: string;
  frontmatter: Record<string, unknown>;
  body: string;
};

function parseThinkingCandidate(value: unknown): ThinkingLevel | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return THINKING_LEVELS.has(normalized as ThinkingLevel) ? (normalized as ThinkingLevel) : undefined;
}

function parseModelValue(raw: string): ModelHint | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let thinking: ThinkingLevel | undefined;
  let modelPart = trimmed;
  const colonIndex = trimmed.lastIndexOf(":");
  if (colonIndex > 0) {
    const candidate = trimmed.slice(colonIndex + 1).trim().toLowerCase();
    if (THINKING_LEVELS.has(candidate as ThinkingLevel)) {
      thinking = candidate as ThinkingLevel;
      modelPart = trimmed.slice(0, colonIndex).trim();
    }
  }

  if (!modelPart) return null;
  const slashIndex = modelPart.indexOf("/");
  const provider = slashIndex >= 0 ? modelPart.slice(0, slashIndex).trim() || undefined : undefined;
  const id = slashIndex >= 0 ? modelPart.slice(slashIndex + 1).trim() : modelPart;
  if (!id) return null;
  return { provider, id, thinking };
}

function resolveModel(ctx: ExtensionContext, hint: ModelHint) {
  if (hint.provider) return ctx.modelRegistry.find(hint.provider, hint.id);

  const available = ctx.modelRegistry.getAvailable().find((model) => model.id === hint.id);
  if (available) return available;
  return ctx.modelRegistry.getAll().find((model) => model.id === hint.id);
}

function parseTools(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const tokens = value.map((item) => String(item ?? "").trim()).filter(Boolean);
    return tokens.length > 0 ? [...new Set(tokens)] : undefined;
  }

  if (typeof value === "string") {
    const tokens = value.split(/[\s,]+/).map((token) => token.trim()).filter(Boolean);
    return tokens.length > 0 ? [...new Set(tokens)] : undefined;
  }

  return undefined;
}

function hasModelFlag(pi: ExtensionAPI): boolean {
  return pi.getFlag("model") !== undefined;
}

function hasToolsFlag(pi: ExtensionAPI): boolean {
  return pi.getFlag("tools") !== undefined || pi.getFlag("no-tools") === true;
}

function hasThinkingFlag(pi: ExtensionAPI): boolean {
  return pi.getFlag("thinking") !== undefined;
}

function findConfigFile(startDir: string, agentName: string): string | null {
  let currentDir = startDir;
  const fileName = `${agentName}.md`;

  while (true) {
    const candidate = path.join(currentDir, "subagents", fileName);
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // ignore and continue walking up
    }

    const parent = path.dirname(currentDir);
    if (parent === currentDir) return null;
    currentDir = parent;
  }
}

function loadMarkdownConfig(cwd: string, agentName: string): MdConfig | null {
  const filePath = findConfigFile(cwd, agentName);
  if (!filePath) return null;

  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(content);
  return {
    filePath,
    frontmatter: frontmatter ?? {},
    body: body ?? "",
  };
}

async function applyModelFromSpec(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  spec: string,
  thinkingOverride?: ThinkingLevel,
): Promise<{ modelApplied: boolean; thinkingApplied: boolean }> {
  if (hasModelFlag(pi)) return { modelApplied: false, thinkingApplied: false };

  const parsed = parseModelValue(spec);
  if (!parsed) return { modelApplied: false, thinkingApplied: false };

  const model = resolveModel(ctx, parsed);
  if (!model) {
    if (ctx.hasUI) ctx.ui.notify(`IPC: frontmatter model not found: ${spec}`, "warning");
    return { modelApplied: false, thinkingApplied: false };
  }

  let modelApplied = false;
  const current = ctx.model;
  const isSame = !!current && current.provider === model.provider && current.id === model.id;
  if (!isSame) {
    const success = await pi.setModel(model);
    modelApplied = success;
    if (!success && ctx.hasUI) {
      ctx.ui.notify(`IPC: unable to switch to model ${model.provider}/${model.id}`, "warning");
    }
  }

  let thinkingApplied = false;
  const thinking = thinkingOverride ?? parsed.thinking;
  if (thinking && !hasThinkingFlag(pi)) {
    pi.setThinkingLevel(thinking);
    thinkingApplied = true;
  }

  return { modelApplied, thinkingApplied };
}

export async function loadAndApplySessionConfig(pi: ExtensionAPI, ctx: ExtensionContext, agentName: string) {
  const config = loadMarkdownConfig(ctx.cwd, agentName);
  if (!config) return null;

  let modelApplied = false;
  let thinkingApplied = false;
  let toolsApplied = false;

  const rawModel = config.frontmatter.model;
  if (typeof rawModel === "string" && rawModel.trim()) {
    const modelResult = await applyModelFromSpec(pi, ctx, rawModel, parseThinkingCandidate(config.frontmatter.thinking));
    modelApplied = modelResult.modelApplied;
    thinkingApplied = modelResult.thinkingApplied;
  }

  if (!hasToolsFlag(pi)) {
    const disableTools = config.frontmatter["no-tools"] === true || config.frontmatter.noTools === true;
    if (disableTools) {
      pi.setActiveTools([]);
      toolsApplied = true;
    } else {
      const tools = parseTools(config.frontmatter.tools);
      if (tools && tools.length > 0) {
        pi.setActiveTools(tools);
        toolsApplied = true;
      }
    }
  }

  const mdPromptBody = config.body.trim();

  if (ctx.hasUI && (modelApplied || thinkingApplied || toolsApplied || mdPromptBody.length > 0)) {
    const applied: string[] = [];
    if (modelApplied) applied.push("model");
    if (thinkingApplied) applied.push("thinking");
    if (toolsApplied) applied.push("tools");
    if (mdPromptBody.length > 0) applied.push("system prompt");
    ctx.ui.notify(`IPC: loaded ${applied.join(", ")} from ${config.filePath}`, "info");
  }

  return {
    filePath: config.filePath,
    mdPromptBody,
  };
}
