import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { HouseholdDatabase } from "../src/database.ts";
import { canonicalDeviceRequest, DeviceAuthenticator } from "../src/device-auth.ts";
import { HouseholdEventHub } from "../src/events.ts";
import { MockHouseholdAgentAdapter } from "../src/mock-adapter.ts";
import { createHouseholdServer } from "../src/server.ts";
import { SqliteHouseholdStore } from "../src/sqlite-household-store.ts";

const database = new HouseholdDatabase(":memory:");
const adapter = new MockHouseholdAgentAdapter([]);
const store = new SqliteHouseholdStore(database, adapter);
const authenticator = new DeviceAuthenticator({ database });
const eventHub = new HouseholdEventHub();
const server = createHouseholdServer({ database, store, authenticator, eventHub });
const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
let baseUrl = "";
let deviceId = "";

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const invitation = database.createInvitation("alex");
  const publicKeyDerBase64 = keys.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const response = await fetch(`${baseUrl}/v1/enrollment/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: invitation.code, deviceName: "Owner test phone", publicKeyDerBase64 }),
  });
  assert.equal(response.status, 201);
  deviceId = (await response.json()).deviceId;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

function signedRequest(path: string, init: RequestInit = {}, nonce = `nonce-${crypto.randomUUID()}`) {
  const method = init.method ?? "GET";
  const body = typeof init.body === "string" ? Buffer.from(init.body) : Buffer.alloc(0);
  const timestamp = Date.now().toString();
  const canonical = canonicalDeviceRequest({ method, path, timestamp, nonce, body });
  const signature = sign("sha256", Buffer.from(canonical), keys.privateKey).toString("base64");
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-hardy-device-id": deviceId,
      "x-hardy-timestamp": timestamp,
      "x-hardy-nonce": nonce,
      "x-hardy-signature": signature,
      ...init.headers,
    },
  });
}

test("one-time enrollment cannot be claimed twice", async () => {
  const invitation = database.createInvitation("alex", 15, "1234abcd");
  assert.equal(invitation.code, "1234ABCD");
  const publicKeyDerBase64 = keys.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const request = () => fetch(`${baseUrl}/v1/enrollment/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: invitation.code, deviceName: "Other", publicKeyDerBase64 }),
  });
  assert.equal((await request()).status, 201);
  assert.equal((await request()).status, 401);
});

test("signed device requests authenticate and reject replay", async () => {
  const nonce = "nonce-replay-test-0001";
  assert.equal((await signedRequest("/v1/me", {}, nonce)).status, 200);
  assert.equal((await signedRequest("/v1/me", {}, nonce)).status, 401);
});

test("submission idempotency returns one canonical receipt and publishes only new submission events", async (t) => {
  const createBody = JSON.stringify({ title: "Connected alpha", presetId: null });
  const createResponse = await signedRequest("/v1/conversations", { method: "POST", body: createBody });
  assert.equal(createResponse.status, 201);
  const conversationId = (await createResponse.json()).conversation.id;
  const submissionId = "submission-connected-alpha-0001";
  const messageBody = JSON.stringify({ text: "Hello from the signed device", submissionId });
  const path = `/v1/conversations/${conversationId}/messages`;
  const publish = t.mock.method(eventHub, "publish");
  const first = await signedRequest(path, { method: "POST", body: messageBody });
  const second = await signedRequest(path, { method: "POST", body: messageBody });
  assert.equal(first.status, 202);
  assert.equal(second.status, 202);
  assert.deepEqual((await second.json()).receipt, (await first.json()).receipt);
  assert.deepEqual(publish.mock.calls.map(call => call.arguments[0]), ["submission.changed"]);
  assert.equal(database.getSubmission(submissionId)?.receipt.status, "queued");
  assert.equal((await adapter.listMessages(database.getConversation(conversationId)!)).length, 0);
  await store.reconcileRuns();
  assert.equal(database.getSubmission(submissionId)?.receipt.status, "running");
  const deliveredReplay = await signedRequest(path, { method: "POST", body: messageBody });
  assert.equal((await deliveredReplay.json()).receipt.status, "running");
  await store.reconcileRuns();
  const history = await signedRequest(path);
  const body = await history.json();
  assert.equal(body.messages.filter((message: { text: string }) => message.text === "Hello from the signed device").length, 1);
});

test("a submission id cannot be reused with changed text", async () => {
  const conversations = await signedRequest("/v1/conversations");
  const conversationId = (await conversations.json()).conversations[0].id;
  const submissionId = "submission-conflict-alpha-0001";
  const path = `/v1/conversations/${conversationId}/messages`;
  await signedRequest(path, { method: "POST", body: JSON.stringify({ text: "First", submissionId }) });
  const conflict = await signedRequest(path, {
    method: "POST",
    body: JSON.stringify({ text: "Changed", submissionId }),
  });
  assert.equal(conflict.status, 409);
});

test("a signed metadata edit updates SQLite and preserves the native session binding", async () => {
  const created = await signedRequest("/v1/conversations", {
    method: "POST", body: JSON.stringify({ title: "Before editing" }),
  });
  assert.equal(created.status, 201);
  const { conversation } = await created.json();
  const path = "/v1/conversations/" + conversation.id + "/metadata";
  const saved = await signedRequest(path, {
    method: "PUT", body: JSON.stringify({ title: "After editing", tags: ["House", "Repairs"] }),
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(database.getConversation(conversation.id), {
    ...conversation, title: "After editing", tags: ["House", "Repairs"],
  });
  const listed = await signedRequest("/v1/conversations");
  assert.deepEqual((await listed.json()).conversations.find((row: { id: string }) => row.id === conversation.id),
    (await saved.json()).conversation);
});
