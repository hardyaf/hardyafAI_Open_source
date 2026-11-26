import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { mkdtemp, writeFile, rm, unlink, symlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  ArtifactStore, artifactResponseHeaders, NativeExecutionCoordinator, NativeExecutionPolicies,
  buildNativeExecutionProfiles, buildDiagnosticEvidence,
} from "../src/platform/index.ts";
import type { RestrictedNativeAdapter } from "../src/platform/index.ts";
import { resolveRequest } from "../../../tools/bitwarden-secret-resolver.mjs";

async function workspace(context: TestContext) {
  const temporaryRoot = path.resolve(os.tmpdir());
  const directory = await mkdtemp(path.join(temporaryRoot, "hardy-platform-"));
  context.after(async () => {
    const target = path.resolve(directory);
    assert.equal(path.dirname(target), temporaryRoot);
    assert.ok(path.basename(target).startsWith("hardy-platform-"));
    await rm(target, { recursive: true, force: true });
  });
  return directory;
}
const principal = { profileId: "alex", canReadHousehold: true };
const scope = { ownerProfileId: "alex", conversationId: "conv-1", taskId: "task-1", audience: "private" as const };
const input = { bytes: Buffer.from("fixture evidence"), filename: "evidence.txt", mimeType: "text/plain", kind: "evidence" as const, idempotencyKey: "capture-0001" };

test("artifacts preserve scope, exact replay and conflict semantics", async (context) => {
  const directory = await workspace(context);
  const store = new ArtifactStore({ root: path.join(directory, "artifacts") });
  await store.initialize();
  const saved = await store.put(scope, principal, input);
  assert.equal((await store.put(scope, principal, input)).id, saved.id);
  await assert.rejects(() => store.put(scope, principal, { ...input, bytes: Buffer.from("changed") }), /artifact_operation_conflict/);
  await assert.rejects(() => store.get(saved.id, { profileId: "natasha", canReadHousehold: true }), /artifact_not_found/);
  const shared = await store.put({ ...scope, audience: "household" }, principal, { ...input, idempotencyKey: "capture-shared" });
  assert.equal((await store.get(shared.id, { profileId: "natasha", canReadHousehold: true })).id, shared.id);
  await assert.rejects(() => store.get(shared.id, { profileId: "unknown", canReadHousehold: false }), /artifact_not_found/);
  await assert.rejects(() => store.put(scope, principal, { ...input, filename: "../escape" }), /artifact_filename_invalid/);
});

test("artifact downloads contain active content and do not follow a replaced content link", async (context) => {
  const directory = await workspace(context);
  const root = path.join(directory, "artifacts");
  const store = new ArtifactStore({ root });
  await store.initialize();
  const saved = await store.put(scope, principal, { ...input, mimeType: "text/html", bytes: Buffer.from("<script>1</script>"), filename: "visual.html" });
  const headers = artifactResponseHeaders(saved);
  assert.match(headers["Content-Disposition"], /^attachment/);
  assert.match(headers["Content-Security-Policy"], /^sandbox;/);
  assert.equal(headers["Cache-Control"], "private, no-store");
  const content = path.join(root, "objects", saved.id, "content");
  const outside = path.join(directory, "outside.txt");
  await writeFile(outside, "must not be exposed");
  await unlink(content);
  await symlink(outside, content);
  await assert.rejects(() => store.read(saved.id, principal));
});

test("native profile validation rejects host access inherited through defaults", async (context) => {
  const directory = await workspace(context);
  const image = "sha256:" + "a".repeat(64);
  const entries = buildNativeExecutionProfiles({
    analysisWorkspace: path.join(directory, "analysis"), diagnosticWorkspace: path.join(directory, "diagnostic"),
    image, sandboxUser: "1001:1001",
  });
  const configPath = path.join(directory, "openclaw.json");
  const config = { agents: { defaults: { model: { primary: "ollama/gpt-oss:20b", fallbacks: [] }, sandbox: { docker: { binds: [] as string[] } } }, entries } };
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  const policies = new NativeExecutionPolicies({ configPath, image });
  await policies.assertReady("household-analysis");
  const missingPublisher=structuredClone(entries);
  missingPublisher["household-analysis"].tools.allow=missingPublisher["household-analysis"].tools.allow.filter(name=>name!=="household_analysis_publish_output");
  assert.throws(()=>policies.assertProfile("household-analysis",{agents:{defaults:{model:"ollama/gpt-oss:20b"},entries:missingPublisher}}),/restricted_runtime_unavailable/);
  const missingSandboxPublisher=structuredClone(config);
  const sandboxTools=missingSandboxPublisher.agents.entries["household-analysis"].tools.sandbox.tools;
  sandboxTools.allow=sandboxTools.allow.filter(name=>name!=="household_analysis_publish_output");
  assert.throws(()=>policies.assertProfile("household-analysis",missingSandboxPublisher),/restricted_runtime_unavailable/);
  await policies.assertReady("household-diagnostics");
  config.agents.defaults.sandbox.docker.binds = ["/host:/host"];
  await writeFile(configPath, JSON.stringify(config));
  await assert.rejects(() => policies.assertReady("household-analysis"), /restricted_runtime_unavailable/);
});

