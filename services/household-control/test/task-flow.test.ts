import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { TaskFlowService, buildTaskPrompt, finalizeTask, diagnosticToolAllowed, verifyTaskArtifact } from "../src/task-flow/index.ts";
import type { TaskFlowContext, TaskFlowPorts, TaskEvidenceRef } from "../src/task-flow/types.ts";
import type { HouseholdCheckpoint } from "../src/domain.ts";
import type { ArtifactMetadata } from "../src/platform/artifacts.ts";

const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
function fixture() {
  let checkpoint: HouseholdCheckpoint | null = null;
  const objects = new Map<string, { metadata: ArtifactMetadata; bytes: Buffer }>();
  const receipts = new Map<string, string>();
  let live = true;
  const ctx: TaskFlowContext = {
    principal: { profileId: "alex", canReadHousehold: true },
    scope: { ownerProfileId: "alex", conversationId: "conversation-a", taskId: "goal-a", audience: "household" },
    native: { sessionId: "session-a", sessionKey: "hardy-home:a", goalId: "goal-a", goalStatus: "active", objective: "Create an event", runId: "run-a" },
    source: { id: "prompt-a", text: "Create an event", sha256: sha("Create an event"), human: true },
    mode: "normal", artifactIds: [], assertCurrent: () => { if (!live) throw Error("authority_changed"); },
  };
  const ports: TaskFlowPorts = {
    checkpoints: {
      get: () => checkpoint,
      update: (context, update) => {
        if (update.expectedRevision !== (checkpoint?.revision ?? 0)) throw Error("checkpoint_conflict");
        checkpoint = { conversationId: context.scope.conversationId, nativeSessionId: update.nativeSessionId, nativeGoalId: update.nativeGoalId,
          revision: update.expectedRevision + 1, phase: update.phase, questionArtifactId: update.questionArtifactId ?? null,
          checkpointArtifactId: update.checkpointArtifactId ?? null, updatedAt: new Date().toISOString() };
        return checkpoint;
      },
    },
    artifacts: {
      read: async id => { const value = objects.get(id); if (!value) throw Error("not_found"); return { metadata: structuredClone(value.metadata), bytes: Buffer.from(value.bytes) }; },
      put: async (scope, _principal, input) => {
        const id = "artifact-" + sha(input.idempotencyKey ?? input.bytes), metadata: ArtifactMetadata = { ...scope, schemaVersion: 1, id,
          filename: input.filename, mimeType: input.mimeType, kind: input.kind, byteLength: input.bytes.length,
          sha256: sha(input.bytes), createdAt: new Date().toISOString() };
        objects.set(id, { metadata, bytes: input.bytes }); return metadata;
      },
    },
    catalog: () => [{ id: "calendar", description: "Household calendar", instructions: "Use typed calendar tools.", tools: ["household_calendar_create"] }],
    evidence: async (_context, refs: TaskEvidenceRef[]) => refs.map(ref => ({ ...ref, verified: receipts.has(ref.id), digest: sha(receipts.get(ref.id) ?? "missing"),
      summary: "Owning domain inspected current state", provenance: "domain_receipt", effect: { toolName: "household_calendar_create", state: "committed" } })),
  };
  const service = new TaskFlowService(ports);
  const revision = () => checkpoint?.revision ?? 0;
  const call = (name: string, input: object = {}, context = ctx) => service.execute(name, { expectedRevision: revision(), ...input }, context);
  const reply = (text: string) => ({ ...ctx, native: { ...ctx.native, runId: "run-b" }, source: { id: "prompt-b", text, sha256: sha(text), human: true } });
  return { ctx, ports, service, receipts, objects, call, revision, reply, revoke: () => { live = false; } };
}

test("question survives service reconstruction and accepts ordinary freeform correction", async () => {
  const f = fixture();
  await f.call("task.checkpoint", { phase: "working", summary: "Event needs one detail", nextAction: "Ask which child", outcomes: [{ id: "event", description: "Create event", evidenceKind: "operation", requiredEffect: { toolName: "household_calendar_create", state: "committed" } }] });
  await f.call("task.ask_question", { question: "Which child is attending?", reason: "Attendee is uncertain", choices: ["Child A", "Child B"] });
  const restarted = new TaskFlowService(f.ports), state = await restarted.snapshot(f.ctx);
  assert.equal(state.question?.text, "Which child is attending?");
  assert.equal(f.ctx.native.goalStatus, "active");
  assert.equal((await finalizeTask(restarted, f.ctx))?.action, "finalize");
  const corrected = f.reply("Both, and move it to next Friday; also redo that card scan.");
  const result = await restarted.execute("task.bind_reply", { expectedRevision: f.revision(), questionArtifactId: state.checkpoint!.questionArtifactId,
    relation: "answer", affectedOutcomeIds: ["event"] }, corrected) as { currentHumanPrompt: string };
  assert.equal(result.currentHumanPrompt, corrected.source.text);
  assert.equal((await restarted.snapshot(corrected)).question, null);
});

test("new topic and ambiguous replies do not consume the outstanding question", async () => {
  const f = fixture();
  await f.call("task.ask_question", { question: "Which project?", reason: "Receipt project is uncertain" });
  const before = await f.service.snapshot(f.ctx);
  await f.call("task.bind_reply", { questionArtifactId: before.checkpoint!.questionArtifactId, relation: "new_topic" }, f.reply("What is on the shopping list?"));
  assert.equal((await f.service.snapshot(f.ctx)).question?.text, "Which project?");
});

test("same source cannot fabricate its own answer and stale CAS cannot replace question", async () => {
  const f = fixture();
  await f.call("task.ask_question", { question: "Which date?", reason: "Missing date" });
  const state = await f.service.snapshot(f.ctx);
  await assert.rejects(() => f.call("task.bind_reply", { questionArtifactId: state.checkpoint!.questionArtifactId, relation: "answer" }), /task_fresh_human_prompt_required/);
  await assert.rejects(() => f.service.execute("task.select_domains", { expectedRevision: 0, domains: ["calendar"] }, f.ctx), /task_checkpoint_conflict/);
  assert.equal((await f.service.snapshot(f.ctx)).checkpoint!.revision, state.checkpoint!.revision);
});

test("context selection cannot authorize an absent domain and restores selected instructions", async () => {
  const f = fixture();
  await assert.rejects(() => f.call("task.select_domains", { domains: ["secrets"] }), /task_domain_not_authorized/);
  await f.call("task.select_domains", { domains: ["calendar"] });
  const prompt = await buildTaskPrompt(f.service, f.ctx, await f.ports.catalog(f.ctx));
  assert.match(prompt.prependSystemContext, /Use typed calendar tools/);
  assert.equal("toolsAllow" in prompt, false);
});

test("task completion requires real receipts for every original outcome", async () => {
  const f = fixture();
  await f.call("task.checkpoint", { phase: "working", summary: "Starting event", nextAction: "Create it", outcomes: [{ id: "event", description: "Event created", evidenceKind: "operation", requiredEffect: { toolName: "household_calendar_create", state: "committed" } }] });
  await assert.rejects(() => f.call("task.finish", { summary: "Done" }), /task_outcomes_incomplete/);
  await assert.rejects(() => f.call("task.verify_outcome", { outcomeId: "event", references: [{ kind: "operation", id: "unknown" }] }), /task_evidence_unverified/);
  f.receipts.set("event-operation", "event:source-id:revision-1");
  await f.call("task.verify_outcome", { outcomeId: "event", references: [{ kind: "operation", id: "event-operation" }] });
  await f.call("task.finish", { summary: "Created the requested event" });
  assert.equal(await f.service.canComplete(f.ctx), true);
  f.receipts.set("event-operation", "event:source-id:revision-2");
  assert.equal(await f.service.canComplete(f.ctx), false);
});

