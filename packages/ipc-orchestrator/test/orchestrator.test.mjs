import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { Orchestrator, TimeoutError } from "../dist/index.js";

class MemoryHub {
  constructor() {
    this.transports = new Map();
  }

  register(name, transport) {
    this.transports.set(name, transport);
  }

  async deliver(from, to, message) {
    const target = this.transports.get(to);
    if (!target) {
      throw new Error(`Unknown target: ${to}`);
    }
    await target._receive(message, from);
  }
}

class MemoryTransport {
  constructor(hub, name) {
    this.hub = hub;
    this.name = name;
    this.handlers = [];
    this.hub.register(name, this);
  }

  async send(target, message) {
    if (!target) throw new Error("target is required");
    await this.hub.deliver(this.name, target, message);
  }

  onMessage(handler) {
    this.handlers.push(handler);
  }

  async _receive(message, from) {
    for (const h of this.handlers) {
      await h(message, from);
    }
  }
}

test("sendRequest resolves with correlated reply", async () => {
  const hub = new MemoryHub();
  const master = new Orchestrator("master", new MemoryTransport(hub, "master"));
  const worker = new Orchestrator("worker", new MemoryTransport(hub, "worker"));

  worker.onRequest(async (request) => {
    await worker.sendReply(request.from, request.requestId, {
      ok: true,
      answer: `done: ${request.payload.task}`,
      summary: "completed",
    });
  });

  const reply = await master.sendRequest("worker", { task: "compute X" }, 1000);

  assert.equal(reply.type, "reply");
  assert.equal(reply.from, "worker");
  assert.equal(reply.payload.ok, true);
  assert.equal(reply.payload.answer, "done: compute X");
});

test("sendRequest throws TimeoutError when no reply arrives", async () => {
  const hub = new MemoryHub();
  const master = new Orchestrator("master", new MemoryTransport(hub, "master"));
  // worker exists but intentionally never replies
  new Orchestrator("worker", new MemoryTransport(hub, "worker"));

  await assert.rejects(
    () => master.sendRequest("worker", { task: "never answer" }, 50),
    (error) => {
      assert.equal(error instanceof TimeoutError, true);
      return true;
    },
  );
});

test("progress events are forwarded to onProgress handlers", async () => {
  const hub = new MemoryHub();
  const master = new Orchestrator("master", new MemoryTransport(hub, "master"));
  const worker = new Orchestrator("worker", new MemoryTransport(hub, "worker"));

  let progressMessage = null;

  master.onProgress((progress) => {
    progressMessage = progress.payload.message;
  });

  await worker.sendProgress("master", "req-1", { message: "50%", percent: 50 });
  await delay(10);

  assert.equal(progressMessage, "50%");
});
