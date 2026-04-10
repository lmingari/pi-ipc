import type { ReplyEnvelope } from "ipc";
import type { AsyncRequestEntry, AsyncRequestStatusFilter } from "./types";

type AsyncWaiter = {
  resolve: (value: AsyncRequestEntry) => void;
  reject: (reason?: unknown) => void;
  timeout: NodeJS.Timeout;
};

export class AsyncRequestStore {
  private readonly requests = new Map<string, AsyncRequestEntry>();
  private readonly waiters = new Map<string, Set<AsyncWaiter>>();

  trackSubmitted(input: {
    requestId: string;
    client: string;
    task: string;
    expectedFormat?: string;
  }): AsyncRequestEntry {
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
    if (!existing) return null;

    const completed: AsyncRequestEntry = {
      ...existing,
      status: "completed",
      completedAt: Date.now(),
      reply,
    };

    this.requests.set(reply.requestId, completed);
    const waiters = this.waiters.get(reply.requestId);
    if (waiters) {
      for (const waiter of waiters) {
        clearTimeout(waiter.timeout);
        waiter.resolve(completed);
      }
      this.waiters.delete(reply.requestId);
    }

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

  async waitFor(requestId: string, timeoutMs: number) {
    const existing = this.requests.get(requestId);
    if (!existing) {
      throw new Error(`Unknown async IPC request '${requestId}'.`);
    }

    if (existing.status === "completed") {
      return existing;
    }

    return new Promise<AsyncRequestEntry>((resolve, reject) => {
      const waiter: AsyncWaiter = {
        resolve,
        reject,
        timeout: setTimeout(() => {
          const set = this.waiters.get(requestId);
          if (set) {
            set.delete(waiter);
            if (set.size === 0) {
              this.waiters.delete(requestId);
            }
          }
          reject(new Error(`Timed out waiting for async IPC request '${requestId}' after ${timeoutMs}ms`));
        }, timeoutMs),
      };

      const waiters = this.waiters.get(requestId) ?? new Set<AsyncWaiter>();
      waiters.add(waiter);
      this.waiters.set(requestId, waiters);
    });
  }

  clear() {
    for (const waiters of this.waiters.values()) {
      for (const waiter of waiters) {
        clearTimeout(waiter.timeout);
        waiter.reject(new Error("Async IPC request store cleared before completion."));
      }
    }

    this.waiters.clear();
    this.requests.clear();
  }
}