test("checkpoints cannot silently remove or rewrite original outcomes", async () => {
  const f = fixture();
  await f.call("task.checkpoint", { phase: "working", summary: "Plan", nextAction: "Execute", outcomes: [{ id: "event", description: "Invite Alex", evidenceKind: "operation", requiredEffect: { toolName: "household_calendar_create", state: "committed" } }] });
  await f.call("task.checkpoint", { phase: "working", summary: "Still working", nextAction: "Execute", outcomes: [] });
  assert.equal((await f.service.snapshot(f.ctx)).handoff!.outcomes.length, 1);
  await assert.rejects(() => f.call("task.checkpoint", { phase: "working", summary: "Plan changed", nextAction: "Skip invitation", outcomes: [{ id: "event", description: "Skip Alex", evidenceKind: "artifact" }] }), /task_outcome_change_requires_steering/);
});

test("committed generic operation cannot prove accepted receipt business state", async () => {
  const f = fixture();
  await f.call("task.checkpoint", { phase: "working", summary: "Receipt review", nextAction: "Accept only when source checks pass", outcomes: [
    { id: "accepted", description: "Receipt accepted", evidenceKind: "operation", requiredEffect: { toolName: "household_receipts_candidate_accept", state: "accepted", resourceId: "candidate-a" } },
  ] });
  f.receipts.set("accept-attempt", "committed-call-but-not-accepted");
  await assert.rejects(() => f.call("task.verify_outcome", { outcomeId: "accepted", references: [{ kind: "operation", id: "accept-attempt" }] }), /task_evidence_requirement_mismatch/);
  await assert.rejects(() => f.call("task.finish", { summary: "Accepted" }), /task_outcomes_incomplete/);
});

test("operation outcomes must declare their required owning effect", async () => {
  const f = fixture();
  await assert.rejects(() => f.call("task.checkpoint", { phase: "working", summary: "Plan", nextAction: "Create event", outcomes: [
    { id: "event", description: "Event created", evidenceKind: "operation" },
  ] }), /task_operation_requirement_required/);
});

test("same user outcome can refine create to corrective update and must replace its old proof", async () => {
  const f = fixture();
  const original = { id: "event", description: "Requested event has the correct time", evidenceKind: "operation",
    requiredEffect: { toolName: "household_calendar_create", state: "committed" } };
  await f.call("task.checkpoint", { phase: "working", summary: "Create requested event", nextAction: "Read it back", outcomes: [original] });
  f.receipts.set("initial-create", "initial-owner-proof");
  await f.call("task.verify_outcome", { outcomeId: "event", references: [{ kind: "operation", id: "initial-create" }] });
  assert.ok((await f.service.snapshot(f.ctx)).handoff!.verifications.event);
  await f.call("task.checkpoint", { phase: "working", summary: "Readback requires a correction", nextAction: "Update this same event", outcomes: [
    { ...original, requiredEffect: { toolName: "household_calendar_update", state: "committed", resourceId: "event-source-a" } },
  ] });
  assert.equal((await f.service.snapshot(f.ctx)).handoff!.verifications.event, undefined);
  await assert.rejects(() => f.call("task.finish", { summary: "Corrected event" }), /task_outcomes_incomplete/);
  f.ports.evidence = async (_context, refs) => refs.map(ref => ({ ...ref, verified: ref.id === "corrective-update", digest: sha("corrected-owner-proof"),
    summary: "Owning calendar readback confirms requested event", provenance: "domain_receipt",
    effect: { toolName: "household_calendar_update", state: "committed", resourceId: "event-source-a" } }));
  await f.call("task.verify_outcome", { outcomeId: "event", references: [{ kind: "operation", id: "corrective-update" }] });
  await f.call("task.finish", { summary: "Corrected the requested event" });
  assert.equal(await f.service.canComplete(f.ctx), true);
});

test("strategy refinement cannot weaken business state, change domain, target or evidence kind", async () => {
  const f = fixture();
  const original = { id: "receipt", description: "This receipt is accepted", evidenceKind: "operation",
    requiredEffect: { toolName: "household_receipts_candidate_accept", state: "accepted", resourceId: "receipt-source-a" } };
  await f.call("task.checkpoint", { phase: "working", summary: "Accept receipt", nextAction: "Verify acceptance", outcomes: [original] });
  for (const changed of [
    { ...original, requiredEffect: { ...original.requiredEffect, state: "provisional" } },
    { ...original, requiredEffect: { ...original.requiredEffect, toolName: "household_calendar_create" } },
    { ...original, requiredEffect: { ...original.requiredEffect, resourceId: "receipt-source-b" } },
    { ...original, requiredEffect: { toolName: original.requiredEffect.toolName, state: original.requiredEffect.state } },
    { ...original, evidenceKind: "artifact", requiredEffect: undefined },
  ]) {
    await assert.rejects(() => f.call("task.checkpoint", { phase: "working", summary: "Try changing plan", nextAction: "Continue", outcomes: [changed] }), /task_outcome_change_requires_steering/);
  }
  assert.deepEqual((await f.service.snapshot(f.ctx)).handoff!.outcomes, [{ ...original, intent: original.description }]);
});

test("display wording can change without losing original intent or unchanged owner proof", async () => {
  const f = fixture(), original = { id: "event", description: "Create the requested event", evidenceKind: "operation",
    requiredEffect: { toolName: "household_calendar_create", state: "committed", resourceId: "event-source-a" } };
  f.ports.evidence = async (_context, refs) => refs.map(ref => ({ ...ref, verified: true, digest: sha("event-proof"),
    summary: "Current requested event", provenance: "domain_receipt", effect: original.requiredEffect as any }));
  await f.call("task.checkpoint", { phase: "working", summary: "Plan", nextAction: "Create event", outcomes: [original] });
  await f.service.associateEvidence(f.ctx, { references: [{ kind: "operation", id: "event-operation" }] });
  const before = await f.service.snapshot(f.ctx);
  await f.call("task.checkpoint", { phase: "verification", summary: "Checking delivery", nextAction: "Complete", outcomes: [{ ...original, description: "Requested event is saved" }] });
  const after = await f.service.snapshot(f.ctx);
  assert.equal(after.handoff!.outcomes[0].intent, original.description);
  assert.equal(after.handoff!.outcomes[0].description, "Requested event is saved");
  assert.deepEqual(after.handoff!.verifications, before.handoff!.verifications);
  assert.equal((await f.service.complete(f.ctx, { summary: "Saved requested event" })).state, "ready_for_native_completion");
});

test("artifact plan wording is mutable while the original acceptance kind is preserved", async () => {
  const f = fixture();
  await f.call("task.checkpoint", { phase: "working", summary: "Create report", nextAction: "Build output", outcomes: [{ id: "report", description: "Create requested report", evidenceKind: "artifact" }] });
  await f.call("task.checkpoint", { phase: "working", summary: "Revise presentation", nextAction: "Build output", outcomes: [{ id: "report", description: "Report file ready for review", evidenceKind: "artifact" }] });
  const state = await f.service.snapshot(f.ctx);
  assert.equal(state.handoff!.outcomes[0].intent, "Create requested report");
  assert.equal(state.handoff!.outcomes[0].description, "Report file ready for review");
});

