import { randomUUID } from "node:crypto";
import type { Envelope, ProgressEnvelope, ReplyEnvelope, RequestEnvelope, RequestPayload, ReplyPayload } from "./types.js";
import { isEnvelope, isReplyEnvelope, isRequestEnvelope } from "./types.js";
import type { Transport } from "./transport.js";

type PendingRequest = {
  resolve: (value: ReplyEnvelope) => void;
  reject: (reason?: unknown) => void;
  timeout: NodeJS.Timeout;
};

type RequestHandler = (request: RequestEnvelope) => Promise<void> | void;
type ProgressHandler = (progress: ProgressEnvelope) => Promise<void> | void;
type ReplyHandler = (reply: ReplyEnvelope) => Promise<void> | void;

export class TimeoutError extends Error {
  constructor(requestId: string, timeoutMs: number) {
    super(`Request '${requestId}' timed out after ${timeoutMs}ms`);
  }
}

export class Orchestrator {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly requestHandlers = new Set<RequestHandler>();
  private readonly progressHandlers = new Set<ProgressHandler>();
  private readonly replyHandlers = new Set<ReplyHandler>();

  constructor(
    private readonly nodeId: string,
    private readonly transport: Transport,
    private readonly defaultTimeoutMs = 60_000,
  ) {
    this.transport.onMessage(async (message) => {
      await this.handleIncoming(message);
    });
  }

  onRequest(handler: RequestHandler) {
    this.requestHandlers.add(handler);
  }

  onProgress(handler: ProgressHandler) {
    this.progressHandlers.add(handler);
  }

  onReply(handler: ReplyHandler) {
    this.replyHandlers.add(handler);
  }

  async sendRequest(target: string, payload: RequestPayload, timeoutMs = this.defaultTimeoutMs): Promise<ReplyEnvelope> {
    const requestId = randomUUID();

    const request: RequestEnvelope = {
      v: 1,
      type: "request",
      requestId,
      from: this.nodeId,
      to: target,
      timestamp: Date.now(),
      payload,
    };

    const replyPromise = new Promise<ReplyEnvelope>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new TimeoutError(requestId, timeoutMs));
      }, timeoutMs);

      this.pending.set(requestId, { resolve, reject, timeout });
    });

    await this.transport.send(target, request);

    return replyPromise;
  }

  async sendRequestAsync(target: string, payload: RequestPayload): Promise<string> {
    const requestId = randomUUID();
    const request: RequestEnvelope = {
      v: 1,
      type: "request",
      requestId,
      from: this.nodeId,
      to: target,
      timestamp: Date.now(),
      payload,
    };

    await this.transport.send(target, request);
    return requestId;
  }

  async sendReply(target: string, requestId: string, payload: ReplyPayload) {
    const reply: ReplyEnvelope = {
      v: 1,
      type: "reply",
      requestId,
      from: this.nodeId,
      to: target,
      timestamp: Date.now(),
      payload,
    };

    await this.transport.send(target, reply);
  }

  async sendProgress(target: string, requestId: string, payload: ProgressEnvelope["payload"]) {
    const progress: ProgressEnvelope = {
      v: 1,
      type: "progress",
      requestId,
      from: this.nodeId,
      to: target,
      timestamp: Date.now(),
      payload,
    };

    await this.transport.send(target, progress);
  }

  async handleIncoming(raw: unknown) {
    if (!isEnvelope(raw)) return;

    const message: Envelope = raw;

    if (isReplyEnvelope(message)) {
      const pending = this.pending.get(message.requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pending.delete(message.requestId);
        pending.resolve(message);
      }

      for (const handler of this.replyHandlers) {
        await handler(message);
      }
      return;
    }

    if (isRequestEnvelope(message)) {
      for (const handler of this.requestHandlers) {
        await handler(message);
      }
      return;
    }

    if (message.type === "progress" && typeof message.requestId === "string") {
      const progress = message as ProgressEnvelope;
      for (const handler of this.progressHandlers) {
        await handler(progress);
      }
    }
  }

  close() {
    for (const [requestId, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`Orchestrator closed before reply for request '${requestId}'`));
    }
    this.pending.clear();
  }
}
