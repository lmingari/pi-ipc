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

export type Message =
  | { type: "register"; clientName: string }
  | { type: "sum"; a: number; b: number }
  | { type: "log"; message: string }
  | { type: "status"; status: PresenceStatus; timestamp?: number }
  | EnvelopeMessage;
