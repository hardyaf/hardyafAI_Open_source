import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createHouseholdServer } from "../src/server.ts";
import { HouseholdStore } from "../src/household-store.ts";
import { MockHouseholdAgentAdapter } from "../src/mock-adapter.ts";
import { conversations, profiles, presets } from "../src/mock-data.ts";
import { createPlatformRoutes } from "../src/platform-http.ts";
import { ArtifactStore, NativeExecutionPolicies } from "../src/platform/index.ts";

test("actual artifact HTTP downloads preserve exact UTF-8, binary and empty bytes", async (context) => {
  const temporaryRoot = path.resolve(os.tmpdir());
  const directory = await mkdtemp(path.join(temporaryRoot, "hardy-artifact-http-"));
  const artifacts = new ArtifactStore({ root: path.join(directory, "artifacts") });
  await artifacts.initialize();
  const store = new HouseholdStore(
    profiles.map(value => ({ ...value, capabilities: [...value.capabilities] })),
    presets.map(value => ({ ...value, allowedRoles: [...value.allowedRoles] })),
    conversations.map(value => ({ ...value })), new MockHouseholdAgentAdapter([]),
  );
  const route = createPlatformRoutes(store, { artifacts, policies: new NativeExecutionPolicies({ configPath: path.join(directory, "not-read.json"), image: "sha256:" + "a".repeat(64) }), dependencies: {} });
  const server = createHouseholdServer({ store, route });
  context.after(async () => {
    await server.shutdown();
    assert.equal(path.dirname(directory), temporaryRoot);
    assert.ok(path.basename(directory).startsWith("hardy-artifact-http-"));
    await rm(directory, { recursive: true, force: true });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const payloads = [
    { filename: "unicode.txt", mimeType: "text/plain", bytes: Buffer.from("Private café fixture — 你好.\n") },
    { filename: "raster.png", mimeType: "image/png", bytes: Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.from([0,255,17,128,0,13,10])]) },
    { filename: "empty.txt", mimeType: "text/plain", bytes: Buffer.alloc(0) },
  ];
  for (const [index, payload] of payloads.entries()) {
    const artifact = await artifacts.put({ ownerProfileId: "alex", conversationId: "conv-alex-week", taskId: "download-fixture", audience: "private" },
      { profileId: "alex", canReadHousehold: true }, { ...payload, kind: "output", idempotencyKey: `download-${index}-fixture` });
    const routePath = `/v1/conversations/conv-alex-week/artifacts/${artifact.id}/content`;
    const response = await fetch(baseUrl + routePath, { headers: { "x-device-id": "alex-phone" }, signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-length"), String(payload.bytes.length));
    assert.equal(response.headers.get("content-type"), payload.mimeType);
    const downloaded = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(downloaded, payload.bytes);
    assert.equal(createHash("sha256").update(downloaded).digest("hex"), artifact.sha256);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const denied = await fetch(baseUrl + routePath, { headers: { "x-device-id": "natasha-phone" } });
    assert.equal(denied.status, 404);
  }
});
