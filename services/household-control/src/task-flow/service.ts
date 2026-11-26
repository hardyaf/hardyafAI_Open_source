import { createHash } from "node:crypto";
import { PlatformError } from "../platform/errors.ts";
import type { TaskCompletion, TaskCompletionInput, TaskEvidenceAssociation, TaskEvidenceDescription, TaskEvidenceRef, TaskEffectRequirement, TaskFlowContext, TaskFlowPorts, TaskHandoff, TaskOutcome, TaskQuestion, TaskReply, TaskSnapshot, VerifiedTaskEvidence } from "./types.ts";

type Json = Record<string, unknown>;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const fail = (code: string): never => { throw new PlatformError(code, 409); };
function text(value: unknown, max = 4000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) return fail("task_text_invalid");
  return value;
}
function sameBinding(context: TaskFlowContext, metadata: { ownerProfileId: string; conversationId: string; taskId: string; audience: string }): boolean {
  return metadata.ownerProfileId === context.scope.ownerProfileId && metadata.conversationId === context.scope.conversationId &&
    metadata.taskId === context.scope.taskId && metadata.audience === context.scope.audience;
}
function outcomes(value: unknown): TaskOutcome[] {
  if (!Array.isArray(value) || value.length > 40) return fail("task_outcomes_invalid");
  const result = value.map(item => {
    const row = object(item), id = text(row.id, 128), description = text(row.description);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id) || !["operation", "artifact"].includes(String(row.evidenceKind))) return fail("task_outcomes_invalid");
    const outcome = { id, description, evidenceKind: row.evidenceKind } as TaskOutcome;
    if (row.requiredEffect !== undefined) {
      const effect = object(row.requiredEffect);
      if (typeof effect.toolName !== "string" || !/^[a-z][a-z0-9_.]{1,95}$/.test(effect.toolName) ||
        !["committed", "accepted", "provisional", "excluded"].includes(String(effect.state)) ||
        effect.resourceId !== undefined && !hasBoundedText(effect.resourceId, 200)) fail("task_effect_requirement_invalid");
      outcome.requiredEffect = { toolName: effect.toolName, state: effect.state as "committed", ...(effect.resourceId !== undefined ? { resourceId: String(effect.resourceId) } : {}) };
    }
    if (outcome.evidenceKind === "operation" && !outcome.requiredEffect) fail("task_operation_requirement_required");
    return outcome;
  });
  if (new Set(result.map(item => item.id)).size !== result.length) return fail("task_outcomes_invalid");
  return result;
}
function hasBoundedText(value: unknown, max: number): boolean { return typeof value === "string" && value.trim().length > 0 && value.length <= max; }
function strategyRefinement(previous: TaskOutcome, next: TaskOutcome): boolean {
  const before = previous.requiredEffect, after = next.requiredEffect;
  const domain = (name: string) => /^household_([a-z0-9]+)_/.exec(name)?.[1];
  if (previous.id !== next.id || previous.evidenceKind !== next.evidenceKind) return false;
  if (previous.evidenceKind === "artifact") return JSON.stringify(before) === JSON.stringify(after);
  return !!before && !!after && before.state === after.state && !!domain(before.toolName) && domain(before.toolName) === domain(after.toolName) &&
    (before.resourceId === undefined && previous.boundResourceId === undefined ||
      (before.resourceId ?? previous.boundResourceId) === (after.resourceId ?? previous.boundResourceId));
}
function satisfies(outcome: TaskOutcome, evidence: VerifiedTaskEvidence[]): boolean {
  if (!evidence.some(item => item.kind === outcome.evidenceKind)) return false;
  if (outcome.evidenceKind === "operation" && !outcome.requiredEffect) return false;
  const required = outcome.requiredEffect;
  const resourceId = required?.resourceId ?? outcome.boundResourceId;
  return !required || evidence.some(item => item.kind === "operation" && item.effect?.toolName === required.toolName && item.effect?.state === required.state &&
    (resourceId === undefined || item.effect?.resourceId === resourceId || item.effect?.resourceIds?.includes(resourceId)));
}
function bindOwnerRequirement(outcome: TaskOutcome, evidence: VerifiedTaskEvidence[]): void {
  outcome.requirementAuthority ??= "owner";
  if (outcome.evidenceKind !== "operation" || outcome.boundResourceId !== undefined) return;
  const matching = evidence.filter(item => item.effect?.toolName === outcome.requiredEffect?.toolName && item.effect?.state === outcome.requiredEffect?.state);
  const resources = new Set(matching.flatMap(item => [item.effect?.resourceId, ...(item.effect?.resourceIds ?? [])].filter((id): id is string => typeof id === "string")));
  if (outcome.requiredEffect?.resourceId !== undefined && resources.has(outcome.requiredEffect.resourceId)) outcome.boundResourceId = outcome.requiredEffect.resourceId;
  else if (resources.size === 1) outcome.boundResourceId = [...resources][0];
}
function requirementAuthority(state: TaskHandoff, outcome: TaskOutcome): TaskOutcome["requirementAuthority"] {
  return outcome.requirementAuthority ?? (state.verifications[outcome.id]?.length ? "owner" : undefined);
}
function mergeOutcomes(state: TaskHandoff, added: TaskOutcome[], steering?: TaskReply, planRevisionReason?: string): void {
  for (const item of added) {
    const existing = state.outcomes.find(outcome => outcome.id === item.id);
    if (existing && state.verifications[item.id]?.length) bindOwnerRequirement(existing, state.verifications[item.id]);
    const authority = existing && requirementAuthority(state, existing), steered = steering?.affectedOutcomeIds.includes(item.id);
    if (steered || authority) item.requirementAuthority = steered ? "human" : authority;
    if (!steered && existing?.boundResourceId !== undefined) item.boundResourceId = existing.boundResourceId;
    item.intent = existing ? steering?.affectedOutcomeIds.includes(item.id) ? item.description : existing.intent ?? existing.description : item.description;
    if (existing && JSON.stringify(existing) !== JSON.stringify(item)) {
      if (!strategyRefinement(existing, item) && !steered && (authority || !planRevisionReason)) fail("task_outcome_change_requires_steering");
      const proofChanged = existing.evidenceKind !== item.evidenceKind || JSON.stringify(existing.requiredEffect) !== JSON.stringify(item.requiredEffect);
      Object.assign(existing, item); if (item.requiredEffect === undefined) delete existing.requiredEffect;
      if (steered && item.boundResourceId === undefined) delete existing.boundResourceId;
      if (proofChanged) delete state.verifications[item.id];
    }
    if (!existing) state.outcomes.push(item);
  }
  if (state.outcomes.length > 40) fail("task_outcomes_invalid");
}
function retireOutcomes(state: TaskHandoff, value: unknown, steering?: TaskReply, planRevisionReason?: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > 40 || value.some(id => typeof id !== "string")) fail("task_outcomes_invalid");
  for (const id of value) {
    const outcome = state.outcomes.find(item => item.id === id);
    if (!outcome) fail("task_outcome_unknown");
    if (!steering?.affectedOutcomeIds.includes(id) && (requirementAuthority(state, outcome) || !planRevisionReason)) fail("task_outcome_change_requires_steering");
  }
  const retired = new Set(value);
  state.outcomes = state.outcomes.filter(item => !retired.has(item.id));
  for (const id of retired) delete state.verifications[String(id)];
}
function references(value: unknown, limit = 20): TaskEvidenceRef[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > limit) return fail("task_evidence_invalid");
  return value.map(item => {
    const row = object(item);
    if (!["operation", "artifact"].includes(String(row.kind))) return fail("task_evidence_invalid");
    return { kind: row.kind, id: text(row.id, 200) } as TaskEvidenceRef;
  });
}
function completionOutcomes(value: unknown, previous: TaskOutcome[], inferred: ReadonlyMap<number,TaskEffectRequirement> = new Map()) {
  if (!Array.isArray(value) || value.length > 40) return fail("task_outcomes_invalid");
  const attached = new Map<string, TaskEvidenceRef[]>();
  const definitions = value.map((raw,index) => {
    const row = object(raw), item = outcomes([{ ...row, ...(row.requiredEffect===undefined&&inferred.has(index)?{requiredEffect:inferred.get(index)}:{}), id: row.id === undefined ? "completion" : row.id }])[0];
    if (row.id === undefined) {
      const matching = previous.filter(old => (old.description === item.description || old.intent === item.description) &&
        old.evidenceKind === item.evidenceKind && JSON.stringify(old.requiredEffect) === JSON.stringify(item.requiredEffect));
      item.id = matching.length === 1 ? matching[0].id : "outcome-" + digest([item.description, item.evidenceKind, item.requiredEffect ?? null]).slice(0, 24);
    }
    if (row.references !== undefined) attached.set(item.id, references(row.references));
    return item;
  });
  if (new Set(definitions.map(item => item.id)).size !== definitions.length) fail("task_outcomes_invalid");
  return { definitions, attached };
}
const unavailableCandidateCodes = new Set(["task_evidence_unverified", "task_artifact_not_outcome_evidence", "task_evidence_integrity_failed",
  "artifact_not_found", "artifact_integrity_failed", "artifact_storage_invalid", "artifact_storage_unavailable"]);

