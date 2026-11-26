import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { HouseholdDatabase } from "../src/database.ts";
import { HouseholdDomainRuntime } from "../src/domain-runtime/runtime.ts";
import { NativeDomainAuthorization } from "../src/domain-runtime/native-scope.ts";
import { NativeAdmission } from "../src/domain-runtime/native-admission.ts";
import { ArtifactStore } from "../src/platform/artifacts.ts";
import type { OpenClawAgentAdapter } from "../src/openclaw-adapter.ts";

function fixture() {
  const database = new HouseholdDatabase(":memory:"), sql = database.domainConnection();
  sql.prepare("INSERT INTO devices(id,profile_id,display_name,public_key_der_base64,status,enrolled_at) VALUES('fixture-device','alex','Fixture','not-a-real-key','active',?)").run(new Date().toISOString());
  const conversation = { id: "end-conversation", ownerProfileId: "alex", agentId: "main", sessionKey: "hardy-home:end", title: "End fixture", presetId: null, audience: "private" as const, updatedAt: new Date().toISOString() };
  database.insertConversation(conversation);
  const text = "Avery likes purple.";
  database.submissions.enqueue({ submissionId: "end-source", conversationId: conversation.id, profileId: "alex", agentId: "main", textHash: createHash("sha256").update(text).digest("hex"), requestHash: "fixture-end", payload: { kind: "message", text }, originDeviceId: "fixture-device", taskContext: { mode: "conversation" } });
  const claim = database.submissions.claimNext(2, 120000)!;
  database.submissions.accepted(claim.receipt.submissionId, claim.leaseToken!, { ...claim.receipt, status: "running", runId: "end-run" });
  const grants = { alex: { enabled: true, domains: ["memory"], scopes: ["personal"] as Array<"personal" | "household">, contactEditing: false, projectCodes: [], canManageProjects: false, canReviewReceipts: false, allowedAttendees: [], sharedDomains: [] } };
  let native = { sessionKey: conversation.sessionKey, sessionId: "end-session", runId: null as string | null, goal: { id: "unbound-goal", objective: text, status: "active", updatedAt: Date.now() }, continuationPending: false };
  let duringRead: (() => void) | undefined;
  const adapter = { getContext: async () => { duringRead?.(); return native; } } as unknown as OpenClawAgentAdapter;
  const admission = new NativeAdmission(database, adapter, [], new ArtifactStore({ root: "/unused/end-artifacts" }), { schedulingEnabled: false, scheduledToolNames: [], profileGrants: grants });
  const grant = { sessionKey: conversation.sessionKey, rootSessionKey: conversation.sessionKey, sourceId: "end-source", parentSessionKey: null, agentId: "main", sessionId: "end-session", goalId: null as string | null, runId: "end-run", mode: "normal" as const };
  admission.authority.bind(grant);
  const settlements: string[] = [], settle = admission.settle.bind(admission);
  admission.settle = (...args: Parameters<NativeAdmission["settle"]>) => { settlements.push(args[2]); return settle(...args); };
  // Native event observation is replaced; actual admission, grant/source/device
  // authority, terminal callback and ledger transition remain exercised.
  const runtime = Object.create(HouseholdDomainRuntime.prototype) as HouseholdDomainRuntime;
  Object.assign(runtime, { database, adapter, admission, authorization: new NativeDomainAuthorization(database, grants), closed: false });
  const context = { agentId: "main", sessionKey: conversation.sessionKey, sessionId: "end-session", runId: "end-run" };
  return { database, sql, admission, grant, runtime, context, settlements, setNative: (patch: Partial<typeof native>) => { native = { ...native, ...patch }; },
    duringRead: (callback: () => void) => { duringRead = callback; }, source: () => database.submissions.get("end-source")!, close: () => database.close() };
}

test("native end with cleared public run and an unbound active goal fails visibly without adopting it", async () => {
  const f = fixture(); try {
    await f.runtime.nativeEnd({}, f.context);
    assert.equal(f.source().receipt.status, "failed");assert.equal(f.source().receipt.goalId, null);
    assert.equal(f.sql.prepare("SELECT last_error FROM submissions WHERE id='end-source'").get()!.last_error, "native_goal_binding_missing");
    assert.deepEqual(f.settlements, []);
  } finally { f.close(); }
});

test("a current run does not authorize adoption of an unrelated goal absent its trusted goal binding", async () => {
  const f = fixture(); try {
    f.setNative({ runId: "end-run" });await f.runtime.nativeEnd({}, f.context);
    assert.equal(f.source().receipt.status, "failed");assert.equal(f.source().receipt.goalId, null);
  } finally { f.close(); }
});

test("the exact existing trusted goal/run/session proof may bind the same source for the reconciler", async () => {
  const f = fixture(); try {
    f.admission.authority.bind({ ...f.grant, goalId: "unbound-goal" });f.setNative({ runId: "end-run" });
    await f.runtime.nativeEnd({}, f.context);
    assert.equal(f.source().receipt.status, "running");assert.equal(f.source().receipt.goalId, "unbound-goal");
    assert.deepEqual(f.settlements, []);
  } finally { f.close(); }
});

test("an older completed goal does not turn ordinary conversation into a failed or adopted task", async () => {
  const f = fixture(); try {
    f.setNative({ goal: { id: "older-goal", objective: "Historical task", status: "complete", updatedAt: Date.now() } });
    await f.runtime.nativeEnd({}, f.context);
    assert.equal(f.source().receipt.goalId, null);assert.notEqual(f.source().receipt.status, "failed");assert.deepEqual(f.settlements, ["complete"]);
  } finally { f.close(); }
});

test("a terminal callback cannot overwrite a newer terminal receipt or current grant", async () => {
  for (const change of ["terminal", "grant", "device"] as const) {
    const f = fixture(); try {
      f.duringRead(() => {
        if (change === "terminal") f.database.submissions.failWithCode("end-source", "end-run", "operator_cancelled", "cancelled");
        if (change === "grant") f.admission.authority.bind({ ...f.grant, runId: "newer-run" });
        if (change === "device") f.database.revokeDevice("fixture-device");
      });
      await f.runtime.nativeEnd({}, f.context);
      assert.equal(f.source().receipt.status, change === "terminal" ? "cancelled" : "running");
      assert.equal(f.sql.prepare("SELECT last_error FROM submissions WHERE id='end-source'").get()!.last_error, change === "terminal" ? "operator_cancelled" : null);
      assert.deepEqual(f.settlements, []);
    } finally { f.close(); }
  }
});
