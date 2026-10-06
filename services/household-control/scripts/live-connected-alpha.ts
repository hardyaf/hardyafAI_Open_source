import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { HouseholdDatabase } from "../src/database.ts";
import { canonicalDeviceRequest } from "../src/device-auth.ts";

if (process.env.HARDY_HOME_LIVE_SMOKE !== "1") {
  throw new Error("Set HARDY_HOME_LIVE_SMOKE=1 to run the state-changing live smoke test");
}

const baseUrl = process.env.HARDY_HOME_BASE_URL ?? "http://10.23.45.67:4317";
const databasePath = process.env.HARDY_HOME_DATABASE ?? resolve("data", "household-control.sqlite");
const restartGatePath = process.env.HARDY_HOME_RESTART_GATE_FILE;
const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
let deviceId = "";

async function signedRequest(path: string, init: RequestInit = {}) {
  const method = init.method ?? "GET";
  const body = typeof init.body === "string" ? Buffer.from(init.body) : Buffer.alloc(0);
  const timestamp = Date.now().toString();
  const nonce = `nonce-${randomUUID()}`;
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

async function checked(response: Response, expected: number) {
  const body = await response.text();
  assert.equal(response.status, expected, body);
  return body ? JSON.parse(body) : {};
}

const invitationDatabase = new HouseholdDatabase(databasePath);
const invitation = invitationDatabase.createInvitation("alex", 5);
invitationDatabase.close();

try {
  const publicKeyDerBase64 = keys.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const enrollment = await checked(await fetch(`${baseUrl}/v1/enrollment/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: invitation.code,
      deviceName: "connected-alpha-live-smoke",
      publicKeyDerBase64,
    }),
  }), 201);
  deviceId = enrollment.deviceId;

  const me = await checked(await signedRequest("/v1/me"), 200);
  assert.equal(me.profile.id, "alex");
  assert.equal(me.profile.agentId, "main");

  const conversationResult = await checked(await signedRequest("/v1/conversations", {
    method: "POST",
    body: JSON.stringify({ title: "Connected alpha acceptance", presetId: null }),
  }), 201);
  const conversationId = conversationResult.conversation.id;
  const messagesPath = `/v1/conversations/${conversationId}/messages`;
  const submissionId = `live-${randomUUID()}`;
  const sendBody = JSON.stringify({
    text: "Connected-alpha acceptance check. Reply briefly and include the exact words Hardy Home connected.",
    submissionId,
  });
  const firstReceipt = await checked(await signedRequest(messagesPath, { method: "POST", body: sendBody }), 202);

  if (restartGatePath) {
    writeFileSync(restartGatePath, JSON.stringify({ conversationId, submissionId }));
    const restartDeadline = Date.now() + 60_000;
    while (existsSync(restartGatePath) && Date.now() < restartDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(!existsSync(restartGatePath), "service restart gate was not released before timeout");
  }

  // A fresh signed request with the same durable ID simulates an ambiguous
  // reconnect. It must replay the receipt, never enqueue a second user turn.
  const replayReceipt = await checked(await signedRequest(messagesPath, { method: "POST", body: sendBody }), 202);
  assert.deepEqual(replayReceipt.receipt, firstReceipt.receipt);

  const deadline = Date.now() + 240_000;
  let history: { messages: Array<{ role: string; text: string }> } = { messages: [] };
  while (Date.now() < deadline) {
    history = await checked(await signedRequest(messagesPath), 200);
    if (history.messages.some((message) => message.role === "assistant" && message.text.length > 0)) break;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  assert.equal(history.messages.filter((message) => message.role === "user").length, 1);
  const assistant = history.messages.find((message) => message.role === "assistant");
  assert.ok(assistant, "assistant response did not become canonical before timeout");

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    profileId: me.profile.id,
    agentId: me.profile.agentId,
    conversationId,
    submissionId,
    assistantText: assistant.text,
  })}\n`);
} finally {
  if (restartGatePath && existsSync(restartGatePath)) unlinkSync(restartGatePath);
  if (deviceId) {
    const cleanupDatabase = new HouseholdDatabase(databasePath);
    cleanupDatabase.revokeDevice(deviceId);
    cleanupDatabase.close();
  }
}