test("fresh scoped human steering may replace acceptance without retaining stale operation constraints", async () => {
  const f = fixture();
  await f.call("task.checkpoint", { phase: "working", summary: "Create event", nextAction: "Create it", outcomes: [
    { id: "event", description: "Create the event", evidenceKind: "operation", requiredEffect: { toolName: "household_calendar_create", state: "committed" } },
  ] });
  const redirected = f.reply("Actually, prepare a report instead of creating that event.");
  await f.call("task.bind_reply", { questionArtifactId: null, relation: "steer", affectedOutcomeIds: ["event"] }, redirected);
  await f.call("task.checkpoint", { phase: "working", summary: "Prepare report", nextAction: "Create file", outcomes: [
    { id: "event", description: "Prepare the requested report", evidenceKind: "artifact" },
  ] }, redirected);
  const outcome = (await f.service.snapshot(redirected)).handoff!.outcomes[0];
  assert.equal(outcome.intent, "Prepare the requested report"); assert.equal(outcome.evidenceKind, "artifact");
  assert.equal(outcome.requiredEffect, undefined);
});

test("owner receipts attach without a model checkpoint revision and completion rechecks them", async () => {
  const f = fixture();
  await f.call("task.checkpoint", { phase: "working", summary: "Starting", nextAction: "Create requested event", outcomes: [
    { id: "event", description: "Create requested event", evidenceKind: "operation", requiredEffect: { toolName: "household_calendar_create", state: "committed" } },
  ] });
  f.receipts.set("event-operation", "event:revision-1");
  const associated = await f.service.associateEvidence(f.ctx, { references: [{ kind: "operation", id: "event-operation" }] });
  assert.equal(associated.state, "associated"); assert.deepEqual(associated.outcomeIds, ["event"]);
  const replayed = await f.service.associateEvidence(f.ctx, { references: [{ kind: "operation", id: "event-operation" }] });
  assert.equal(replayed.state, "already_associated"); assert.equal(replayed.revision, associated.revision);
  const complete = await f.service.execute("task.complete", { summary: "Created requested event" }, f.ctx) as any;
  assert.equal(complete.state, "ready_for_native_completion"); assert.equal(complete.nativeGoalId, "goal-a");
  assert.equal("handoff" in complete, false); assert.equal("verifications" in complete, false);
  assert.deepEqual(complete.outcomes[0].references, [{ kind: "operation", id: "event-operation" }]);
  assert.equal((await f.service.complete(f.ctx, { summary: "Created requested event" })).revision, complete.revision);
  f.receipts.set("event-operation", "event:revision-2");
  await assert.rejects(() => f.service.complete(f.ctx, { summary: "Created requested event" }), /task_evidence_changed/);
});

test("automatic receipt association never guesses among compatible outcomes", async () => {
  const f = fixture();
  const requiredEffect = { toolName: "household_calendar_create", state: "committed" };
  await f.call("task.checkpoint", { phase: "working", summary: "Two events", nextAction: "Create both", outcomes: [
    { id: "alpha", description: "First event", evidenceKind: "operation", requiredEffect },
    { id: "beta", description: "Second event", evidenceKind: "operation", requiredEffect },
  ] });
  f.receipts.set("event-alpha", "alpha-proof");
  const revision = f.revision(), ambiguous = await f.service.associateEvidence(f.ctx, { references: [{ kind: "operation", id: "event-alpha" }] });
  assert.equal(ambiguous.state, "ambiguous"); assert.deepEqual(ambiguous.outcomeIds, ["alpha", "beta"]);
  assert.equal(f.revision(), revision); assert.deepEqual((await f.service.snapshot(f.ctx)).handoff!.verifications, {});
  const pending = await f.service.complete(f.ctx, { summary: "Both complete", references: [{ kind: "operation", id: "event-alpha" }] });
  assert.equal(pending.state, "evidence_required");
  await f.service.associateEvidence(f.ctx, { references: [{ kind: "operation", id: "event-alpha" }], outcomeId: "alpha" });
  assert.equal((await f.service.associateEvidence(f.ctx, { references: [{ kind: "operation", id: "event-alpha" }] })).state, "ambiguous");
  assert.equal((await f.service.snapshot(f.ctx)).handoff!.verifications.beta, undefined);
});

test("internal receipt association CAS cannot overwrite a newer checkpoint during owner readback", async () => {
  const f = fixture();
  await f.call("task.checkpoint", { phase: "working", summary: "Create event", nextAction: "Verify", outcomes: [
    { id: "event", description: "Create requested event", evidenceKind: "operation", requiredEffect: { toolName: "household_calendar_create", state: "committed" } },
  ] });
  f.receipts.set("event-operation", "event-proof");
  const readback = f.ports.evidence;
  let changed = false;
  f.ports.evidence = async (context, refs) => {
    if (!changed) {
      changed = true;
      await f.call("task.checkpoint", { phase: "working", summary: "Newer current handoff", nextAction: "Keep this steering" });
    }
    return readback(context, refs);
  };
  await assert.rejects(() => f.service.associateEvidence(f.ctx, { references: [{ kind: "operation", id: "event-operation" }] }), /checkpoint_conflict/);
  const state = await f.service.snapshot(f.ctx);
  assert.equal(state.handoff!.summary, "Newer current handoff");
  assert.deepEqual(state.handoff!.verifications, {});
});

test("receipt association rejects wrong acceptance state or unknown owner proof", async () => {
  const f = fixture();
  await f.call("task.checkpoint", { phase: "working", summary: "Accept receipt", nextAction: "Verify financial acceptance", outcomes: [
    { id: "receipt", description: "Receipt accepted", evidenceKind: "operation", requiredEffect: { toolName: "household_receipts_candidate_accept", state: "accepted", resourceId: "receipt-a" } },
  ] });
  f.receipts.set("unrelated-event", "calendar-commit");
  assert.equal((await f.service.associateEvidence(f.ctx, { references: [{ kind: "operation", id: "unrelated-event" }] })).state, "unmatched");
  await assert.rejects(() => f.service.associateEvidence(f.ctx, { references: [{ kind: "operation", id: "unknown" }] }), /task_evidence_unverified/);
  await assert.rejects(() => f.service.associateEvidence(f.ctx, { references: [{ kind: "operation", id: "unrelated-event" }], outcomeId: "receipt" }), /task_evidence_requirement_mismatch/);
});

test("domain selection does not require a model revision and repeated selection avoids checkpoint churn", async () => {
  const f = fixture();
  await f.service.execute("task.select_domains", { domains: ["calendar"] }, f.ctx);
  const selectedRevision = f.revision(), count = f.objects.size;
  await f.service.execute("task.select_domains", { domains: ["calendar"] }, f.ctx);
  assert.equal(f.revision(), selectedRevision); assert.equal(f.objects.size, count);
  await assert.rejects(() => f.service.execute("task.select_domains", { expectedRevision: 0, domains: ["calendar"] }, f.ctx), /task_checkpoint_conflict/);
  const noGoal = fixture(); noGoal.ctx.native.goalId = null;
  const result = await noGoal.service.execute("task.select_domains", { domains: ["calendar"] }, noGoal.ctx) as any;
  assert.equal(result.ephemeral, true); assert.equal(noGoal.revision(), 0); assert.equal(noGoal.objects.size, 0);
});

