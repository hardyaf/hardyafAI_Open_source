import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { HouseholdDatabase } from "../src/database.ts";
import { ExecutionAuthorityRepository } from "../src/request-context.ts";
import { NativeDomainAuthorization } from "../src/domain-runtime/native-scope.ts";
import { fingerprint } from "../src/domain-runtime/common.ts";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { registerNativeTaskBridge } from "../../../plugins/household-domains/native-task-hooks.mjs";
import { HouseholdDomainRuntime } from "../src/domain-runtime/runtime.ts";

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "hardy-invocation-")), filename = path.join(directory, "household.sqlite");
  const database = new HouseholdDatabase(filename), connection = database.domainConnection();
  connection.prepare("INSERT INTO devices(id,profile_id,display_name,public_key_der_base64,status,enrolled_at) VALUES ('fixture-device','alex','Fixture','unused','active',?)").run(new Date().toISOString());
  const conversation = { id: "fixture-conversation", ownerProfileId: "alex", agentId: "main", sessionKey: "hardy-home:fixture", title: "Fixture", presetId: null, audience: "private" as const, updatedAt: new Date().toISOString() };
  database.insertConversation(conversation);
  database.submissions.enqueue({ submissionId: "fixture-source", conversationId: conversation.id, profileId: "alex", agentId: "main", textHash: createHash("sha256").update("Fixture").digest("hex"), requestHash: "fixture-request", payload: { kind: "message", text: "Fixture" }, originDeviceId: "fixture-device" });
  const claim = database.submissions.claimNext(2, 120000)!;
  database.submissions.accepted(claim.receipt.submissionId, claim.leaseToken!, { ...claim.receipt, status: "running", runId: "fixture-run" });
  const authority = new ExecutionAuthorityRepository(connection);
  const grant = { sessionKey: conversation.sessionKey, rootSessionKey: conversation.sessionKey, sourceId: "fixture-source", parentSessionKey: null, agentId: "main", sessionId: "fixture-session", goalId: null, runId: "fixture-run", mode: "normal" as const };
  authority.bind(grant);
  const identity = { agentId: "main", sessionKey: conversation.sessionKey, sessionId: "fixture-session", toolCallId: "tool_call:outer:household_lists_capture:1", toolName: "household_lists_capture", argumentHash: fingerprint({ items: ["Fixture"] }) };
  const domainGrant = { enabled: true, domains: ["lists"], scopes: ["personal", "household"] as Array<"personal" | "household">, contactEditing: false, projectCodes: [], canManageProjects: false, canReviewReceipts: false, allowedAttendees: [], sharedDomains: ["lists"] };
  const authorization = new NativeDomainAuthorization(database, { alex: domainGrant });
  const scope = () => authorization.resolve({ ...identity, runId: grant.runId, nativeRunId: grant.runId, nativeSessionId: grant.sessionId, assertInvocationCurrent() {} });
  const connections: DatabaseSync[] = [];
  return { database, connection, authority, identity, grant, scope, filename, conversation,
    second() { const db = new DatabaseSync(filename); connections.push(db); return new ExecutionAuthorityRepository(db); },
    async close() { for (const db of connections) db.close(); database.close(); await rm(directory, { recursive: true, force: true }); } };
}

test("separate registry repositories consume exact proof once and keep consumption after reconstruction", async () => {
  const f = await fixture(); try {
    const b = f.second(), current = f.scope().principal.assertCurrent;
    f.authority.invocations.bind(f.identity, f.grant.runId, current);
    const pending = b.invocations.inspect({ ...f.identity, sessionKey: "agent:main:" + f.identity.sessionKey }, current);
    assert.deepEqual(pending, { runId: f.grant.runId, sourceId: f.grant.sourceId });
    b.invocations.claim(f.identity, pending, current);
    assert.throws(() => f.authority.invocations.claim(f.identity, pending, current), /trusted_native_invocation_required/);
    assert.throws(() => f.second().invocations.inspect(f.identity, current), /trusted_native_invocation_required/);
  } finally { await f.close(); }
});

