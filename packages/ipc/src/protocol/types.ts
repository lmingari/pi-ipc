export type PresenceStatus = "idle" | "busy";

export type RegisterMessage = {
  type: "register";
  clientName: string;
};

export type LogMessage = {
  type: "log";
  message: string;
};

export type StatusMessage = {
  type: "status";
  status: PresenceStatus;
  timestamp?: number;
};

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

export type Message = RegisterMessage | LogMessage | StatusMessage | EnvelopeMessage;