test("one owning batch receipt proves only the exact individual resource ids it returned", async () => {
  const f = fixture();
  await f.call("task.checkpoint", { phase: "working", summary: "Capture two shopping entries", nextAction: "Verify each entry", outcomes: [
    { id: "bread", description: "Bread is on the list", evidenceKind: "operation", requiredEffect: { toolName: "household_lists_capture", state: "committed", resourceId: "list-item-bread" } },
    { id: "milk", description: "Milk is on the list", evidenceKind: "operation", requiredEffect: { toolName: "household_lists_capture", state: "committed", resourceId: "list-item-milk" } },
    { id: "eggs", description: "Eggs are on the list", evidenceKind: "operation", requiredEffect: { toolName: "household_lists_capture", state: "committed", resourceId: "list-item-eggs" } },
  ] });
  f.ports.evidence = async (_context, refs) => refs.map(ref => ({ ...ref, verified: true, digest: sha("owning-batch-items"), summary: "Owning list batch readback",
    provenance: "domain_receipt", effect: { toolName: "household_lists_capture", state: "committed", resourceIds: ["list-item-bread", "list-item-milk"] } }));
  for (const outcomeId of ["bread", "milk"]) await f.call("task.verify_outcome", { outcomeId, references: [{ kind: "operation", id: "list-batch-operation" }] });
  await assert.rejects(() => f.call("task.verify_outcome", { outcomeId: "eggs", references: [{ kind: "operation", id: "list-batch-operation" }] }), /task_evidence_requirement_mismatch/);
  assert.deepEqual(Object.keys((await f.service.snapshot(f.ctx)).handoff!.verifications).sort(), ["bread", "milk"]);
  await assert.rejects(() => f.call("task.finish", { summary: "All entries added" }), /task_outcomes_incomplete/);
});

test("waiting cannot be overwritten by arbitrary work before a reply is bound", async () => {
  const f = fixture();
  await f.call("task.ask_question", { question: "When?", reason: "Missing time" });
  await assert.rejects(() => f.call("task.checkpoint", { phase: "working", summary: "Guessed", nextAction: "Execute" }), /task_reply_binding_required/);
});

test("source hash, sticky mode and live authority are checked", async () => {
  const f = fixture();
  await f.call("task.checkpoint", { phase: "working", summary: "Started", nextAction: "Continue" });
  await assert.rejects(() => f.service.snapshot({ ...f.ctx, mode: "diagnostic" }), /task_checkpoint_binding_invalid/);
  await assert.rejects(() => f.service.snapshot({ ...f.ctx, source: { ...f.ctx.source, text: "forged" } }), /task_authority_invalid/);
  f.revoke();
  await assert.rejects(() => f.service.snapshot(f.ctx), /authority_changed/);
});

test("diagnosis refuses operational tools including child delegation and model mutation", () => {
  for (const name of ["exec", "write", "sessions_spawn", "sessions_send", "household_calendar_create", "household_memory_save", "gateway", "message"]) {
    assert.equal(diagnosticToolAllowed(name, {}), false, name);
  }
  assert.equal(diagnosticToolAllowed("session_status", { model: "other-model" }), false);
  assert.equal(diagnosticToolAllowed("household_diagnostics_evidence", {}), true);
});

test("self-authored handoff and question artifacts cannot prove output delivery", async () => {
  const f = fixture();
  await f.call("task.checkpoint", { phase: "working", summary: "Plan", nextAction: "Make chart" });
  const snapshot = await f.service.snapshot(f.ctx);
  await assert.rejects(() => verifyTaskArtifact(f.ctx, snapshot.checkpoint!.checkpointArtifactId!, f.ports.artifacts), /task_artifact_not_outcome_evidence/);
});

test("incomplete finalize requests a bounded repair and does not claim an unbounded host loop", async () => {
  const f = fixture();
  await f.call("task.checkpoint", { phase: "working", summary: "Event still missing", nextAction: "Create the event" });
  const decision = await finalizeTask(f.service, f.ctx);
  assert.equal(decision?.action, "revise");
  assert.equal(decision?.retry?.maxAttempts, 3);
  assert.match(decision!.retry!.instruction, /native phase child\/yield/);
});

test("settled native completion explicitly finalizes and active completion retries only the facade", async () => {
  const f = fixture();
  await f.call("task.checkpoint", { phase: "working", summary: "Create requested event", nextAction: "Create", outcomes: [
    { id: "event", description: "Create requested event", evidenceKind: "operation", requiredEffect: { toolName: "household_calendar_create", state: "committed" } },
  ] });
  f.receipts.set("event-operation", "current-event-proof");
  await f.service.complete(f.ctx, { summary: "Created event", references: [{ kind: "operation", id: "event-operation" }] });
  const pending = await finalizeTask(f.service, f.ctx);
  assert.equal(pending?.action, "revise"); assert.match(pending!.retry!.instruction, /household_task_complete/);
  assert.match(pending!.retry!.instruction, /Do not repeat business effects/);
  f.ctx.native.goalStatus = "complete";
  const settled = await finalizeTask(f.service, f.ctx);
  assert.equal(settled?.action, "finalize"); assert.equal(settled?.retry, undefined);
  f.receipts.set("event-operation", "changed-owner-truth");
  const changed = await finalizeTask(f.service, f.ctx);
  assert.equal(changed?.action, "revise"); assert.match(changed!.reason, /evidence changed/);
});

test("summary-only completion requests real outcome semantics without writing a task or claiming success", async () => {
  const f = fixture(); f.receipts.set("actual-operation", "current-owner-proof");
  const result = await f.service.complete(f.ctx, { summary: "Everything is done" }, [{ kind: "operation", id: "actual-operation" }]);
  assert.equal(result.state, "outcomes_required"); assert.equal(f.revision(), 0); assert.equal(f.objects.size, 0);
  assert.equal((await f.service.snapshot(f.ctx)).handoff, null);
  if (result.state !== "outcomes_required") throw Error("Expected pending semantics");
  assert.equal(result.evidenceCandidates.length, 1); assert.equal(result.evidenceCandidates[0].id, "actual-operation");
  assert.equal("digest" in result.evidenceCandidates[0], false); assert.equal("provenance" in result.evidenceCandidates[0], false);
  assert.equal(await f.service.canComplete(f.ctx), false);
});

test("read-only evidence restoration reuses owner validation without declaring outcomes or task state", async () => {
  const f = fixture(); f.receipts.set("actual-operation", "current-owner-proof");
  const facts = await f.service.describeEvidence(f.ctx, [{ kind: "operation", id: "actual-operation" }, { kind: "operation", id: "unreadable-operation" }]);
  assert.equal(facts.evidenceCandidates.length, 1); assert.equal(facts.evidenceCandidates[0].id, "actual-operation");
  assert.equal(facts.unavailableEvidenceCount, 1); assert.equal(f.revision(), 0); assert.equal(f.objects.size, 0);
  assert.equal((await f.service.snapshot(f.ctx)).handoff, null); assert.equal(await f.service.canComplete(f.ctx), false);
  f.revoke(); await assert.rejects(() => f.service.describeEvidence(f.ctx, [{ kind: "operation", id: "actual-operation" }]), /authority_changed/);
});

test("two late user outcomes accept inline owner refs without model IDs or checkpoint ceremony", async () => {
  const f = fixture(); f.receipts.set("alpha-operation", "alpha-owner-proof"); f.receipts.set("beta-operation", "beta-owner-proof");
  const input = { summary: "Both requested events created", outcomes: [
    { description: "Alpha event is created", evidenceKind: "operation" as const, requiredEffect: { toolName: "household_calendar_create", state: "committed" as const }, references: [{ kind: "operation" as const, id: "alpha-operation" }] },
    { description: "Beta event is created", evidenceKind: "operation" as const, requiredEffect: { toolName: "household_calendar_create", state: "committed" as const }, references: [{ kind: "operation" as const, id: "beta-operation" }] },
  ] };
  const first = await f.service.complete(f.ctx, input); assert.equal(first.state, "ready_for_native_completion");
  assert.equal(first.outcomes.length, 2); assert.notEqual(first.outcomes[0].id, first.outcomes[1].id);
  if (first.state !== "ready_for_native_completion") throw Error("Expected verified delivery");
  assert.deepEqual(first.outcomes.map(item => item.references[0].id), ["alpha-operation", "beta-operation"]);
  const retry = await f.service.complete(f.ctx, input);
  assert.equal(retry.state, "ready_for_native_completion"); assert.equal(retry.revision, first.revision);
  assert.deepEqual(retry.outcomes.map(item => item.id), first.outcomes.map(item => item.id));
});

