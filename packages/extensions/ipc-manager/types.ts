export type ClientStatus = "connected" | "disconnected";

export type ClientPresence = "idle" | "busy";
export type PresenceStatus = ClientPresence | "unknown";

export type ClientInfo = {
  status: ClientStatus;
  presence: PresenceStatus;
  lastSeen: number;
};

export type LogToolInput = {
  client: string;
  message: string;
};

export type RequestToolInput = {
  client: string;
  task: string;
  expectedFormat?: string;
  timeoutMs?: number;
};

export type ReplyToolInput = {
  requestId: string;
  answer: string;
  summary?: string;
  ok?: boolean;
  error?: string;
  to?: string;
};
