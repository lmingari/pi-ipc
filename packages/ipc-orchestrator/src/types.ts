export type EnvelopeType = "request" | "reply" | "progress" | "cancel" | "ack" | "status";

export type Envelope<TPayload = unknown> = {
  v: 1;
  type: EnvelopeType;
  requestId?: string;
  from: string;
  to?: string;
  timestamp: number;
  payload: TPayload;
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

export type RequestEnvelope = Envelope<RequestPayload> & {
  type: "request";
  requestId: string;
  to: string;
};

export type ReplyEnvelope = Envelope<ReplyPayload> & {
  type: "reply";
  requestId: string;
};

export type ProgressEnvelope = Envelope<ProgressPayload> & {
  type: "progress";
  requestId: string;
};

export const isEnvelope = (value: unknown): value is Envelope => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.v !== 1) return false;
  if (typeof candidate.type !== "string") return false;
  if (typeof candidate.from !== "string") return false;
  if (typeof candidate.timestamp !== "number") return false;
  if (!("payload" in candidate)) return false;
  return true;
};

export const isReplyEnvelope = (value: unknown): value is ReplyEnvelope => {
  if (!isEnvelope(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.type === "reply" && typeof candidate.requestId === "string";
};

export const isRequestEnvelope = (value: unknown): value is RequestEnvelope => {
  if (!isEnvelope(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.type === "request" &&
    typeof candidate.requestId === "string" &&
    typeof candidate.to === "string"
  );
};