test("late completion associates unique known-resource candidates and retains IDs across pending retries", async () => {
  const f = fixture();
  f.ports.evidence = async (_context, refs) => refs.map(ref => ({ ...ref, verified: ref.id === "alpha-operation" || ref.id === "beta-operation", digest: sha(ref.id),
    summary: "Owning event exists", provenance: "owner", effect: { toolName: "household_calendar_create", state: "committed", resourceId: ref.id === "alpha-operation" ? "event-alpha" : "event-beta" } }));
  const input = { summary: "Two events", outcomes: [
    { description: "Alpha event exists", evidenceKind: "operation" as const, requiredEffect: { toolName: "household_calendar_create", state: "committed" as const, resourceId: "event-alpha" } },
    { description: "Beta event exists", evidenceKind: "operation" as const, requiredEffect: { toolName: "household_calendar_create", state: "committed" as const, resourceId: "event-beta" } },
  ] };
  const pending = await f.service.complete(f.ctx, input, [{ kind: "operation", id: "alpha-operation" }]);
  assert.equal(pending.state, "evidence_required"); assert.equal((await f.service.snapshot(f.ctx)).handoff!.terminal, null);
  const ready = await f.service.complete(f.ctx, input, [{ kind: "operation", id: "alpha-operation" }, { kind: "operation", id: "beta-operation" }]);
  assert.equal(ready.state, "ready_for_native_completion"); assert.deepEqual(ready.outcomes.map(item => item.id), pending.outcomes.map(item => item.id));
});

test("ambiguous owner candidates stay pending until Main supplies the actual result references", async () => {
  const f = fixture(); f.receipts.set("alpha-operation", "alpha-owner-proof"); f.receipts.set("beta-operation", "beta-owner-proof");
  const outcome = { description: "Requested event exists", evidenceKind: "operation" as const, requiredEffect: { toolName: "household_calendar_create", state: "committed" as const } };
  const pending = await f.service.complete(f.ctx, { summary: "Done", outcomes: [outcome] }, [{ kind: "operation", id: "alpha-operation" }, { kind: "operation", id: "beta-operation" }]);
  assert.equal(pending.state, "evidence_required");
  if (pending.state !== "evidence_required") throw Error("Expected ambiguous evidence");
  assert.equal(pending.missingOutcomeIds.length, 1); assert.equal(pending.evidenceCandidates.length, 2);
  assert.deepEqual((await f.service.snapshot(f.ctx)).handoff!.verifications, {});
  const resolved = await f.service.complete(f.ctx, { summary: "Actual event verified", outcomes: [{ ...outcome, references: [{ kind: "operation", id: "alpha-operation" }] }] });
  assert.equal(resolved.state, "ready_for_native_completion");
});

test("unreadable proof returns corrective owner facts while foreign proof remains an error", async () => {
  const f = fixture(), input = { summary: "Done", outcomes: [{ description: "Requested event exists", evidenceKind: "operation" as const,
    requiredEffect: { toolName: "household_calendar_create", state: "committed" as const } }] };
  const pending = await f.service.complete(f.ctx, input, [{ kind: "operation", id: "unknown-operation" }]);
  assert.equal(pending.state, "evidence_required");
  if (pending.state !== "evidence_required") throw Error("Expected no current proof");
  assert.equal(pending.unavailableEvidenceCount, 1); assert.deepEqual(pending.evidenceCandidates, []);
  const invalid = await f.service.complete(f.ctx, { ...input, outcomes: [{ ...input.outcomes[0], references: [{ kind: "operation", id: "unknown-operation" }] }] });
  assert.equal(invalid.state, "evidence_required");
  if (invalid.state !== "evidence_required") throw Error("Expected corrective proof response");
  assert.equal(invalid.rejectedEvidence?.[0].code, "task_evidence_unverified");
  f.ports.evidence = async () => { throw Object.assign(Error("Foreign goal proof"), { code: "task_evidence_source_mismatch" }); };
  await assert.rejects(() => f.service.complete(f.ctx, input, [{ kind: "operation", id: "wrong-goal-operation" }]), /Foreign goal proof/);
});

test("late definitions preserve omitted predeclared outcomes and cannot weaken their acceptance", async () => {
  const f = fixture(), original = [
    { id: "alpha", description: "Alpha event", evidenceKind: "operation", requiredEffect: { toolName: "household_calendar_create", state: "committed", resourceId: "alpha-resource" } },
    { id: "beta", description: "Beta event", evidenceKind: "operation", requiredEffect: { toolName: "household_calendar_create", state: "committed", resourceId: "beta-resource" } },
  ];
  await f.call("task.checkpoint", { phase: "working", summary: "Both events required", nextAction: "Create both", outcomes: original });
  const pending = await f.service.complete(f.ctx, { summary: "Only alpha", outcomes: [original[0] as any] });
  assert.equal(pending.state, "evidence_required"); assert.deepEqual(pending.outcomes.map(item => item.id), ["alpha", "beta"]);
  await assert.rejects(() => f.service.complete(f.ctx, { summary: "Weaken beta", outcomes: [{ ...original[1], requiredEffect: { ...original[1].requiredEffect, state: "provisional" } } as any] }), /task_outcome_change_requires_steering/);
  assert.equal((await f.service.snapshot(f.ctx)).handoff!.outcomes[1].requiredEffect!.state, "committed");
});

test("new automatic candidates cannot conceal changed saved owner proof", async () => {
  const f = fixture(); f.receipts.set("original-operation", "owner-revision-1"); f.receipts.set("convenient-operation", "other-owner-proof");
  await f.call("task.checkpoint", { phase: "working", summary: "Create event", nextAction: "Verify", outcomes: [{ id: "event", description: "Requested event exists", evidenceKind: "operation", requiredEffect: { toolName: "household_calendar_create", state: "committed" } }] });
  await f.service.associateEvidence(f.ctx, { references: [{ kind: "operation", id: "original-operation" }] });
  f.receipts.set("original-operation", "owner-revision-2");
  await assert.rejects(() => f.service.complete(f.ctx, { summary: "Done" }, [{ kind: "operation", id: "convenient-operation" }]), /task_evidence_changed/);
});

test("a false composite draft resource can be corrected with a recorded reason", async () => {
  const f = fixture(), draft = { id: "event", description: "Requested event exists", evidenceKind: "operation" as const,
    requiredEffect: { toolName: "household_calendar_create", state: "committed" as const, resourceId: "event-a;event-b" } };
  await f.call("task.checkpoint", { phase: "working", summary: "Draft plan", nextAction: "Verify", outcomes: [draft] });
  const previous = await f.service.snapshot(f.ctx), corrected = { ...draft, requiredEffect: { ...draft.requiredEffect, resourceId: "event-a" } };
  await assert.rejects(() => f.service.complete(f.ctx, { summary: "Correct draft", outcomes: [corrected] }), /task_outcome_change_requires_steering/);
  const reason = "The resource hint combined two IDs; the owner returned one exact event ID.";
  const result = await f.service.complete(f.ctx, { summary: "Correct draft", outcomes: [corrected], planRevisionReason: reason });
  assert.equal(result.state, "evidence_required");
  const current = await f.service.snapshot(f.ctx);
  assert.equal(current.handoff!.outcomes[0].requiredEffect!.resourceId, "event-a");
  assert.equal(current.handoff!.lastPlanRevision!.reason, reason);
  assert.equal(current.handoff!.previousArtifactId, previous.checkpoint!.checkpointArtifactId);
  assert.equal(current.handoff!.objective, f.ctx.native.objective);
  assert.equal(current.handoff!.originalSourceSha256, f.ctx.source.sha256);
});

