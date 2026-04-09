import { randomUUID } from "node:crypto";
import type { Client } from "../client/Client.js";
import type { Server } from "../server/Server.js";
import type {
  ProgressEnvelope,
  ReplyEnvelope,
  RequestEnvelope,
  RequestPayload,
  ReplyPayload,
} from "../protocol/types.js";
import { isProgressEnvelope, isReplyEnvelope, isRequestEnvelope } from "../protocol/guards.js";

type PendingRequest = {
  resolve: (value: ReplyEnvelope) => void;
  reject: (reason?: unknown) => void;
  timeout: NodeJS.Timeout;
};

type RequestHandler = (request: RequestEnvelope) => Promise<void> | void;
type ProgressHandler = (progress: ProgressEnvelope) => Promise<void> | void;
type ReplyHandler = (reply: ReplyEnvelope) => Promise<void> | void;

type Endpoint = Server | Client;

const isServerEndpoint = (endpoint: Endpoint): endpoint is Server => {
  return typeof (endpoint as Server).onConnect === "function";
};

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
    private readonly endpoint: Endpoint,
    private readonly defaultTimeoutMs = 60_000,
  ) {
    this.endpoint.on("request", async (msg) => this.handleIncoming(msg));
    this.endpoint.on("reply", async (msg) => this.handleIncoming(msg));
    this.endpoint.on("progress", async (msg) => this.handleIncoming(msg));
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

    await this.sendEnvelope(target, request);

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

    await this.sendEnvelope(target, request);
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

    await this.sendEnvelope(target, reply);
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

    await this.sendEnvelope(target, progress);
  }

  private async sendEnvelope(target: string, message: RequestEnvelope | ReplyEnvelope | ProgressEnvelope) {
    if (isServerEndpoint(this.endpoint)) {
      await this.endpoint.send(target, message);
      return;
    }

    await this.endpoint.send(message);
  }

  async handleIncoming(raw: unknown) {
    if (isReplyEnvelope(raw)) {
      const pending = this.pending.get(raw.requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pending.delete(raw.requestId);
        pending.resolve(raw);
      }

      for (const handler of this.replyHandlers) {
        await handler(raw);
      }
      return;
    }

    if (isRequestEnvelope(raw)) {
      for (const handler of this.requestHandlers) {
        await handler(raw);
      }
      return;
    }

    if (isProgressEnvelope(raw)) {
      for (const handler of this.progressHandlers) {
        await handler(raw);
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
