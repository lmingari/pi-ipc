import type { ReplyEnvelope } from "ipc";

export type ClientStatus = "connected" | "disconnected";

export type ClientPresence = "idle" | "busy";
export type PresenceStatus = ClientPresence | "unknown";

export type ClientInfo = {
  status: ClientStatus;
  presence: PresenceStatus;
  lastSeen: number;
};

export type AsyncRequestStatus = "pending" | "completed";
export type AsyncRequestStatusFilter = AsyncRequestStatus | "all";

export type AsyncRequestEntry = {
  requestId: string;
  client: string;
  task: string;
  expectedFormat?: string;
  submittedAt: number;
  status: AsyncRequestStatus;
  completedAt?: number;
  reply?: ReplyEnvelope;
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

export type RequestAsyncToolInput = {
  client: string;
  task: string;
  expectedFormat?: string;
};

export type RequestStatusToolInput = {
  requestId: string;
};

export type RequestListToolInput = {
  status?: AsyncRequestStatusFilter;
  client?: string;
  limit?: number;
};

export type RequestWaitToolInput = {
  requestId: string;
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
