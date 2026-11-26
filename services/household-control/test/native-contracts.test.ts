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
import type { LoadedNativeContract } from "../src/native-contracts.ts";

const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const contacts = { domainId: "contacts", contractDigest: digest("Contacts contract version 1") };
const documents = { domainId: "documents", contractDigest: digest("Document contract version 1") };
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "hardy-contracts-")), filename = path.join(directory, "household.sqlite");
  const database = new HouseholdDatabase(filename), connection = database.domainConnection();
  connection.prepare("INSERT INTO devices(id,profile_id,display_name,public_key_der_base64,status,enrolled_at) VALUES ('fixture-device','alex','Fixture','unused','active',?)").run(new Date().toISOString());
  const conversation = { id: "fixture-conversation", ownerProfileId: "alex", agentId: "main", sessionKey: "hardy-home:fixture", title: "Fixture", presetId: null, audience: "private" as const, updatedAt: new Date().toISOString() };
  database.insertConversation(conversation);
  for (const submissionId of ["fixture-source", "other-source"]) database.submissions.enqueue({ submissionId, conversationId: conversation.id, profileId: "alex", agentId: "main", textHash: digest("Fixture"), requestHash: submissionId, payload: { kind: "message", text: "Fixture" }, originDeviceId: "fixture-device" });
  const claim = database.submissions.claimNext(2, 120000)!;
  database.submissions.accepted(claim.receipt.submissionId, claim.leaseToken!, { ...claim.receipt, status: "running", runId: "fixture-run" });
  const authority = new ExecutionAuthorityRepository(connection);
  const grant = { sessionKey: conversation.sessionKey, rootSessionKey: conversation.sessionKey, sourceId: "fixture-source", parentSessionKey: null, agentId: "main", sessionId: "fixture-session", goalId: null, runId: "fixture-run", mode: "normal" as const };
  authority.bind(grant);
  const authorization = new NativeDomainAuthorization(database, { alex: { enabled: true, domains: ["lists"], scopes: ["personal", "household"], contactEditing: false, projectCodes: [], canManageProjects: false, canReviewReceipts: false, allowedAttendees: [], sharedDomains: ["lists"] } });
  const current = authorization.resolve({ agentId: "main", sessionKey: grant.sessionKey, sessionId: grant.sessionId, runId: grant.runId, nativeRunId: grant.runId, nativeSessionId: grant.sessionId, assertInvocationCurrent() {} }).principal.assertCurrent;
  const connections: DatabaseSync[] = [];
  return { directory, filename, database, connection, authority, grant, conversation, current,
    second() { const db = new DatabaseSync(filename); connections.push(db); return new ExecutionAuthorityRepository(db); },
    async close() { for (const db of connections) db.close(); database.close(); await rm(directory, { recursive: true, force: true }); } };
}

test("successful no-goal context evidence crosses registry owners without creating goal/checkpoint authority", async () => {
  const f = await fixture(); try {
    const beforeGrant = f.authority.get(f.grant.sessionKey), beforeProfiles = f.connection.prepare("SELECT * FROM profiles ORDER BY id").all();
    assert.throws(() => f.authority.contracts.assertLoaded(f.grant, contacts, f.current), /loaded_contract_required/);
    f.authority.contracts.record(f.grant, contacts, f.current);
    f.second().contracts.assertLoaded(f.grant, contacts, f.current);
    assert.deepEqual(f.second().contracts.list(f.grant, f.current), [contacts]);
    assert.deepEqual(f.authority.get(f.grant.sessionKey), beforeGrant);
    assert.deepEqual(f.connection.prepare("SELECT * FROM profiles ORDER BY id").all(), beforeProfiles);
    assert.equal(f.authority.get(f.grant.sessionKey)!.goalId, null);
    assert.equal(f.connection.prepare("SELECT invocations_json FROM native_execution_grants").get()!.invocations_json, "[]");
  } finally { await f.close(); }
});

