import type { DomainTool } from "../domain-runtime/common.ts";

const text = { type: "string", minLength: 1, maxLength: 4000 };
const id = { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" };
const revision = { type: "integer", minimum: 0 };
const effect = { type: "object", additionalProperties: false, required: ["toolName", "state"], properties: {
  toolName: { type: "string", pattern: "^[a-z][a-z0-9_.]{1,95}$" }, state: { enum: ["committed", "accepted", "provisional", "excluded"] },
  resourceId: { type: "string", minLength: 1, maxLength: 200, description: "One exact owner-issued resource ID. Never concatenate IDs; use separate result declarations for separate resources." } } };
const outcome = { type: "object", additionalProperties: false, required: ["id", "description", "evidenceKind"],
  properties: { id, description: text, evidenceKind: { enum: ["operation", "artifact"] }, requiredEffect: effect } };
const reference = { type: "object", additionalProperties: false, required: ["kind", "id"],
  properties: { kind: { enum: ["operation", "artifact"] }, id: { type: "string", minLength: 1, maxLength: 200 } } };
const completionOutcome = { ...outcome, description: "One original-task user result. A unique verified inline operation receipt may supply omitted mechanical requiredEffect; existing owner/human requirements remain protected. Independently bound requests are separate results.", required: ["description", "evidenceKind"], properties: {
  ...outcome.properties, references: { type: "array", minItems: 1, maxItems: 20, items: reference } } };
const focus = { type: "object", additionalProperties: false, required: ["kind", "id"], properties: {
  kind: { enum: ["contact", "receipt", "wiki", "list_item", "calendar_event", "artifact"] }, id,
  revision: { type: "integer", minimum: 0 }, scope: { type: "string", minLength: 1, maxLength: 128 } } };
const approval = { type: "object", additionalProperties: false, required: ["toolName", "operationId", "resourceId"], properties: {
  toolName: { type: "string", pattern: "^[a-z][a-z0-9_]{1,63}$" }, operationId: id, resourceId: id,
  waivedReasons: { type: "array", maxItems: 20, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 128 } } } };
function tool(name: string, description: string, properties: Record<string, unknown>, required: string[], read = false): DomainTool {
  return { name, capability: "task", effect: read ? "read" : "write", description,
    inputSchema: { type: "object", additionalProperties: false, properties, required } };
}
/** Task metadata writes use checkpoint CAS, not a second effect/task ledger. */
export const taskToolDescriptors: DomainTool[] = [
  tool("task.context", "Read the current native goal's durable handoff, open question, revision and authorized domain index. Does not read another conversation or grant authority.", {}, [], true),
  tool("task.stop", "Honor a fresh human request to stop this current root task. Pauses or cancels only this exact native goal through the existing control authority; it does not undo effects or claim completion. Children, scheduled inputs and model continuations cannot authorize it.",
    { operationId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$" }, note: { type: "string", minLength: 1, maxLength: 2000 } }, ["operationId"]),
  tool("task.select_domains", "Load authorized domain instructions. No revision is needed: no-goal selection is ephemeral; active-goal selection uses internal checkpoint CAS. This never grants capabilities.",
    { expectedRevision: revision, domains: { type: "array", minItems: 1, maxItems: 16, uniqueItems: true, items: id } }, ["domains"]),
  tool("task.checkpoint", "Persist a phase handoff under the immutable original user request. Operation proof refers to actual receipt-producing writes, never read results or fabricated IDs. Unverified model drafts/resource hints can be corrected or explicitly retired with planRevisionReason; immutable history retains the reason. Owner/human-bound requirements stay protected and require fresh human steering for target/acceptance changes or retirement. Same-authority strategy changes reset affected proof; wording alone preserves it. A checkpoint is not evidence.",
    { expectedRevision: revision, phase: { type: "string", minLength: 1, maxLength: 80 }, summary: text, nextAction: text,
      outcomes: { type: "array", maxItems: 40, items: outcome }, retireOutcomeIds: { type: "array", maxItems: 40, uniqueItems: true, items: id },
      planRevisionReason: { type: "string", minLength: 1, maxLength: 2000 } }, ["expectedRevision", "phase", "summary", "nextAction"]),
  tool("task.ask_question", "Persist a follow-up question and wait for a normal freeform user reply in this conversation. No explicit goal or copied revision is needed. Choices are optional hints. An existing native goal stays active; no pause/resume ceremony. Execute independently clear brain-dump items first.",
    { expectedRevision: revision, question: text, reason: text, choices: { type: "array", maxItems: 8, items: { type: "string", minLength: 1, maxLength: 300 } },
      questionType: { enum: ["clarification", "approval", "receipt_review"] }, focus, approval },
    ["question", "reason"]),
  tool("task.bind_reply", "Interpret the current verified human prompt as an answer, task steering, new topic, or ambiguous reply. Uses the actual admitted prompt, never model-supplied reply text. A new topic preserves the outstanding question; a question is not a restricted form.",
    { expectedRevision: revision, questionArtifactId: { anyOf: [{ type: "string", pattern: "^artifact-[a-f0-9]{64}$" }, { type: "null" }] },
      relation: { enum: ["answer", "steer", "new_topic", "ambiguous"] }, affectedOutcomeIds: { type: "array", maxItems: 40, uniqueItems: true, items: id },
      decision: { enum: ["approve", "reject"] } },
    ["relation"]),
  tool("task.verify_outcome", "Attach actual owning-domain effects or scoped output artifacts to one declared outcome. Operation evidence must match its exact required tool/business state/resource. The service inspects references; model claims, child final prose and checkpoint text are not evidence.",
    { expectedRevision: revision, outcomeId: id, references: { type: "array", minItems: 1, maxItems: 20, items: reference } },
    ["expectedRevision", "outcomeId", "references"]),
  tool("task.finish", "Mark the handoff ready for native goal completion only after all declared user outcomes have current verified evidence and no question remains. Does not change native goal authority; call native update_goal complete only after this succeeds.",
    { expectedRevision: revision, summary: text }, ["expectedRevision", "summary"]),
  tool("task.complete", "Finish the original task with actual user results, not a record of every tool call. Operation proof uses committed write receipts shown in owner evidenceCandidates; reads issue no operation IDs. Never fabricate IDs or combine resource IDs. Outcomes may be declared here; IDs/revisions are automatic. A unique verified inline owner operation reference can supply omitted mechanical requiredEffect; existing requirements are preserved. Inline references resolve ambiguity. Exclude independently bound side requests from original-task outcomes. Rejected source/scope references return unfinished feedback with eligible evidence; correct the proposal without repeating effects. Correct unverified model draft requirements or explicitly retire them with planRevisionReason; owner/human-bound requirements remain protected. Omitted outcomes remain required. Pending outcomes_required/evidence_required returns current verified facts and is not success. Only verified readiness coordinates native completion.",
    { summary: text, outcomeId: id, references: { type: "array", minItems: 1, maxItems: 20, items: reference },
      outcomes: { type: "array", minItems: 1, maxItems: 40, items: completionOutcome },
      retireOutcomeIds: { type: "array", maxItems: 40, uniqueItems: true, items: id },
      planRevisionReason: { type: "string", minLength: 1, maxLength: 2000 } }, ["summary"]),
];
export const taskNativeNames = taskToolDescriptors.map(tool => "household_" + tool.name.replaceAll(".", "_"));
