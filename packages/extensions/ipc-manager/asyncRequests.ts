import type { ReplyEnvelope } from "ipc";
import type { AsyncRequestEntry, AsyncRequestStatusFilter } from "./types";

export class AsyncRequestStore {
  private readonly requests = new Map<string, AsyncRequestEntry>();
  private readonly orphanReplies = new Map<string, ReplyEnvelope>();

  trackSubmitted(input: {
    requestId: string;
    client: string;
    task: string;
    expectedFormat?: string;
  }): AsyncRequestEntry {
    const orphanReply = this.orphanReplies.get(input.requestId);
    if (orphanReply) {
      this.orphanReplies.delete(input.requestId);
      const completed: AsyncRequestEntry = {
        requestId: input.requestId,
        client: input.client,
        task: input.task,
        expectedFormat: input.expectedFormat,
        submittedAt: Date.now(),
        status: "completed",
        completedAt: Date.now(),
        reply: orphanReply,
      };

      this.requests.set(input.requestId, completed);
      return completed;
    }

    const entry: AsyncRequestEntry = {
      requestId: input.requestId,
      client: input.client,
      task: input.task,
      expectedFormat: input.expectedFormat,
      submittedAt: Date.now(),
      status: "pending",
    };

    this.requests.set(entry.requestId, entry);
    return entry;
  }

  markCompleted(reply: ReplyEnvelope): AsyncRequestEntry | null {
    const existing = this.requests.get(reply.requestId);
    if (!existing) {
      this.orphanReplies.set(reply.requestId, reply);
      return null;
    }

    const completed: AsyncRequestEntry = {
      ...existing,
      status: "completed",
      completedAt: Date.now(),
      reply,
    };

    this.requests.set(reply.requestId, completed);
    return completed;
  }

  get(requestId: string) {
    return this.requests.get(requestId) ?? null;
  }

  list(options?: { status?: AsyncRequestStatusFilter; client?: string; limit?: number }) {
    const status = options?.status ?? "all";
    const client = options?.client?.trim();
    const limit = options?.limit && options.limit > 0 ? Math.floor(options.limit) : 20;

    const items = [...this.requests.values()]
      .filter((entry) => {
        if (status !== "all" && entry.status !== status) return false;
        if (client && entry.client !== client) return false;
        return true;
      })
      .sort((a, b) => b.submittedAt - a.submittedAt)
      .slice(0, limit);

    return items;
  }

  clear() {
    this.requests.clear();
    this.orphanReplies.clear();
  }
}