test("every exact grant identity component fences reads and replacement clears evidence", async () => {
  const f = await fixture(); try {
    const patches = [{ rootSessionKey: "other-root" }, { sourceId: "other-source" }, { parentSessionKey: "other-parent" }, { agentId: "natasha" },
      { sessionId: "other-generation" }, { goalId: "other-goal" }, { runId: "other-run" }, { mode: "diagnostic" as const }];
    for (const patch of patches) {
      f.authority.bind(f.grant); f.authority.contracts.record(f.grant, contacts, () => {});
      assert.throws(() => f.authority.contracts.assertLoaded({ ...f.grant, ...patch }, contacts, () => {}), /loaded_contract_required/);
      f.authority.bind({ ...f.grant, ...patch });
      assert.equal(f.connection.prepare("SELECT loaded_contracts_json FROM native_execution_grants").get()!.loaded_contracts_json, "[]");
      assert.throws(() => f.authority.contracts.list(f.grant, () => {}), /loaded_contract_required/);
    }
    f.authority.bind(f.grant); f.authority.contracts.record(f.grant, contacts, () => {}); f.authority.bind({ ...f.grant });
    f.second().contracts.assertLoaded(f.grant, contacts, () => {});
    assert.throws(() => f.authority.contracts.list({ ...f.grant, sessionKey: "absent-session" }, () => {}), /loaded_contract_required/);
  } finally { await f.close(); }
});

test("current contract digest and domain must both match; only another successful load replaces digest", async () => {
  const f = await fixture(); try {
    f.authority.contracts.record(f.grant, contacts, () => {});
    const changed = { ...contacts, contractDigest: digest("Contacts contract version 2") };
    assert.throws(() => f.authority.contracts.assertLoaded(f.grant, changed, () => {}), /loaded_contract_required/);
    assert.throws(() => f.authority.contracts.assertLoaded(f.grant, { domainId: "documents", contractDigest: contacts.contractDigest }, () => {}), /loaded_contract_required/);
    f.second().contracts.record(f.grant, changed, () => {});
    f.authority.contracts.assertLoaded(f.grant, changed, () => {});
    assert.throws(() => f.authority.contracts.assertLoaded(f.grant, contacts, () => {}), /loaded_contract_required/);
  } finally { await f.close(); }
});

test("cross-owner CAS refuses concurrent projection and grant changes without losing their evidence", async () => {
  const f = await fixture(); try {
    const second = f.second(); f.authority.contracts.record(f.grant, contacts, () => {}); let checks = 0;
    assert.throws(() => f.authority.contracts.record(f.grant, { domainId: "calendar", contractDigest: digest("Calendar") }, () => {
      if (++checks === 2) second.contracts.record(f.grant, documents, () => {});
    }), /loaded_contract_required/);
    assert.deepEqual(second.contracts.list(f.grant, () => {}), [contacts, documents]);
    checks = 0;
    assert.throws(() => f.authority.contracts.record(f.grant, documents, () => {
      if (++checks === 2) second.bind({ ...f.grant, runId: "next-run" });
    }), /loaded_contract_required/);
    assert.equal(f.connection.prepare("SELECT loaded_contracts_json FROM native_execution_grants").get()!.loaded_contracts_json, "[]");
  } finally { await f.close(); }
});

test("post-read current checks cannot return evidence replaced by another registry", async () => {
  const f = await fixture(); try {
    const second = f.second(), changed = { ...contacts, contractDigest: digest("New contract") };
    for (const operation of ["assert", "list"] as const) {
      f.authority.contracts.record(f.grant, contacts, () => {}); let checks = 0;
      const current = () => { if (++checks === 2) second.contracts.record(f.grant, changed, () => {}); };
      assert.throws(() => operation === "assert" ? f.authority.contracts.assertLoaded(f.grant, contacts, current) : f.authority.contracts.list(f.grant, current), /loaded_contract_required/);
    }
  } finally { await f.close(); }
});

test("source, watermark, profile and device revocation fence record and reads through current authority", async () => {
  for (const revoke of [
    (f: Awaited<ReturnType<typeof fixture>>) => f.database.submissions.failWithCode(f.grant.sourceId, f.grant.runId, "operator_stop", "cancelled"),
    (f: Awaited<ReturnType<typeof fixture>>) => f.database.recordGoalControl(f.conversation.id, Date.now()),
    (f: Awaited<ReturnType<typeof fixture>>) => f.database.setProfileStatus("alex", "paused", "Fixture revocation"),
    (f: Awaited<ReturnType<typeof fixture>>) => f.connection.prepare("UPDATE devices SET status='revoked'").run(),
  ]) {
    const f = await fixture(); try {
      f.authority.contracts.record(f.grant, contacts, f.current); revoke(f);
      for (const operation of [() => f.authority.contracts.record(f.grant, documents, f.current), () => f.authority.contracts.assertLoaded(f.grant, contacts, f.current), () => f.authority.contracts.list(f.grant, f.current)])
        assert.throws(operation, /domain_authority_revoked/);
      assert.deepEqual(JSON.parse(String(f.connection.prepare("SELECT loaded_contracts_json FROM native_execution_grants").get()!.loaded_contracts_json)), [contacts]);
    } finally { await f.close(); }
  }
});