test("unverified read bookkeeping can retire without dropping either proven user result", async () => {
  const f = fixture(), result = (id: string) => ({ id, description: id + " saved", evidenceKind: "operation" as const,
    requiredEffect: { toolName: "household_lists_capture", state: "committed" as const, resourceId: id } });
  const invalid = { id: "read-both", description: "Both entries checked", evidenceKind: "operation" as const,
    requiredEffect: { toolName: "household_lists_read", state: "committed" as const, resourceId: "alpha;beta" } };
  await f.call("task.checkpoint", { phase: "working", summary: "Legacy draft", nextAction: "Complete", outcomes: [result("alpha"), result("beta"), invalid] });
  f.ports.operationToolNames = () => ["household_lists_capture"];
  f.ports.evidence = async (_ctx, refs) => refs.map(ref => ({ ...ref, verified: true, digest: sha(ref.id), summary: ref.id + " exists", provenance: "owner",
    effect: { toolName: "household_lists_capture", state: "committed", resourceId: ref.id.replace("-operation", "") } }));
  const input = { summary: "Both requested entries are saved", retireOutcomeIds: ["read-both"], outcomes: ["alpha", "beta"].map(id => ({ ...result(id), references: [{ kind: "operation" as const, id: id + "-operation" }] })) };
  await assert.rejects(() => f.service.complete(f.ctx, input), /task_outcome_change_requires_steering/);
  const ready = await f.service.complete(f.ctx, { ...input, planRevisionReason: "The list read was an observation; only the two actual save receipts prove the requested results." });
  assert.equal(ready.state, "ready_for_native_completion");
  assert.deepEqual(ready.outcomes.map(item => item.id), ["alpha", "beta"]);
  assert.deepEqual(Object.keys((await f.service.snapshot(f.ctx)).handoff!.verifications).sort(), ["alpha", "beta"]);
});

test("owner-bound requirements stay protected after a strategy change clears current proof", async () => {
  const f = fixture(), original = { id: "event", description: "Requested event exists", evidenceKind: "operation" as const,
    requiredEffect: { toolName: "household_calendar_create", state: "committed" as const, resourceId: "event-a" } };
  await f.call("task.checkpoint", { phase: "working", summary: "Create event", nextAction: "Check", outcomes: [original] });
  f.ports.evidence = async (_ctx, refs) => refs.map(ref => ({ ...ref, verified: true, digest: sha(ref.id), summary: "Owner event", provenance: "owner",
    effect: { toolName: "household_calendar_create", state: "committed", resourceId: "event-a" } }));
  await f.service.associateEvidence(f.ctx, { references: [{ kind: "operation", id: "event-operation" }] });
  const update = { ...original, requiredEffect: { ...original.requiredEffect, toolName: "household_calendar_update" } };
  await f.call("task.checkpoint", { phase: "working", summary: "Correct time", nextAction: "Update", outcomes: [update] });
  const before = await f.service.snapshot(f.ctx);
  assert.equal(before.handoff!.outcomes[0].requirementAuthority, "owner"); assert.deepEqual(before.handoff!.verifications, {});
  for (const change of [{ retireOutcomeIds: ["event"] },
    { outcomes: [{ ...update, requiredEffect: { ...update.requiredEffect, resourceId: "event-b" } }] },
    { outcomes: [{ ...update, requiredEffect: { ...update.requiredEffect, state: "provisional" as const } }] }])
    await assert.rejects(() => f.service.complete(f.ctx, { summary: "Revise plan", planRevisionReason: "Internal correction", ...change }), /task_outcome_change_requires_steering/);
  assert.equal(f.revision(), before.checkpoint!.revision);
});

test("fresh human-bound requirements cannot be retired as model drafts", async () => {
  const f = fixture(), outcome = { id: "report", description: "Prepare report", evidenceKind: "artifact" };
  await f.call("task.checkpoint", { phase: "working", summary: "Plan", nextAction: "Build", outcomes: [outcome] });
  const human = f.reply("Keep this report as a required result.");
  await f.call("task.bind_reply", { questionArtifactId: null, relation: "steer", affectedOutcomeIds: ["report"] }, human);
  const next = { ...human, source: { id: "continuation-c", text: "Continue", sha256: sha("Continue"), human: false } };
  await assert.rejects(() => f.service.complete(next, { summary: "Retire draft", planRevisionReason: "Internal replan", retireOutcomeIds: ["report"] }), /task_outcome_change_requires_steering/);
  assert.equal((await f.service.snapshot(next)).handoff!.outcomes[0].requirementAuthority, "human");
});

test("a uniquely owner-bound target cannot be redirected through an omitted original resource hint", async () => {
  const f = fixture(), outcome = { id: "event", description: "Requested event exists", evidenceKind: "operation" as const,
    requiredEffect: { toolName: "household_calendar_create", state: "committed" as const } };
  await f.call("task.checkpoint", { phase: "working", summary: "Create", nextAction: "Check", outcomes: [outcome] });
  f.ports.evidence = async (_ctx, refs) => refs.map(ref => ({ ...ref, verified: true, digest: sha(ref.id), summary: "Actual owner event", provenance: "owner",
    effect: { toolName: "household_calendar_create", state: "committed", resourceId: "owner-event-a" } }));
  await f.service.associateEvidence(f.ctx, { references: [{ kind: "operation", id: "operation-a" }] });
  assert.equal((await f.service.snapshot(f.ctx)).handoff!.outcomes[0].boundResourceId, "owner-event-a");
  await assert.rejects(() => f.service.complete(f.ctx, { summary: "Redirect", planRevisionReason: "Model replan", outcomes: [
    { ...outcome, requiredEffect: { ...outcome.requiredEffect, resourceId: "other-event" } },
  ] }), /task_outcome_change_requires_steering/);
});

test("unissued explicit operation IDs return real owner candidates without persisting the invalid proposal", async () => {
  const f = fixture(); f.receipts.set("actual-operation", "owner-state");
  const definition = { description: "Requested event exists", evidenceKind: "operation" as const, requiredEffect: { toolName: "household_calendar_create", state: "committed" as const } };
  const pending = await f.service.complete(f.ctx, { summary: "Done", outcomes: [{ ...definition, references: [{ kind: "operation", id: "made-up-read-operation" }] }] }, [{ kind: "operation", id: "actual-operation" }]);
  assert.equal(pending.state, "evidence_required"); if (pending.state !== "evidence_required") throw Error("Expected pending");
  assert.equal(pending.rejectedEvidenceCount, 1); assert.equal(pending.rejectedEvidence![0].code, "task_evidence_unverified");
  assert.deepEqual(pending.evidenceCandidates.map(item => item.id), ["actual-operation"]);
  assert.equal(f.revision(), 0); assert.equal((await f.service.snapshot(f.ctx)).handoff, null);
  assert.equal((await f.service.complete(f.ctx, { summary: "Done", outcomes: [{ ...definition, references: [{ kind: "operation", id: "actual-operation" }] }] })).state, "ready_for_native_completion");
});

test("corrective proof feedback never softens authority or unexpected owner errors", async () => {
  for (const code of ["domain_authority_revoked", "different_not_found_error"]) {
    const f = fixture(); f.ports.evidence = async () => { throw Object.assign(Error(code), { code, httpStatus: 404 }); };
    await assert.rejects(() => f.service.complete(f.ctx, { summary: "Done", references: [{ kind: "operation", id: "foreign-operation" }] }), new RegExp(code));
    assert.equal(f.revision(), 0);
  }
});