test("internal execution cannot bypass parent admission or consume another task artifact", async (context) => {
  const directory = await workspace(context);
  const image = "sha256:" + "b".repeat(64);
  const configPath = path.join(directory, "openclaw.json");
  await writeFile(configPath, JSON.stringify({ agents: { defaults: { model: "ollama/gpt-oss:20b" }, entries: buildNativeExecutionProfiles({
    analysisWorkspace: path.join(directory, "analysis"), diagnosticWorkspace: path.join(directory, "diagnostic"), image, sandboxUser: "1001:1001",
  }) } }), { mode: 0o600 });
  const store = new ArtifactStore({ root: path.join(directory, "artifacts") });
  await store.initialize();
  const foreign = await store.put({ ...scope, taskId: "another-task" }, principal, input);
  let calls = 0;
  const adapter: RestrictedNativeAdapter = {
    async createRestrictedSession() { calls++; },
    async submitRestricted(args) { calls++; return { sessionKey: args.sessionKey, runId: "run-1", status: "running" }; },
  };
  const policies = new NativeExecutionPolicies({ configPath, image });
  const unadmitted = new NativeExecutionCoordinator(adapter, policies, store);
  await assert.rejects(() => unadmitted.submit({ kind: "analysis", scope, principal, submissionId: "submission-1", goal: "Inspect evidence" }), /native_admission_required/);
  const admitted = new NativeExecutionCoordinator(adapter, policies, store, async () => {});
  await assert.rejects(() => admitted.submit({ kind: "analysis", scope, principal, submissionId: "submission-1", goal: "Inspect evidence", inputArtifactIds: [foreign.id] }), /execution_attachment_scope_mismatch/);
  assert.equal(calls, 0);
});

test("diagnostic evidence is a bounded metadata whitelist", () => {
  const source = { taskId: "task-1", phase: "inspection", outcome: "failed", promptTokens: 100, rawLog: "must not be copied", events: [{ component: "calendar", code: "invalid_grant", at: "2026-11-03T00:00:00Z" }] };
  const evidence = buildDiagnosticEvidence(source);
  assert.equal(JSON.stringify(evidence).includes(source.rawLog), false);
  assert.throws(() => buildDiagnosticEvidence({ ...source, promptTokens: -1 }), /diagnostic_evidence_invalid/);
});

test("Bitwarden resolution requires explicit no-cache config and exact allowed UUIDs", async (context) => {
  const directory = await workspace(context);
  const binary = path.join(directory, "fixture-bws");
  const config = path.join(directory, "automation.toml");
  await writeFile(binary, "not executed", { mode: 0o700 });
  await writeFile(config, '[profiles.hardy_home]\nstate_opt_out = "true"\nserver_base = "https://vault.example.invalid"\n', { mode: 0o600 });
  const id = "00000000-0000-4000-8000-000000000001";
  const environment = { BWS_BIN: binary, BWS_CONFIG_FILE: config, BWS_ACCESS_TOKEN: "fixture-bootstrap", BWS_ALLOWED_SECRET_IDS: id, BWS_SERVER_URL: "https://vault.example.invalid", HOME: "/must-not-inherit" };
  let calls = 0;
  const invoke = (_command: string, args: string[], options: { env: Record<string, string> }) => {
    calls++;
    assert.ok(args.includes("--config-file"));
    assert.ok(args.includes("hardy_home"));
    assert.equal(args.includes("fixture-bootstrap"), false);
    assert.equal(options.env.HOME, undefined);
    assert.equal(options.env.BWS_SERVER_URL, undefined);
    return { status: 0, stdout: JSON.stringify({ id, value: "fixture-value" }) };
  };
  const request = { protocolVersion: 1, provider: "bws", ids: [id] };
  assert.equal(resolveRequest(request, environment, invoke).values[id], "fixture-value");
  const denied = resolveRequest({ ...request, ids: ["00000000-0000-4000-8000-000000000002"] }, environment, invoke);
  assert.equal(denied.errors["00000000-0000-4000-8000-000000000002"].code, "NOT_FOUND");
  await writeFile(config, '[profiles.hardy_home]\nstate_opt_out = "false"\n');
  assert.equal(resolveRequest(request, environment, invoke).errors[id].code, "PROVIDER_UNAVAILABLE");
  assert.equal(calls, 1);
});