test("native call, tool, argument, session and run identities cannot borrow another proof", async () => {
  const f = await fixture(); try {
    const current = f.scope().principal.assertCurrent; f.authority.invocations.bind(f.identity, f.grant.runId, current);
    for (const patch of [{ toolCallId: "another-call" }, { toolName: "household_lists_update" }, { argumentHash: fingerprint({ items: ["Changed"] }) }, { sessionId: "another-session" }, { agentId: "natasha" }])
      assert.throws(() => f.authority.invocations.inspect({ ...f.identity, ...patch }, current), /trusted_native_invocation_required/);
    assert.throws(() => f.authority.invocations.bind(f.identity, "old-run", current), /trusted_native_invocation_required/);
    assert.throws(() => f.authority.invocations.claim(f.identity, { runId: "old-run", sourceId: f.grant.sourceId }, current), /trusted_native_invocation_required/);
  } finally { await f.close(); }
});

test("cross-process compare-and-swap refuses an intervening grant projection write", async () => {
  const f = await fixture(); try {
    const second = f.second(); f.authority.invocations.bind(f.identity, f.grant.runId, () => {});
    const pending = f.authority.invocations.inspect(f.identity, () => {}); let assertions = 0;
    assert.throws(() => f.authority.invocations.claim(f.identity, pending, () => {
      if (++assertions === 2) second.invocations.bind({ ...f.identity, toolCallId: "interleaved-call" }, f.grant.runId, () => {});
    }), /trusted_native_invocation_required/);
    assert.ok(second.invocations.inspect(f.identity, () => {}));
    assert.ok(second.invocations.inspect({ ...f.identity, toolCallId: "interleaved-call" }, () => {}));
  } finally { await f.close(); }
});

test("grant identity replacement clears pending calls while exact goal refresh preserves them", async () => {
  const f = await fixture(); try {
    f.authority.invocations.bind(f.identity, f.grant.runId, () => {}); f.authority.bind({ ...f.grant });
    assert.ok(f.authority.invocations.inspect(f.identity, () => {}));
    for (const patch of [{ runId: "next-run" }, { sessionId: "next-session" }, { goalId: "next-goal" }, { mode: "diagnostic" as const }]) {
      f.authority.bind(f.grant); f.authority.invocations.bind(f.identity, f.grant.runId, () => {});
      f.authority.bind({ ...f.grant, ...patch });
      assert.equal(f.connection.prepare("SELECT invocations_json FROM native_execution_grants").get()!.invocations_json, "[]");
    }
  } finally { await f.close(); }
});

test("expired, future, malformed and over-capacity projections fail closed", async () => {
  const f = await fixture(); try {
    const set = (value: unknown) => f.connection.prepare("UPDATE native_execution_grants SET invocations_json=?").run(typeof value === "string" ? value : JSON.stringify(value));
    const entry = { ...f.identity, runId: f.grant.runId, sourceId: f.grant.sourceId, at: Date.now() - 600001 };
    for (const value of [[entry], [{ ...entry, at: Date.now() + 60_000 }], "not-json", "{}", Array(257).fill(entry)]) {
      set(value); assert.throws(() => f.authority.invocations.inspect(f.identity, () => {}), /trusted_native_invocation_required/);
    }
    set([]); for (let i = 0; i < 256; i++) f.authority.invocations.bind({ ...f.identity, toolCallId: "pending-" + i }, f.grant.runId, () => {});
    assert.throws(() => f.authority.invocations.bind(f.identity, f.grant.runId, () => {}), /trusted_native_invocation_required/);
    const first = { ...f.identity, toolCallId: "pending-0" }, pending = f.authority.invocations.inspect(first, () => {});
    f.authority.invocations.claim(first, pending, () => {}); f.authority.invocations.bind(f.identity, f.grant.runId, () => {});
  } finally { await f.close(); }
});