test("the scoped owner catalog rejects read-tool operation requirements before persistence", async () => {
  const f = fixture(); f.ports.operationToolNames = () => ["household_calendar_create"];
  const read = { id: "read", description: "Read current calendar", evidenceKind: "operation" as const, requiredEffect: { toolName: "household_calendar_list", state: "committed" as const } };
  await assert.rejects(() => f.call("task.checkpoint", { phase: "working", summary: "Invalid draft", nextAction: "Finish", outcomes: [read] }), /task_operation_tool_not_receipted/);
  const pending = await f.service.complete(f.ctx, { summary: "Read complete", outcomes: [read] });
  assert.equal(pending.state, "evidence_required"); if (pending.state !== "evidence_required") throw Error("Expected pending");
  assert.deepEqual(pending.outcomeIssues, [{ outcomeId: "read", code: "task_operation_tool_not_receipted" }]);
  assert.equal(f.revision(), 0);
});

test("automatic output candidates cannot cross the original task binding", async () => {
  const f = fixture();
  const foreign = await f.ports.artifacts.put({ ...f.ctx.scope, taskId: "other-goal" }, f.ctx.principal, {
    bytes: Buffer.from("Actual output of another goal"), mimeType: "text/plain", filename: "other-goal.txt", kind: "output", idempotencyKey: "other-goal-output" });
  f.ports.evidence = async (context, refs) => Promise.all(refs.map(ref => verifyTaskArtifact(context, ref.id, f.ports.artifacts)));
  await assert.rejects(() => f.service.complete(f.ctx, { summary: "Report done", outcomes: [{ description: "Requested report", evidenceKind: "artifact" }] },
    [{ kind: "artifact", id: foreign.id }]), /task_evidence_binding_mismatch/);
  assert.equal(f.revision(), 0); assert.equal((await f.service.snapshot(f.ctx)).handoff, null);
});

test("a completed no-goal handoff archives safely for a fresh human prompt with CAS history retained", async () => {
  const f = fixture();
  f.ctx.native.goalId = null; f.ctx.native.goalStatus = null;
  f.ctx.scope.taskId = "conversation:" + f.ctx.scope.conversationId;
  await f.call("task.checkpoint", { phase: "working", summary: "Creating event", nextAction: "Verify event", outcomes: [
    { id: "event", description: "Event created", evidenceKind: "operation", requiredEffect: { toolName: "household_calendar_create", state: "committed" } },
  ] });
  f.receipts.set("event-operation", "event:source-id:revision-1");
  await f.call("task.verify_outcome", { outcomeId: "event", references: [{ kind: "operation", id: "event-operation" }] });
  await f.call("task.finish", { summary: "Created event" });
  const old = await f.service.snapshot(f.ctx), next = f.reply("Add bread to our shopping list");
  const restored = await f.service.snapshot(next);
  assert.equal(restored.resetPending, true); assert.equal(restored.handoff, null);
  assert.equal(restored.archivedHandoff!.artifactId, old.checkpoint!.checkpointArtifactId);
  assert.equal(restored.checkpoint!.revision, old.checkpoint!.revision);
  await f.call("task.checkpoint", { phase: "planning", summary: "New list request", nextAction: "Select lists", outcomes: [] }, next);
  const current = await f.service.snapshot(next);
  assert.equal(current.handoff!.originalSourcePromptId, next.source.id);
  assert.equal(current.handoff!.objective, next.source.text);
  assert.equal(current.handoff!.previousArtifactId, old.checkpoint!.checkpointArtifactId);
  assert.equal(current.handoff!.terminal, null); assert.deepEqual(current.handoff!.verifications, {});
  assert.equal(JSON.parse(f.objects.get(old.checkpoint!.checkpointArtifactId!)!.bytes.toString("utf8")).terminal, "complete");
});


test("fresh owner business state is rechecked even when its receipt digest is unchanged", async () => {
  const f = fixture(); let accepted = true;
  f.ports.evidence = async (_context, refs) => refs.map(ref => ({ ...ref, verified: true, digest: sha("stable-receipt"), summary: "Current financial disposition", provenance: "owner",
    effect: { toolName: "household_receipts_candidate_accept", state: accepted ? "accepted" : "provisional", resourceId: "receipt-a" } }));
  await f.call("task.checkpoint", { phase: "working", summary: "Accept receipt", nextAction: "Verify", outcomes: [{ id: "receipt", description: "Receipt accepted", evidenceKind: "operation",
    requiredEffect: { toolName: "household_receipts_candidate_accept", state: "accepted", resourceId: "receipt-a" } }] });
  await f.service.associateEvidence(f.ctx, { references: [{ kind: "operation", id: "accept-operation" }] }); accepted = false;
  await assert.rejects(() => f.service.complete(f.ctx, { summary: "Accepted" }), /task_evidence_changed/);
  assert.equal((await f.service.snapshot(f.ctx)).handoff!.terminal, null);
});


test("ordinary clarification is durable without a native goal or copied CAS fields",async()=>{
  const f=fixture(),context={...f.ctx,scope:{...f.ctx.scope,taskId:"conversation:conversation-a"},native:{...f.ctx.native,goalId:null,goalStatus:null,objective:null}};
  await f.service.execute("task.ask_question",{question:"Which day?",reason:"The date is missing"},context);
  const restored=new TaskFlowService(f.ports),before=await restored.snapshot(context);
  assert.equal(before.question?.nativeGoalId,null);
  const reply={...context,source:{id:"fresh-human-date",text:"Friday",sha256:sha("Friday"),human:true}};
  await restored.execute("task.bind_reply",{relation:"answer"},reply);
  assert.equal((await restored.snapshot(reply)).question,null);
  assert.equal(await finalizeTask(restored,reply),undefined);
});

test("independent same-chat actions cannot supply proof or completion for the retained task",async()=>{
  const f=fixture();
  await f.call("task.checkpoint",{phase:"working",summary:"Event waiting",nextAction:"Ask date",outcomes:[{id:"event",description:"Create event",evidenceKind:"operation",requiredEffect:{toolName:"household_calendar_create",state:"committed"}}]});
  await f.service.execute("task.ask_question",{question:"Which date?",reason:"Date is missing"},f.ctx);
  const side=f.reply("Also add a separate event for Saturday");
  await f.service.execute("task.bind_reply",{relation:"new_topic"},side);
  f.receipts.set("side-event-operation","separate-event");
  assert.equal((await f.service.associateEvidence(side,{references:[{kind:"operation",id:"side-event-operation"}]})).state,"unmatched");
  await assert.rejects(()=>f.service.complete(side,{summary:"Done"},[{kind:"operation",id:"side-event-operation"}]),/independent_topic_cannot_complete_waiting_task/);
  assert.equal((await finalizeTask(f.service,side))?.action,"finalize");
  const after=await f.service.snapshot(side);
  assert.equal(after.question?.text,"Which date?");
  assert.deepEqual(after.handoff?.verifications,{});
  const later={...side,source:{id:"human-return",text:"Monday for the original event",sha256:sha("Monday for the original event"),human:true}};
  await f.service.execute("task.bind_reply",{relation:"answer"},later);
  assert.equal((await f.service.snapshot(later)).question,null);
});


