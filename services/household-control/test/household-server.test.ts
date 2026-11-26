import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import { createHouseholdServer } from "../src/server.ts";

const server = createHouseholdServer();
let baseUrl = "";

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

function request(path: string, deviceId: string, init: RequestInit = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-device-id": deviceId,
      ...init.headers,
    },
  });
}

test("health is available without a device credential", async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.adapter, "mock");
});

test("unknown devices fail closed", async () => {
  const response = await request("/v1/me", "unknown-device");
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "device_not_enrolled" });
});

test("a child cannot read diagnostics", async () => {
  const childResponse = await request("/v1/admin/diagnostics", "fred-tablet");
  assert.equal(childResponse.status, 403);
  const childBody = await childResponse.json();
  assert.equal(childBody.requiredCapability, "viewDiagnostics");

  const adminResponse = await request("/v1/admin/diagnostics", "alex-phone");
  assert.equal(adminResponse.status, 200);
});

test("conversation creation derives the agent from device identity", async () => {
  const forged = await request("/v1/conversations", "fred-tablet", {
    method: "POST",
    body: JSON.stringify({title: "Science question", presetId: "homework", agentId: "alex", ownerProfileId: "alex"}),
  });
  assert.equal(forged.status, 400);
  const response = await request("/v1/conversations", "fred-tablet", {
    method: "POST",
    body: JSON.stringify({title: "Science question", presetId: "homework", audience: "private"}),
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.conversation.agentId, "fred");
  assert.equal(body.conversation.ownerProfileId, "fred");
});

test("a third profile is queued while both slots are active", async () => {
  const path = "/v1/conversations/conv-fred-homework/messages";
  const forged = await request(path, "fred-tablet", {
    method: "POST",
    body: JSON.stringify({text: "Can you help me understand fractions?", submissionId: "submit-fred-0001", agentId: "alex"}),
  });
  assert.equal(forged.status, 400);
  const response = await request(path, "fred-tablet", {
    method: "POST",
    body: JSON.stringify({text: "Can you help me understand fractions?", submissionId: "submit-fred-0001", mode: "conversation"}),
  });
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.receipt.profileId, "fred");
  assert.equal(body.receipt.agentId, "fred");
  assert.equal(body.receipt.status, "queued");
  assert.equal(body.receipt.queuePosition, 2);
});

test("private conversations do not cross profiles", async () => {
  const response = await request("/v1/conversations/conv-alex-week/messages", "fred-tablet");
  assert.equal(response.status, 404);
});

test("conversation titles and tags are owner-only, validated, and returned in the list", async () => {
  const created = await request("/v1/conversations", "alex-phone", {
    method: "POST", body: JSON.stringify({ title: "Original", audience: "household" }),
  });
  assert.equal(created.status, 201);
  const { conversation } = await created.json();
  const path = "/v1/conversations/" + conversation.id + "/metadata";
  const save = (device: string, title: string, tags: string[], extra = {}) =>
    request(path, device, { method: "PUT", body: JSON.stringify({ title, tags, ...extra }) });
  assert.equal((await save("fred-tablet", "Other title", [])).status, 404);
  assert.equal((await save("alex-phone", " ", [])).status, 400);
  assert.equal((await save("alex-phone", "Home repairs", ["x".repeat(33)])).status, 400);
  assert.equal((await save("alex-phone", "Home repairs", [], { audience: "private" })).status, 400);
  const updated = await save("alex-phone", " Home repairs ", [" Projects ", "projects", "2026"]);
  assert.equal(updated.status, 200);
  assert.deepEqual((await updated.json()).conversation, { ...conversation, title: "Home repairs", tags: ["Projects", "2026"] });
  const listed = await request("/v1/conversations", "fred-tablet");
  assert.deepEqual((await listed.json()).conversations.find((row: { id: string }) => row.id === conversation.id).tags, ["Projects", "2026"]);
  assert.deepEqual((await (await save("alex-phone", "Home repairs", [])).json()).conversation.tags, []);
});
