export type PresenceStatus = "idle" | "busy";

export type Message =
  | { type: "register"; clientName: string }
  | { type: "sum"; a: number; b: number }
  | { type: "log"; message: string }
  | { type: "status"; status: PresenceStatus; timestamp?: number };
