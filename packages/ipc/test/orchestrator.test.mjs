import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { Orchestrator, TimeoutError } from "../dist/index.js";

class FakeClientEndpoint {
  constructor(name, hub) {
    this.name = name;
    this.hub = hub;
    this.handlers = new Map();
    this.hub.register(name, this);
  }

  on(type, handler) {
    this.handlers.set(type, handler);
  }

  async send(message) {
    await this.hub.deliver(this.name, message.to, message);
  }

  async _receive(message) {
    const handler = this.handlers.get(message.type);
    if (handler) {
      await handler(message);
    }
  }
}

class FakeHub {
  constructor() {
    this.clients = new Map();
  }

  register(name, client) {
    this.clients.set(name, client);
  }

  async deliver(_from, to, message) {
    const target = this.clients.get(to);
    if (!target) throw new Error(`Unknown target: ${to}`);
    await target._receive(message);
  }
}

test("sendRequest resolves with correlated reply", async () => {
  const hub = new FakeHub();
  const master = new Orchestrator("master", new FakeClientEndpoint("master", hub));
  const worker = new Orchestrator("worker", new FakeClientEndpoint("worker", hub));

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
  const hub = new FakeHub();
  const master = new Orchestrator("master", new FakeClientEndpoint("master", hub));
  new Orchestrator("worker", new FakeClientEndpoint("worker", hub));

  await assert.rejects(
    () => master.sendRequest("worker", { task: "never answer" }, 50),
    (error) => {
      assert.equal(error instanceof TimeoutError, true);
      return true;
    },
  );
});

test("progress events are forwarded to onProgress handlers", async () => {
  const hub = new FakeHub();
  const master = new Orchestrator("master", new FakeClientEndpoint("master", hub));
  const worker = new Orchestrator("worker", new FakeClientEndpoint("worker", hub));

  let progressMessage = null;

  master.onProgress((progress) => {
    progressMessage = progress.payload.message;
  });

  await worker.sendProgress("master", "req-1", { message: "50%", percent: 50 });
  await delay(10);

  assert.equal(progressMessage, "50%");
});