test("cancellation, control watermark, profile and device revocation fence pending claim", async () => {
  for (const revoke of [
    (f: Awaited<ReturnType<typeof fixture>>) => f.database.submissions.failWithCode(f.grant.sourceId, f.grant.runId, "operator_stop", "cancelled"),
    (f: Awaited<ReturnType<typeof fixture>>) => f.database.recordGoalControl(f.conversation.id, Date.now()),
    (f: Awaited<ReturnType<typeof fixture>>) => f.database.setProfileStatus("alex", "paused", "Fixture revocation"),
    (f: Awaited<ReturnType<typeof fixture>>) => f.connection.prepare("UPDATE devices SET status='revoked'").run(),
  ]) {
    const f = await fixture(); try {
      const current = f.scope().principal.assertCurrent; f.authority.invocations.bind(f.identity, f.grant.runId, current);
      const pending = f.second().invocations.inspect(f.identity, current); revoke(f);
      assert.throws(() => f.authority.invocations.claim(f.identity, pending, current), /domain_authority_revoked/);
      assert.equal(JSON.parse(String(f.connection.prepare("SELECT invocations_json FROM native_execution_grants").get()!.invocations_json)).length, 1, "refused claim must not execute or consume the pending proof");
    } finally { await f.close(); }
  }
});

test("opening an existing schema-4 database adds only the bounded projection with empty default", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "hardy-invocation-migration-")), filename = path.join(directory, "household.sqlite");
  let database = new HouseholdDatabase(filename); database.domainConnection().exec("ALTER TABLE native_execution_grants DROP COLUMN invocations_json"); database.close();
  try { database = new HouseholdDatabase(filename); const column = database.domainConnection().prepare("PRAGMA table_info(native_execution_grants)").all().find(row => row.name === "invocations_json");
    assert.equal(column?.dflt_value, "'[]'"); assert.equal(database.schemaVersion, 8);
  } finally { database.close(); await rm(directory, { recursive: true, force: true }); }
});