test("projection is bounded, content-free and rejects malformed persisted metadata", async () => {
  const f = await fixture(); try {
    for (let i = 0; i < 16; i++) f.authority.contracts.record(f.grant, { domainId: "domain" + i, contractDigest: digest("contract" + i) }, () => {});
    assert.equal(f.authority.contracts.list(f.grant, () => {}).length, 16);
    assert.throws(() => f.authority.contracts.record(f.grant, contacts, () => {}), /loaded_contract_required/);
    f.authority.contracts.record(f.grant, { domainId: "domain0", contractDigest: digest("changed") }, () => {});
    for (const value of ["not-json", "{}", JSON.stringify(Array(17).fill(contacts)), JSON.stringify([contacts, contacts]), JSON.stringify([{ ...contacts, body: "untrusted contract body" }]), JSON.stringify([{ ...contacts, contractDigest: "not-sha256" }])]) {
      f.connection.prepare("UPDATE native_execution_grants SET loaded_contracts_json=?").run(value);
      assert.throws(() => f.authority.contracts.list(f.grant, () => {}), /loaded_contract_required/);
    }
    for (const invalid of [{ ...contacts, domainId: "../contacts" }, { ...contacts, contractDigest: contacts.contractDigest.toUpperCase() }, { ...contacts, instructions: "text is not projection data" }])
      assert.throws(() => f.authority.contracts.record(f.grant, invalid as LoadedNativeContract, () => {}), /loaded_contract_required/);
  } finally { await f.close(); }
});

test("initial native child session generation binding clears previously loaded metadata", async () => {
  const f = await fixture(); try {
    f.authority.contracts.record(f.grant, contacts, () => {});
    const child = { ...f.grant, sessionKey: "agent:main:subagent:fixture", parentSessionKey: f.grant.sessionKey, sessionId: null, runId: "child-run" };
    f.authority.bind(child); f.authority.contracts.record(child, contacts, () => {});
    f.authority.bindChildSessionId(child.sessionKey, child.agentId, "child-generation", child.runId, () => {});
    assert.deepEqual(f.authority.contracts.list({ ...child, sessionId: "child-generation" }, () => {}), []);
    assert.throws(() => f.authority.contracts.assertLoaded(child, contacts, () => {}), /loaded_contract_required/);
    f.authority.contracts.assertLoaded(f.grant, contacts, () => {});
  } finally { await f.close(); }
});

test("schema-4 reopen adds only the projection with empty default and retains grants idempotently", async () => {
  const f = await fixture(); const original = f.authority.get(f.grant.sessionKey)!;
  f.connection.exec("ALTER TABLE native_execution_grants DROP COLUMN loaded_contracts_json"); f.database.close();
  let reopened: HouseholdDatabase | undefined;
  try {
    reopened = new HouseholdDatabase(f.filename);
    const column = reopened.domainConnection().prepare("PRAGMA table_info(native_execution_grants)").all().find(row => row.name === "loaded_contracts_json");
    assert.equal(column?.dflt_value, "'[]'"); assert.equal(reopened.schemaVersion, 8);
    assert.deepEqual(new ExecutionAuthorityRepository(reopened.domainConnection()).get(original.sessionKey), original);
    assert.deepEqual(new ExecutionAuthorityRepository(reopened.domainConnection()).contracts.list(original, () => {}), []);
    reopened.close(); reopened = new HouseholdDatabase(f.filename);
    assert.deepEqual(new ExecutionAuthorityRepository(reopened.domainConnection()).get(original.sessionKey), original);
  } finally { reopened?.close(); await rm(f.directory, { recursive: true, force: true }); }
});