/** Application orchestration only. Native OpenClaw owns goals, children, turns and wakeups. */
export class TaskFlowService {
  private readonly ports: TaskFlowPorts;
  constructor(ports: TaskFlowPorts) { this.ports = ports; }

  private assert(context: TaskFlowContext): void {
    context.assertCurrent();
    if (!context.native.sessionId || !context.native.runId || !context.source.id ||
      !/^[a-f0-9]{64}$/.test(context.source.sha256) ||
      createHash("sha256").update(context.source.text).digest("hex") !== context.source.sha256 ||
      context.principal.profileId !== context.scope.ownerProfileId &&
      !(context.scope.audience === "household" && context.principal.canReadHousehold)) fail("task_authority_invalid");
  }
  private async readJson(context: TaskFlowContext, id: string, kind: string): Promise<Json> {
    this.assert(context);
    const item = await this.ports.artifacts.read(id, context.principal);
    const filename = kind === "task_handoff" ? "task-handoff.json" : "task-question.json";
    if (!sameBinding(context, item.metadata) || item.metadata.kind !== "evidence" || item.metadata.filename !== filename ||
      item.metadata.mimeType !== "application/json" || item.bytes.length > 128 * 1024) fail("task_artifact_binding_invalid");
    const value = object(JSON.parse(item.bytes.toString("utf8")));
    if (value.schemaVersion !== 1 || value.kind !== kind || value.nativeSessionId !== context.native.sessionId ||
      value.nativeGoalId !== context.native.goalId) fail("task_artifact_binding_invalid");
    return value;
  }
  async snapshot(context: TaskFlowContext): Promise<TaskSnapshot> {
    this.assert(context);
    const checkpoint = await this.ports.checkpoints.get(context);
    if (checkpoint && (checkpoint.nativeSessionId !== context.native.sessionId || checkpoint.nativeGoalId !== context.native.goalId)) fail("task_checkpoint_binding_invalid");
    const handoff = checkpoint?.checkpointArtifactId ? await this.readJson(context, checkpoint.checkpointArtifactId, "task_handoff") as TaskHandoff : null;
    const resetPending = !!handoff && context.native.goalId === null && handoff.terminal === "complete" && handoff.phase === "complete" &&
      !handoff.questionArtifactId && !checkpoint!.questionArtifactId && context.source.human === true &&
      handoff.originalSourcePromptId !== context.source.id;
    if (handoff && (handoff.taskId !== context.scope.taskId || handoff.mode !== context.mode && !resetPending || handoff.phase !== checkpoint!.phase ||
      handoff.questionArtifactId !== checkpoint!.questionArtifactId || !Array.isArray(handoff.outcomes) || !Array.isArray(handoff.selectedDomains))) fail("task_checkpoint_binding_invalid");
    if (resetPending) return { checkpoint, handoff: null, question: null, currentReply: null, replyQuestion: null,
      resetPending: true, archivedHandoff: { artifactId: checkpoint!.checkpointArtifactId!, originalSourcePromptId: handoff!.originalSourcePromptId, terminal: "complete" } };
    const question = checkpoint?.questionArtifactId ? await this.readJson(context, checkpoint.questionArtifactId, "task_question") as TaskQuestion : null;
    const currentReply = handoff?.replies.find(reply => reply.sourcePromptId === context.source.id) ?? null;
    const replyQuestion = currentReply?.questionArtifactId ? await this.readJson(context, currentReply.questionArtifactId, "task_question") as TaskQuestion : null;
    const suspendedIds = handoff?.suspendedQuestionArtifactIds ?? [];
    if (!Array.isArray(suspendedIds) || suspendedIds.length > 32 || new Set(suspendedIds).size !== suspendedIds.length || suspendedIds.includes(handoff?.questionArtifactId ?? "")) fail("task_question_stack_invalid");
    const suspendedQuestions = await Promise.all(suspendedIds.map(async artifactId => ({ artifactId, question: await this.readJson(context, artifactId, "task_question") as TaskQuestion })));
    return { checkpoint, handoff, question, currentReply, replyQuestion, suspendedQuestions };
  }
  private initial(context: TaskFlowContext): TaskHandoff {
    return { schemaVersion: 1, kind: "task_handoff", nativeSessionId: context.native.sessionId, nativeGoalId: context.native.goalId,
      taskId: context.scope.taskId, objective: context.native.goalId ? context.native.objective ?? context.source.text : context.source.text,
      originalSourcePromptId: context.source.id, originalSourceSha256: context.source.sha256, mode: context.mode,
      selectedDomains: [], phase: "planning", summary: "", nextAction: "Declare required user outcomes, select matching domains and execute authorized work.",
      outcomes: [], verifications: {}, questionArtifactId: null, replies: [], previousArtifactId: null, terminal: null };
  }
  private async save(context: TaskFlowContext, previous: TaskSnapshot, state: TaskHandoff, expectedRevision: unknown) {
    this.assert(context);
    this.assertWrite(context);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== (previous.checkpoint?.revision ?? 0)) fail("task_checkpoint_conflict");
    state.previousArtifactId = previous.checkpoint?.checkpointArtifactId ?? null;
    const bytes = Buffer.from(JSON.stringify(state));
    if (bytes.length > 96 * 1024) fail("task_handoff_too_large");
    const artifact = await this.put(context, {
      bytes, mimeType: "application/json", filename: "task-handoff.json", kind: "evidence",
      idempotencyKey: "task-handoff:" + digest([context.native.sessionId, context.native.goalId, expectedRevision, state]),
    });
    this.assert(context);
    const checkpoint = await this.ports.checkpoints.update(context, { nativeSessionId: context.native.sessionId,
      nativeGoalId: context.native.goalId, expectedRevision: Number(expectedRevision), phase: state.phase,
      checkpointArtifactId: artifact.id, questionArtifactId: state.questionArtifactId });
    return { checkpoint, handoff: state };
  }
  private put(context: TaskFlowContext, input: Parameters<TaskFlowPorts["artifacts"]["put"]>[2]) {
    this.assert(context); this.assertWrite(context);
    return this.ports.writeArtifact ? this.ports.writeArtifact(context, input) : this.ports.artifacts.put(context.scope, context.principal, input);
  }
  private assertWrite(context: TaskFlowContext): void {
    if (context.principal.profileId !== context.scope.ownerProfileId &&
      !(context.scope.audience === "household" && context.contribution?.canWrite === true &&
        context.contribution.actorProfileId === context.principal.profileId)) fail("task_shared_contribution_not_authorized");
  }
  private async verified(context: TaskFlowContext, refs: TaskEvidenceRef[]): Promise<VerifiedTaskEvidence[]> {
    this.assert(context);
    const result = await this.ports.evidence(context, refs);
    this.assert(context);
    if (result.length !== refs.length || result.some((item, i) => item.kind !== refs[i].kind || item.id !== refs[i].id ||
      item.verified !== true || !/^[a-f0-9]{64}$/.test(item.digest) || !item.provenance || !item.summary || item.summary.length > 2000 ||
      item.effect?.resourceIds !== undefined && (!Array.isArray(item.effect.resourceIds) || item.effect.resourceIds.length > 200 ||
        item.effect.resourceIds.some(id => !hasBoundedText(id, 200)) || new Set(item.effect.resourceIds).size !== item.effect.resourceIds.length))) fail("task_evidence_unverified");
    return result;
  }
  async domainContexts(context: TaskFlowContext, value: unknown) {
    this.assert(context);
    if (!Array.isArray(value) || !value.length || value.length > 16 || value.some(id => typeof id !== "string")) fail("task_domains_invalid");
    const catalog = await this.ports.catalog(context), selected = catalog.filter(domain => value.includes(domain.id));
    this.assert(context);
    if (selected.length !== value.length) fail("task_domain_not_authorized");
    return selected.map(({ id, instructions, tools }) => ({ id, instructions, tools }));
  }
  async canComplete(context: TaskFlowContext): Promise<boolean> {
    try { this.assertWrite(context); } catch { return false; }
    const { handoff, question } = await this.snapshot(context);
    if (!handoff || handoff.terminal !== "complete" || question || handoff.suspendedQuestionArtifactIds?.length || !handoff.outcomes.length) return false;
    try { await this.verifyAll(context, handoff); return true; } catch { return false; }
  }
  private async candidateProofs(context: TaskFlowContext, evidenceCandidates: TaskEvidenceRef[]) {
    this.assert(context);
    const verified: VerifiedTaskEvidence[] = []; let unavailableEvidenceCount = 0;
    if (!Array.isArray(evidenceCandidates) || evidenceCandidates.length > 100) fail("task_evidence_candidates_invalid");
    const refs = evidenceCandidates.length ? references(evidenceCandidates, 100) : [], seen = new Set<string>();
    for (const ref of refs) {
      const key = ref.kind + ":" + ref.id; if (seen.has(key)) continue; seen.add(key);
      try { verified.push(...await this.verified(context, [ref])); }
      catch (error) {
        this.assert(context);
        const failure = error as { code?: unknown; statusCode?: number; httpStatus?: number };
        if (!unavailableCandidateCodes.has(String(failure.code)) && failure.statusCode !== 404 && failure.httpStatus !== 404) throw error;
        unavailableEvidenceCount++;
      }
    }
    return { verified, unavailableEvidenceCount };
  }
  private evidenceDescription(verified: VerifiedTaskEvidence[], unavailableEvidenceCount: number): TaskEvidenceDescription {
    return { evidenceCandidates: verified.map(({ kind, id, summary, effect }) => ({ kind, id, summary: summary.slice(0, 240), ...(effect ? { effect } : {}) })), unavailableEvidenceCount };
  }
  /** Read-only projection of refs supplied by the current-goal owner; never declares outcomes or checkpoints. */
  async describeEvidence(context: TaskFlowContext, refs: TaskEvidenceRef[]): Promise<TaskEvidenceDescription> {
    const { verified, unavailableEvidenceCount } = await this.candidateProofs(context, refs);
    return this.evidenceDescription(verified, unavailableEvidenceCount);
  }
  private async operationIssues(context: TaskFlowContext, outcomes: TaskOutcome[]) {
    if (!this.ports.operationToolNames) return [];
    const tools = new Set(await this.ports.operationToolNames(context)); this.assert(context);
    return outcomes.filter(item => item.evidenceKind === "operation" && !tools.has(item.requiredEffect!.toolName))
      .map(item => ({ outcomeId: item.id, code: "task_operation_tool_not_receipted" as const }));
  }
  private async verifyAll(context: TaskFlowContext, state: TaskHandoff): Promise<void> {
    if (!state.outcomes.length || state.questionArtifactId || state.suspendedQuestionArtifactIds?.length) fail("task_outcomes_incomplete");
    for (const outcome of state.outcomes) {
      const saved = state.verifications[outcome.id];
      if (!saved?.length || !satisfies(outcome, saved)) fail("task_outcomes_incomplete");
      await this.reverifyOutcome(context, outcome, saved);
    }
  }
  private async reverifyOutcome(context: TaskFlowContext, outcome: TaskOutcome, saved: VerifiedTaskEvidence[]): Promise<void> {
    const current = await this.verified(context, saved.map(({ kind, id }) => ({ kind, id })));
    if (current.some((item, index) => item.digest !== saved[index].digest) || !satisfies(outcome, current)) fail("task_evidence_changed");
  }
  /** Associate an already-committed owner receipt without making Main copy checkpoint revisions.
   * Ambiguity is explicit: an unbound receipt is never assigned merely to the next unfinished item.
   */
  async associateEvidence(context: TaskFlowContext, input: { references: TaskEvidenceRef[]; outcomeId?: string }): Promise<TaskEvidenceAssociation> {
    this.assert(context); this.assertWrite(context);
    const previous = await this.snapshot(context), state = previous.handoff && structuredClone(previous.handoff);
    const revision = previous.checkpoint?.revision ?? 0;
    if (previous.currentReply?.relation === "new_topic" || previous.currentReply?.independentTopicOf) return { state: "unmatched", outcomeIds: [], revision };
    if (!state?.outcomes.length) return { state: "not_declared", outcomeIds: [], revision };
    const verified = await this.verified(context, references(input.references));
    const candidates = input.outcomeId === undefined ? state.outcomes.filter(item => satisfies(item, verified))
      : state.outcomes.filter(item => item.id === input.outcomeId);
    if (input.outcomeId !== undefined && !candidates.length) fail("task_outcome_unknown");
    if (input.outcomeId !== undefined && !satisfies(candidates[0], verified)) fail("task_evidence_requirement_mismatch");
    if (!candidates.length) return { state: "unmatched", outcomeIds: [], revision };
    if (candidates.length !== 1) return { state: "ambiguous", outcomeIds: candidates.map(item => item.id), revision };
    const outcome = candidates[0], saved = state.verifications[outcome.id];
    if (saved && JSON.stringify(saved) === JSON.stringify(verified)) return { state: "already_associated", outcomeIds: [outcome.id], revision };
    if (state.terminal) fail("task_already_complete");
    state.verifications[outcome.id] = verified;
    bindOwnerRequirement(outcome, verified);
    const result = await this.save(context, previous, state, revision);
    return { state: "associated", outcomeIds: [outcome.id], revision: result.checkpoint.revision };
  }
  /** One model-facing completion request; native lifecycle remains with the injected application. */
  async complete(context: TaskFlowContext, input: TaskCompletionInput, evidenceCandidates: TaskEvidenceRef[] = []): Promise<TaskCompletion> {
    this.assert(context); this.assertWrite(context);
    const summary = text(input.summary), previous = await this.snapshot(context), state = structuredClone(previous.handoff ?? this.initial(context));
    if (previous.currentReply?.relation === "new_topic" || previous.currentReply?.independentTopicOf) fail("independent_topic_cannot_complete_waiting_task");
    if (input.outcomeId !== undefined && input.references === undefined) fail("task_completion_references_required");
    const planRevisionReason = input.planRevisionReason === undefined ? undefined : text(input.planRevisionReason, 2000);
    const before = JSON.stringify(state), { verified: candidates, unavailableEvidenceCount } = await this.candidateProofs(context, evidenceCandidates);
    const description = this.evidenceDescription(candidates, unavailableEvidenceCount);
    const steering = state.replies.find(reply => reply.sourcePromptId === context.source.id && reply.relation === "steer");
    const rejectedEvidence: Array<TaskEvidenceRef & { outcomeId?: string; code: string }> = [];
    const outcomeIssues: Array<{outcomeId:string;code:"task_operation_tool_not_receipted"|"task_operation_requirement_required"}> = [];
    const proof = async (refs: TaskEvidenceRef[], outcomeId?: string) => {
      const verified: VerifiedTaskEvidence[] = []; let rejected = false;
      for (const ref of refs) {
        try { verified.push(...await this.verified(context, [ref])); }
        catch (error) {
          this.assert(context);
          const code = String((error as { code?: unknown }).code);
          // Reject proposed metadata without weakening its owner/source boundary.
          // Current authority failures and unexpected owner errors remain hard.
          if (!unavailableCandidateCodes.has(code)&&!["task_evidence_source_mismatch","task_evidence_binding_mismatch"].includes(code)) throw error;
          rejected = true; rejectedEvidence.push({ ...ref, ...(outcomeId ? { outcomeId } : {}), code });
        }
      }
      return rejected ? null : verified;
    };
    const pending = async (reason: "outcomes_required" | "evidence_required", persist = true): Promise<TaskCompletion> => {
      let revision = previous.checkpoint?.revision ?? 0;
      const shown = persist ? state : previous.handoff ?? this.initial(context);
      if (persist && JSON.stringify(state) !== before) revision = (await this.save(context, previous, state, revision)).checkpoint.revision;
      return { state: reason, nativeGoalId: context.native.goalId, revision, outcomes: shown.outcomes,
        missingOutcomeIds: shown.outcomes.filter(item => !shown.verifications[item.id]?.length || !satisfies(item, shown.verifications[item.id])).map(item => item.id),
        questionArtifactId: shown.questionArtifactId,
        instruction: rejectedEvidence.length || outcomeIssues.length
          ? "Correct the proposed proof using the eligible current owner facts below. Rejected references cannot complete this task. Independently bound requests belong to their own results and cannot become outcomes of the original task. Invalid proposals were not persisted. Supply a unique eligible inline receipt to infer omitted mechanical requiredEffect, or specify an exact requirement when ambiguous. Never invent IDs, combine resource IDs or repeat delivered effects. Revise or explicitly retire only unverified drafts with planRevisionReason, preserving the actual user request and all owner/human-bound requirements."
          : reason === "outcomes_required" ? "Declare only the original task's actual requested results with description and evidenceKind. IDs are optional. A unique verified inline owner operation receipt can supply omitted mechanical requiredEffect. Read results issue no committed operation receipts; unrelated independent requests are separate results."
          : shown.questionArtifactId || shown.suspendedQuestionArtifactIds?.length ? "A bound human question is still open. Resolve that question before completing this original task."
          : "Use the verified facts to identify each actual original user result. Supply exact owner resources or inline references where association is ambiguous; read observations need no fabricated operation outcome. Correct unverified draft requirements with planRevisionReason when necessary; do not repeat delivered effects.",
        ...description,
        ...(rejectedEvidence.length ? { rejectedEvidence: rejectedEvidence.slice(0, 20), rejectedEvidenceCount: rejectedEvidence.length } : {}),
        ...(outcomeIssues.length ? { outcomeIssues } : {}) };
    };
    const explicitRefs = input.references === undefined ? null : references(input.references);
    const explicitProof = explicitRefs ? await proof(explicitRefs, input.outcomeId) : null;
    const inferred=new Map<number,TaskEffectRequirement>();
    if(input.outcomes!==undefined){
      if(!Array.isArray(input.outcomes)||input.outcomes.length>40)fail("task_outcomes_invalid");
      for(const [index,raw] of input.outcomes.entries()){
        const row=object(raw);if(row.evidenceKind!=="operation"||row.requiredEffect!==undefined)continue;
        const existing=state.outcomes.filter(item=>item.evidenceKind==="operation"&&(row.id!==undefined?item.id===row.id:item.description===row.description||item.intent===row.description));
        if(existing.length===1&&existing[0].requiredEffect){inferred.set(index,structuredClone(existing[0].requiredEffect));continue;}
        const label=typeof row.id==="string"?row.id:"proposed-outcome-"+(index+1);
        const verified=row.references===undefined?null:await proof(references(row.references),label);
        const operations=new Map((verified??[]).filter(item=>item.kind==="operation"&&item.effect).map(item=>[item.id,item]));
        if(operations.size===1&&new Set((verified??[]).map(item=>item.kind+":"+item.id)).size===1){
          const effect=[...operations.values()][0].effect!,resources=[...new Set([effect.resourceId,...(effect.resourceIds??[])].filter((id):id is string=>typeof id==="string"))];
          inferred.set(index,{toolName:effect.toolName,state:effect.state,...(resources.length===1?{resourceId:resources[0]}:{})});
        }else outcomeIssues.push({outcomeId:label,code:"task_operation_requirement_required"});
      }
    }
    if(rejectedEvidence.length||outcomeIssues.length)return pending("evidence_required",false);
    const inline = input.outcomes === undefined ? { definitions: [], attached: new Map<string, TaskEvidenceRef[]>() } : completionOutcomes(input.outcomes, state.outcomes,inferred);
    // Keep an established requirement bound even if a later strategy change clears its current proof.
    for (const outcome of state.outcomes) if (state.verifications[outcome.id]?.length) bindOwnerRequirement(outcome, state.verifications[outcome.id]);
    const originalOutcomes = JSON.stringify(state.outcomes);
    retireOutcomes(state, input.retireOutcomeIds, steering, planRevisionReason);
    mergeOutcomes(state, inline.definitions, steering, planRevisionReason);
    if (state.terminal && JSON.stringify(state.outcomes) !== originalOutcomes) fail("task_already_complete");
    if (planRevisionReason) state.lastPlanRevision = { reason: planRevisionReason, sourcePromptId: context.source.id };
    const inlineProofs = new Map<string, VerifiedTaskEvidence[]>();
    for (const [id, refs] of inline.attached) { const verified = await proof(refs, id); if (verified) inlineProofs.set(id, verified); }
    outcomeIssues.push(...await this.operationIssues(context, state.outcomes));
    if (rejectedEvidence.length || outcomeIssues.length) return pending("evidence_required", false);
    if (!previous.handoff?.outcomes.length && state.outcomes.length && !state.terminal && !state.questionArtifactId) {
      state.phase = "verification"; state.nextAction = "Map current owning evidence to the declared user results and call household_task_complete. Do not repeat delivered effects.";
      if (!state.summary) state.summary = "User results declared; owning evidence verification is pending.";
    }
    if (!state.outcomes.length) return pending("outcomes_required");
    const attach = async (outcome: TaskOutcome, verified: VerifiedTaskEvidence[]) => {
      if (!satisfies(outcome, verified)) {
        for(const {kind,id} of verified)rejectedEvidence.push({kind,id,outcomeId:outcome.id,code:"task_evidence_requirement_mismatch"});
        return;
      }
      if (state.terminal && JSON.stringify(state.verifications[outcome.id]) !== JSON.stringify(verified)) fail("task_evidence_changed");
      state.verifications[outcome.id] = verified; bindOwnerRequirement(outcome, verified);
    };
    for (const [id, verified] of inlineProofs) await attach(state.outcomes.find(item => item.id === id)!, verified);
    if (explicitRefs && explicitProof) {
      const matching = input.outcomeId === undefined ? state.outcomes.filter(item => satisfies(item, explicitProof)) : state.outcomes.filter(item => item.id === input.outcomeId);
      if (!matching.length) for(const ref of explicitRefs)rejectedEvidence.push({...ref,...(input.outcomeId?{outcomeId:input.outcomeId}:{}),code:input.outcomeId === undefined ? "task_evidence_requirement_mismatch" : "task_outcome_unknown"});
      if (matching.length === 1) await attach(matching[0], explicitProof);
    }
    if(rejectedEvidence.length)return pending("evidence_required",false);
    for (const outcome of state.outcomes) {
      if (state.verifications[outcome.id]?.length) continue;
      const matching = candidates.filter(item => satisfies(outcome, [item]));
      if (matching.length === 1 && state.outcomes.filter(item => satisfies(item, [matching[0]])).length === 1) {
        state.verifications[outcome.id] = [matching[0]]; bindOwnerRequirement(outcome, [matching[0]]);
      }
    }
    for (const outcome of state.outcomes) if (state.verifications[outcome.id]?.length && satisfies(outcome, state.verifications[outcome.id]))
      await this.reverifyOutcome(context, outcome, state.verifications[outcome.id]);
    if (state.questionArtifactId || state.suspendedQuestionArtifactIds?.length || state.outcomes.some(item => !state.verifications[item.id]?.length || !satisfies(item, state.verifications[item.id]))) return pending("evidence_required");
    const result = state.terminal === "complete" ? { checkpoint: previous.checkpoint!, handoff: state }
      : await this.save(context, previous, { ...state, summary, phase: "complete", terminal: "complete",
        nextAction: context.native.goalId ? "Complete the original native goal using the verified completion receipt." : "Report the verified outcomes." }, previous.checkpoint?.revision ?? 0);
    return { state: "ready_for_native_completion", nativeGoalId: context.native.goalId, revision: result.checkpoint.revision,
      summary: result.handoff.summary, outcomes: result.handoff.outcomes.map(item => ({ id: item.id, intent: item.intent ?? item.description, description: item.description,
        references: result.handoff.verifications[item.id].map(({ kind, id }) => ({ kind, id })) })) };
  }
  async execute(name: string, args: unknown, context: TaskFlowContext): Promise<unknown> {
    this.assert(context);
    if (name === "task.complete") return this.complete(context, object(args) as TaskCompletionInput);
    const input = { ...object(args) }, previous = await this.snapshot(context), state = structuredClone(previous.handoff ?? this.initial(context));
    if (["task.ask_question", "task.bind_reply"].includes(name)) input.expectedRevision ??= previous.checkpoint?.revision ?? 0;
    if (name === "task.bind_reply" && input.questionArtifactId === undefined) input.questionArtifactId = state.questionArtifactId ?? (state.suspendedQuestionArtifactIds?.length === 1 ? state.suspendedQuestionArtifactIds[0] : null);
    if (name === "task.context") return { ...previous, revision: previous.checkpoint?.revision ?? 0,
      domains: (await this.ports.catalog(context)).map(({ id, description, tools }) => ({ id, description, tools })),
      sourcePromptId: context.source.id, mode: context.mode, nativeGoal: context.native,
      policy: "native_goal_and_checkpoint_artifacts_only_no_shadow_task_ledger" };
    if (name === "task.select_domains" && !context.native.goalId) {
      const contexts = await this.domainContexts(context, input.domains);
      return { ephemeral: true, selectedDomains: contexts.map(domain => domain.id), contexts, revision: previous.checkpoint?.revision ?? 0 };
    }
    this.assertWrite(context);
    if (state.terminal) {
      if (name !== "task.verify_outcome") fail("task_already_complete");
      // A failed native completion recheck may need current evidence; never deadlock recovery.
      state.terminal = null; state.phase = "verification";
    }
    const independentTopicOf = previous.currentReply?.independentTopicOf ?? (previous.currentReply?.relation === "new_topic" ? context.scope.taskId : undefined);
    if (independentTopicOf && !["task.bind_reply", "task.select_domains", "task.ask_question"].includes(name)) fail("independent_topic_cannot_mutate_waiting_task");
    const refiningQuestion = name === "task.ask_question" && (previous.currentReply?.relation === "ambiguous" || independentTopicOf !== undefined);
    if (state.questionArtifactId && !["task.bind_reply", "task.select_domains"].includes(name) && !refiningQuestion) fail("task_reply_binding_required");
    if (name === "task.select_domains") {
      const selected = await this.domainContexts(context, input.domains);
      state.selectedDomains = selected.map(domain => domain.id);
      const expectedRevision = input.expectedRevision ?? previous.checkpoint?.revision ?? 0;
      if (expectedRevision !== (previous.checkpoint?.revision ?? 0)) fail("task_checkpoint_conflict");
      const unchanged = previous.handoff && JSON.stringify(previous.handoff.selectedDomains) === JSON.stringify(state.selectedDomains);
      return { ...(unchanged ? { checkpoint: previous.checkpoint, handoff: state } : await this.save(context, previous, state, expectedRevision)),
        contexts: selected.map(({ id, instructions, tools }) => ({ id, instructions, tools })) };
    }
    if (name === "task.checkpoint") {
      state.phase = text(input.phase, 80);
      if (["waiting_for_user", "complete"].includes(state.phase)) fail("task_reserved_phase");
      state.summary = text(input.summary); state.nextAction = text(input.nextAction);
      const steering = state.replies.find(reply => reply.sourcePromptId === context.source.id && reply.relation === "steer");
      const planRevisionReason = input.planRevisionReason === undefined ? undefined : text(input.planRevisionReason, 2000);
      retireOutcomes(state, input.retireOutcomeIds, steering, planRevisionReason);
      if (input.outcomes !== undefined) {
        mergeOutcomes(state, outcomes(input.outcomes), steering, planRevisionReason);
      }
      if ((await this.operationIssues(context, state.outcomes)).length) fail("task_operation_tool_not_receipted");
      if (planRevisionReason) state.lastPlanRevision = { reason: planRevisionReason, sourcePromptId: context.source.id };
    } else if (name === "task.ask_question") {
      let question: TaskQuestion = { schemaVersion: 1, kind: "task_question", text: text(input.question), reason: text(input.reason),
        sourcePromptId: context.source.id, nativeSessionId: context.native.sessionId, nativeGoalId: context.native.goalId };
      question.questionType = (input.questionType ?? "clarification") as TaskQuestion["questionType"];
      if (independentTopicOf) {
        question.independentTopicOf = independentTopicOf;
        question.independentSourcePromptId = previous.currentReply?.independentSourcePromptId ?? context.source.id;
      }
      if (!["clarification", "approval", "receipt_review"].includes(String(question.questionType))) fail("task_question_type_invalid");
      if (input.focus !== undefined) question.focus = structuredClone(input.focus) as TaskQuestion["focus"];
      if (input.approval !== undefined) question.approval = structuredClone(input.approval) as TaskQuestion["approval"];
      if (question.questionType !== "clarification" || question.focus || question.approval) {
        if (!this.ports.validateQuestion) fail("task_question_resource_policy_required");
        const validated = await this.ports.validateQuestion(context, structuredClone(question));
        this.assert(context);
        if (validated.kind !== "task_question" || validated.sourcePromptId !== context.source.id || validated.nativeSessionId !== context.native.sessionId ||
          validated.nativeGoalId !== context.native.goalId || validated.questionType !== question.questionType) fail("task_question_binding_invalid");
        question = validated;
      }
      if (question.questionType === "approval" && !question.approval) fail("task_question_approval_target_required");
      if (input.choices !== undefined) {
        if (!Array.isArray(input.choices) || input.choices.length > 8) fail("task_choices_invalid");
        question.choices = input.choices.map(item => text(item, 300));
      }
      const saved = await this.put(context, { bytes: Buffer.from(JSON.stringify(question)),
        mimeType: "application/json", filename: "task-question.json", kind: "evidence",
        idempotencyKey: "task-question:" + digest([input.expectedRevision, question]) });
      if (independentTopicOf && state.questionArtifactId && state.questionArtifactId !== saved.id) {
        state.suspendedQuestionArtifactIds ??= [];
        if (!state.suspendedQuestionArtifactIds.includes(state.questionArtifactId)) state.suspendedQuestionArtifactIds.push(state.questionArtifactId);
        if (state.suspendedQuestionArtifactIds.length > 32) fail("task_question_stack_limit");
      }
      state.questionArtifactId = saved.id; state.phase = "waiting_for_user"; state.nextAction = "Wait for a human prompt, then bind its relation to this question before further work.";
      return { ...await this.save(context, previous, state, input.expectedRevision), question,
        nativeGoalAction: "keep_active_do_not_pause_or_resume", awaitingHuman: true };
    } else if (name === "task.bind_reply") {
      if (context.source.human !== true) fail("task_fresh_human_prompt_required");
      if (!["answer", "steer", "new_topic", "ambiguous"].includes(String(input.relation))) fail("task_reply_target_invalid");
      const selectedSuspended = previous.suspendedQuestions?.find(item => item.artifactId === input.questionArtifactId);
      const targetQuestion = input.questionArtifactId === state.questionArtifactId ? previous.question : selectedSuspended?.question;
      if (input.questionArtifactId !== state.questionArtifactId && !selectedSuspended) fail("task_reply_target_invalid");
      if (selectedSuspended) {
        state.suspendedQuestionArtifactIds = (state.suspendedQuestionArtifactIds ?? []).filter(id => id !== selectedSuspended.artifactId);
        if (state.questionArtifactId) state.suspendedQuestionArtifactIds.push(state.questionArtifactId);
        state.questionArtifactId = selectedSuspended.artifactId;
      }
      if ([state.originalSourcePromptId, targetQuestion?.sourcePromptId].includes(context.source.id)) fail("task_fresh_human_prompt_required");
      const affected = input.affectedOutcomeIds ?? [];
      if (!Array.isArray(affected) || affected.some(id => typeof id !== "string" || !state.outcomes.some(outcome => outcome.id === id))) fail("task_steering_outcome_invalid");
      if (state.replies.some(reply => reply.sourcePromptId === context.source.id)) fail("task_reply_already_bound");
      const reply: TaskReply = { sourcePromptId: context.source.id, sourceSha256: context.source.sha256,
        questionArtifactId: state.questionArtifactId, relation: input.relation as "answer", affectedOutcomeIds: affected as string[], actorProfileId: context.principal.profileId,
        ...(input.relation === "new_topic" ? { independentTopicOf: context.scope.taskId, independentSourcePromptId: context.source.id } : targetQuestion?.independentTopicOf ? { independentTopicOf: targetQuestion.independentTopicOf, independentSourcePromptId: targetQuestion.independentSourcePromptId ?? targetQuestion.sourcePromptId } : {}) };
      if (input.decision !== undefined) {
        if (!["approve", "reject"].includes(String(input.decision)) || !["answer", "steer"].includes(String(input.relation)) ||
          !targetQuestion || !["approval", "receipt_review"].includes(String(targetQuestion.questionType)) || !this.ports.validateReply) fail("task_reply_decision_not_authorized");
        reply.decision = input.decision as "approve";
        await this.ports.validateReply(context, targetQuestion!, reply);
        this.assert(context);
      }
      state.replies.push(reply);
      // Prior immutable handoffs retain full provenance; keep the live projection compact.
      state.replies = state.replies.slice(-20);
      if (["answer", "steer"].includes(String(input.relation))) {
        if (input.relation === "answer" && !state.questionArtifactId) fail("task_question_required");
        state.questionArtifactId = reply.independentTopicOf ? state.suspendedQuestionArtifactIds?.pop() ?? null : null;
        state.phase = state.questionArtifactId ? "waiting_for_user" : "working";
        state.nextAction = reply.independentTopicOf ? "Finish the independent human prompt, then wait. The restored original question remains pending." : "Reason from the current human prompt in the original task context; clarify any new uncertainty.";
        if (reply.independentTopicOf && affected.length) fail("independent_topic_cannot_steer_waiting_task");
        for (const id of affected as string[]) {
          const outcome = state.outcomes.find(item => item.id === id)!;
          if (state.verifications[id]?.length) bindOwnerRequirement(outcome, state.verifications[id]);
          outcome.requirementAuthority = input.relation === "steer" ? "human" : requirementAuthority(state, outcome);
          delete state.verifications[id];
        }
      }
      return { ...await this.save(context, previous, state, input.expectedRevision),
        currentHumanPrompt: context.source.text, disposition: input.relation,
        instructions: input.relation === "new_topic" ? "The old question is retained. Fulfill this independent prompt in the same conversation using authorized tools. Its effects belong to this fresh source and must not satisfy, alter or complete the waiting original goal. Report the independent result, then wait; a later reply can return to the original question." :
          input.relation === "ambiguous" ? "Ask a focused freeform follow-up; retain the original question and make no uncertain effects." : "The prompt is ordinary task steering; do not restrict it to the offered choices." };
    } else if (name === "task.verify_outcome") {
      const outcome = state.outcomes.find(item => item.id === input.outcomeId);
      if (!outcome) fail("task_outcome_unknown");
      const verified = await this.verified(context, references(input.references));
      if (!satisfies(outcome, verified)) fail("task_evidence_requirement_mismatch");
      state.verifications[outcome.id] = verified;
      bindOwnerRequirement(outcome, verified);
    } else if (name === "task.finish") {
      await this.verifyAll(context, state);
      state.summary = text(input.summary); state.phase = "complete"; state.terminal = "complete";
      state.nextAction = context.native.goalId
        ? "Complete the original native goal and report each delivered user outcome with its evidence and remaining limitations."
        : "Report this admitted prompt's delivered outcomes and evidence. No current native goal is bound; do not modify an archived completed goal returned by native history/status.";
    } else fail("task_tool_unavailable");
    return this.save(context, previous, state, input.expectedRevision);
  }
}