test("installed native deferred wrapper runs trusted policy and exact proof across two plugin registry factories", {
  skip: !process.env.OPENCLAW_TEST_PACKAGE_ROOT && "Set OPENCLAW_TEST_PACKAGE_ROOT to verify the installed stock native SDK",
}, async () => {
  const require = createRequire(path.join(process.env.OPENCLAW_TEST_PACKAGE_ROOT!, "package.json"));
  const { initializeGlobalHookRunner, resetGlobalHookRunner } = await import(pathToFileURL(require.resolve("openclaw/plugin-sdk/hook-runtime")).href);
  const { wrapToolWithBeforeToolCallHook } = await import(pathToFileURL(require.resolve("openclaw/plugin-sdk/agent-harness-runtime")).href);
  const f = await fixture();
  try {
    const current = f.scope().principal.assertCurrent, b = f.second(); let executed = 0, changed = false, policyEvaluations = 0;
    const descriptor = { name: "lists.capture", nativeName: f.identity.toolName, description: "Fixture deferred operation", inputSchema: { type: "object", properties: { items: { type: "array", items: { type: "string" } } }, required: ["items"], additionalProperties: false } };
    const nativeContext = { agentId: f.identity.agentId, sessionKey: f.identity.sessionKey, sessionId: f.identity.sessionId, runId: f.grant.runId };
    // Only the native transport observation is replaced. The real application
    // claim method, authority repositories and mutable source fences execute.
    const application = Object.create(HouseholdDomainRuntime.prototype);
    Object.assign(application, { admission: { authority: b }, getTaskContext: async (context: { runId: string }) => {
      assert.equal(context.runId, f.grant.runId); current(); return { task: { assertCurrent: current } };
    }, execute: async (_name: string, _args: unknown, context: { assertInvocationCurrent: () => void }) => { context.assertInvocationCurrent(); executed++; return { recorded: true }; } });
    function registration(authority: ExecutionAuthorityRepository) {
      let factory: { create: Function }, policy: { evaluate: Function };
      const api = { id: "hardy-household", config: { plugins: { entries: { "hardy-household": { hooks: { allowConversationAccess: true, allowPromptInjection: true } } } } },
        on() {}, registerHook() {}, registerTool(value: typeof factory) { factory = value; }, registerTrustedToolPolicy(value: typeof policy) { policy = value; } };
      registerNativeTaskBridge(api, { isManagedAgent: () => true, catalog: () => [descriptor], getTaskContext: async () => ({ task: { assertCurrent: current } }), guard: async () => { policyEvaluations++; return { allow: true }; },
        bindInvocation: async (_binding: unknown, event: { toolCallId: string; toolName: string; params: unknown }, context: typeof nativeContext) => authority.invocations.bind({ ...f.identity, toolCallId: event.toolCallId, toolName: event.toolName, argumentHash: fingerprint(event.params) }, context.runId, current),
        execute: (name: string, args: unknown, context: unknown) => application.executeNativeInvocation(name, args, context) });
      return { factory: () => factory!, policy: () => policy! };
    }
    const global = registration(f.authority), discovered = registration(b);
    initializeGlobalHookRunner({ hooks: [], plugins: [],
      trustedToolPolicies: [{ pluginId: "hardy-household", policy: global.policy(), origin: "config", source: "fixture-policy" }],
      typedHooks: [{ pluginId: "hardy-household", hookName: "before_tool_call", priority: 1000, matcher: [f.identity.toolName],
        handler: async () => changed ? { params: { items: ["Changed after trusted policy"] } } : undefined }] });
    const [raw] = discovered.factory().create({ agentId: f.identity.agentId, sessionKey: f.identity.sessionKey, sessionId: f.identity.sessionId, assertInvocationCurrent: current });
    assert.equal((await raw.execute("forged-direct-call", { items: ["Fixture"] })).details.error.code, "trusted_native_invocation_required");
    const wrapped = wrapToolWithBeforeToolCallHook(raw, nativeContext);
    const first = await wrapped.execute(f.identity.toolCallId, { items: ["Fixture"] });
    assert.equal(first.details.ok, true); assert.equal(executed, 1); assert.equal(policyEvaluations, 1);
    assert.equal((await raw.execute(f.identity.toolCallId, { items: ["Fixture"] })).details.error.code, "trusted_native_invocation_required");
    changed = true;
    const tampered = await wrapped.execute("tool_call:outer:household_lists_capture:2", { items: ["Fixture"] });
    assert.equal(tampered.details.error.code, "trusted_native_invocation_required"); assert.equal(executed, 1); assert.equal(policyEvaluations, 2);
  } finally { resetGlobalHookRunner(); await f.close(); }
});


test("only a trusted current child policy may bind its initially unknown native session generation", async () => {
  const f=await fixture();try{
    const child={...f.grant,sessionKey:"agent:main:subagent:fixture-child",parentSessionKey:f.grant.sessionKey,sessionId:null,runId:"fixture-child-run"};
    f.authority.bind(child);const identity={...f.identity,sessionKey:child.sessionKey,sessionId:"native-child-generation"};
    assert.throws(()=>f.authority.invocations.bind(identity,child.runId,()=>{}),/trusted_native_invocation_required/);
    assert.throws(()=>f.authority.bindChildSessionId(child.sessionKey,child.agentId,identity.sessionId,"wrong-child-run",()=>{}),/trusted_native_invocation_required/);
    f.authority.bindChildSessionId(child.sessionKey,child.agentId,identity.sessionId,child.runId,()=>{});
    assert.equal(f.second().get(child.sessionKey)!.sessionId,identity.sessionId);
    f.authority.invocations.bind(identity,child.runId,()=>{});
    const pending=f.second().invocations.inspect(identity,()=>{});f.authority.invocations.claim(identity,pending,()=>{});
    assert.throws(()=>f.authority.bindChildSessionId(child.sessionKey,child.agentId,"different-generation",child.runId,()=>{}),/trusted_native_invocation_required/);
    f.authority.bind({...f.grant,sessionId:null});
    assert.throws(()=>f.authority.bindChildSessionId(f.grant.sessionKey,f.grant.agentId,"root-unproven",f.grant.runId,()=>{}),/trusted_native_invocation_required/);
  }finally{await f.close();}
});