test("an independent topic can clarify, survive restart and restore the original question",async()=>{
  const f=fixture();
  await f.service.execute("task.ask_question",{question:"Which project for the receipt?",reason:"Project missing"},f.ctx);
  const original=(await f.service.snapshot(f.ctx)).checkpoint!.questionArtifactId;
  const side=f.reply("Add a separate event, but I have not chosen its time");
  await f.service.execute("task.bind_reply",{relation:"new_topic"},side);
  await f.service.execute("task.ask_question",{question:"What time for the separate event?",reason:"Time missing"},side);
  const restarted=new TaskFlowService(f.ports),waiting=await restarted.snapshot(side);
  assert.equal(waiting.suspendedQuestions?.[0].artifactId,original);
  assert.equal(waiting.question?.independentTopicOf,"goal-a");
  const answer={...side,source:{id:"side-time-answer",text:"At noon",sha256:sha("At noon"),human:true}};
  await restarted.execute("task.bind_reply",{relation:"answer"},answer);
  const restored=await restarted.snapshot(answer);
  assert.equal(restored.question?.text,"Which project for the receipt?");
  assert.equal(restored.currentReply?.independentTopicOf,"goal-a");
  assert.equal(restored.suspendedQuestions?.length,0);
  await assert.rejects(()=>restarted.complete(answer,{summary:"Event saved"}),/independent_topic_cannot_complete_waiting_task/);
  const returnToOriginal={...side,source:{id:"original-project-answer",text:"Use the playground project",sha256:sha("Use the playground project"),human:true}};
  await restarted.execute("task.bind_reply",{relation:"answer"},returnToOriginal);
  assert.equal((await restarted.snapshot(returnToOriginal)).currentReply?.independentTopicOf,undefined);
});

test("explicit question selection returns to a suspended topic without discarding the active question",async()=>{
  const f=fixture();
  await f.service.execute("task.ask_question",{question:"Which original project?",reason:"Project missing"},f.ctx);
  const original=(await f.service.snapshot(f.ctx)).checkpoint!.questionArtifactId;
  const side=f.reply("Make another event");
  await f.service.execute("task.bind_reply",{relation:"new_topic"},side);
  await f.service.execute("task.ask_question",{question:"Which time for the other event?",reason:"Time missing"},side);
  const answer={...side,source:{id:"explicit-original-answer",text:"For the original question, playground",sha256:sha("For the original question, playground"),human:true}};
  await f.service.execute("task.bind_reply",{relation:"answer",questionArtifactId:original},answer);
  const state=await f.service.snapshot(answer);
  assert.equal(state.question,null);
  assert.equal(state.currentReply?.independentTopicOf,undefined);
  assert.equal(state.suspendedQuestions?.[0].question.text,"Which time for the other event?");
});


test("completion infers omitted mechanical effect only from a unique eligible inline owner receipt",async()=>{
  const f=fixture();f.ports.operationToolNames=()=>["household_calendar_create"];
  f.ports.evidence=async(_ctx,refs)=>refs.map(ref=>({...ref,verified:true,digest:sha(ref.id),summary:"Owner event saved",provenance:"owner",effect:{toolName:"household_calendar_create",state:"committed",resourceId:"owner-event"}}));
  const result=await f.service.complete(f.ctx,{summary:"Requested event exists",outcomes:[{description:"Requested event exists",evidenceKind:"operation",references:[{kind:"operation",id:"actual-owner-operation"}]}]});
  assert.equal(result.state,"ready_for_native_completion");const outcome=(await f.service.snapshot(f.ctx)).handoff!.outcomes[0];
  assert.deepEqual(outcome.requiredEffect,{toolName:"household_calendar_create",state:"committed",resourceId:"owner-event"});assert.equal(outcome.requirementAuthority,"owner");
});

test("omitted completion requirements never infer from automatic, ambiguous or mixed references",async()=>{
  for(const refs of [undefined,[{kind:"operation" as const,id:"first"},{kind:"operation" as const,id:"second"}],[{kind:"operation" as const,id:"first"},{kind:"artifact" as const,id:"report"}]]){
    const f=fixture();f.receipts.set("first","owner-first");f.receipts.set("second","owner-second");f.receipts.set("report","owner-report");
    const pending=await f.service.complete(f.ctx,{summary:"Result",outcomes:[{description:"Requested result",evidenceKind:"operation",...(refs?{references:refs}:{})}]},[{kind:"operation",id:"first"}]);
    assert.equal(pending.state,"evidence_required");if(pending.state!=="evidence_required")throw Error("Expected pending");
    assert.equal(pending.outcomeIssues![0].code,"task_operation_requirement_required");assert.equal(f.revision(),0);
  }
});

test("scoped inline proof rejection returns only eligible owner facts without persisting the proposal",async()=>{
  for(const code of ["task_evidence_source_mismatch","task_evidence_binding_mismatch"]){
    const f=fixture();f.ports.evidence=async(_ctx,refs)=>refs.map(ref=>{
      if(ref.id==="side-topic-operation")throw Object.assign(Error("Foreign receipt content must not appear"),{code});
      return {...ref,verified:true,digest:sha(ref.id),summary:"Current requested event",provenance:"owner",effect:{toolName:"household_calendar_create",state:"committed",resourceId:"current-event"}};
    });
    const pending=await f.service.complete(f.ctx,{summary:"Done",outcomes:[{description:"Unrelated side result",evidenceKind:"operation",references:[{kind:"operation",id:"side-topic-operation"}]}]},[{kind:"operation",id:"actual-operation"}]);
    assert.equal(pending.state,"evidence_required");if(pending.state!=="evidence_required")throw Error("Expected pending");
    assert.equal(pending.rejectedEvidence![0].code,code);assert.deepEqual(pending.evidenceCandidates.map(item=>item.id),["actual-operation"]);
    assert.doesNotMatch(JSON.stringify(pending),/Foreign receipt content/);assert.equal(f.revision(),0);assert.equal((await f.service.snapshot(f.ctx)).handoff,null);
  }
});

test("omitting an established completion requirement cannot redirect its owner-bound resource",async()=>{
  const f=fixture();const outcome={id:"event",description:"Requested event",evidenceKind:"operation" as const,requiredEffect:{toolName:"household_calendar_create",state:"committed" as const,resourceId:"original-event"}};
  await f.call("task.checkpoint",{phase:"working",summary:"Original request",nextAction:"Verify",outcomes:[outcome]});
  f.ports.evidence=async(_ctx,refs)=>refs.map(ref=>({...ref,verified:true,digest:sha(ref.id),summary:"Owner event",provenance:"owner",effect:{toolName:"household_calendar_create",state:"committed",resourceId:ref.id==="original-operation"?"original-event":"other-event"}}));
  await f.service.associateEvidence(f.ctx,{outcomeId:"event",references:[{kind:"operation",id:"original-operation"}]});const before=await f.service.snapshot(f.ctx);
  const pending=await f.service.complete(f.ctx,{summary:"Redirected",outcomes:[{id:"event",description:"Requested event",evidenceKind:"operation",references:[{kind:"operation",id:"other-operation"}]}]});
  assert.equal(pending.state,"evidence_required");if(pending.state!=="evidence_required")throw Error("Expected pending");assert.equal(pending.rejectedEvidence![0].code,"task_evidence_requirement_mismatch");
  assert.deepEqual(await f.service.snapshot(f.ctx),before);
});

test("fabricated inline proof cannot infer a requirement from a different eligible candidate",async()=>{
  const f=fixture();f.receipts.set("actual-operation","current-owner-state");
  const pending=await f.service.complete(f.ctx,{summary:"Done",outcomes:[{description:"Requested event",evidenceKind:"operation",references:[{kind:"operation",id:"fabricated-operation"}]}]},[{kind:"operation",id:"actual-operation"}]);
  assert.equal(pending.state,"evidence_required");if(pending.state!=="evidence_required")throw Error("Expected pending");assert.equal(pending.rejectedEvidence![0].code,"task_evidence_unverified");assert.equal(f.revision(),0);
});
