import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { Client, Server } from "../dist/index.js";

const waitFor = async (predicate, timeoutMs = 2000, intervalMs = 20) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await delay(intervalMs);
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
};

test("client receives onDisconnect when server stops", async () => {
  const server = new Server();
  await server.start();

  const client = new Client("test-client-server-stop");
  await client.connect();

  let disconnected = false;
  client.onDisconnect(() => {
    disconnected = true;
  });

  await server.stop();

  await waitFor(() => disconnected === true);
  assert.equal(client.isConnected(), false);
});

test("client.close does not trigger onDisconnect handler", async () => {
  const server = new Server();
  await server.start();

  const client = new Client("test-client-manual-close");
  await client.connect();

  let disconnected = false;
  client.onDisconnect(() => {
    disconnected = true;
  });

  await client.close();

  await delay(100);
  assert.equal(disconnected, false);
  assert.equal(client.isConnected(), false);

  await server.stop();
});
