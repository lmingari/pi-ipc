export type PresenceStatus = "idle" | "busy";

export type EnvelopeType = "request" | "reply" | "progress" | "cancel" | "ack";

export type EnvelopeMessage = {
  type: EnvelopeType;
  v: 1;
  requestId?: string;
  from: string;
  to?: string;
  timestamp: number;
  payload: unknown;
};

export type RequestPayload = {
  task: string;
  expectedFormat?: string;
  contextRefs?: string[];
  metadata?: Record<string, unknown>;
};

export type ReplyPayload = {
  ok: boolean;
  summary?: string;
  answer: string;
  artifactRefs?: string[];
  metadata?: Record<string, unknown>;
  error?: string;
};

export type ProgressPayload = {
  message: string;
  percent?: number;
};

type BaseEnvelope<TType extends EnvelopeMessage["type"], TPayload> = Omit<EnvelopeMessage, "type" | "payload"> & {
  type: TType;
  payload: TPayload;
};

export type RequestEnvelope = BaseEnvelope<"request", RequestPayload> & {
  requestId: string;
  to: string;
};

export type ReplyEnvelope = BaseEnvelope<"reply", ReplyPayload> & {
  requestId: string;
};

export type ProgressEnvelope = BaseEnvelope<"progress", ProgressPayload> & {
  requestId: string;
};

export type OrchestratorEnvelope = RequestEnvelope | ReplyEnvelope | ProgressEnvelope;

export const isReplyEnvelope = (value: unknown): value is ReplyEnvelope => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return candidate.type === "reply" && typeof candidate.requestId === "string";
};

export const isRequestEnvelope = (value: unknown): value is RequestEnvelope => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.type === "request" &&
    typeof candidate.requestId === "string" &&
    typeof candidate.to === "string"
  );
};

export const isProgressEnvelope = (value: unknown): value is ProgressEnvelope => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return candidate.type === "progress" && typeof candidate.requestId === "string";
};

export type Message =
  | { type: "register"; clientName: string }
  | { type: "sum"; a: number; b: number }
  | { type: "log"; message: string }
  | { type: "status"; status: PresenceStatus; timestamp?: number }
  | EnvelopeMessage;
