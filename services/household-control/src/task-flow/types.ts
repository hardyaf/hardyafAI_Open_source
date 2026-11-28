import type { HouseholdCheckpoint, HouseholdCheckpointUpdate } from "../domain.ts";
import type { ArtifactInput, ArtifactMetadata, ArtifactPrincipal, ArtifactScope } from "../platform/artifacts.ts";

/** These values come from verified admission/native observations, never tool arguments. */
export type TaskFlowContext = {
  principal: ArtifactPrincipal;
  scope: ArtifactScope;
  native: { sessionId: string; sessionKey: string; goalId: string | null; goalStatus: string | null; objective: string | null; runId: string };
  source: { id: string; text: string; sha256: string; human?: boolean };
  mode: "normal" | "brain_dump" | "diagnostic";
  /** Restored by admission from the exact independent-topic source, never tool text. */
  independentSource?: { id: string; text: string; sha256: string; artifactIds: string[] };
  artifactIds: string[];
  /** Trusted same-shared-task contribution; never inferred from artifact visibility alone. */
  contribution?: { actorProfileId: string; canWrite: true };
  /** Content-free owning facts and scoped output handles from the last completed task; never authority. */
  previousOutcomes?: { effects: TaskEffectRequirement[]; artifactIds: string[] };
  assertCurrent(): void;
};
export type TaskDomain = { id: string; description: string; instructions: string; tools: string[] };
export type TaskEvidenceRef = { kind: "operation" | "artifact"; id: string };
export type TaskEffectRequirement = { toolName: string; state: "committed" | "accepted" | "provisional" | "excluded"; resourceId?: string };
/** Only an owning adapter may issue this projection after inspecting actual persisted/source state. */
export type VerifiedTaskEvidence = TaskEvidenceRef & {
  verified: boolean; digest: string; summary: string; provenance: string;
  effect?: TaskEffectRequirement & { resourceIds?: string[] };
};
export type TaskOutcome = { id: string; description: string;
  /** First declared intent retained by the application when display wording changes; never an authority grant. */
  intent?: string;
  /** Internal only: once human steering or owner proof binds a requirement, draft edits cannot release it. */
  requirementAuthority?: "human" | "owner";
  /** Exact target established by unique owner proof, never a model-provided resource hint. */
  boundResourceId?: string;
  evidenceKind: "operation" | "artifact";
  requiredEffect?: TaskEffectRequirement };
export type TaskEvidenceAssociation = {
  state: "associated" | "already_associated" | "ambiguous" | "unmatched" | "not_declared";
  outcomeIds: string[]; revision: number;
};
export type TaskCompletionOutcome = Omit<TaskOutcome, "id" | "intent" | "requirementAuthority" | "boundResourceId"> & { id?: string; references?: TaskEvidenceRef[] };
export type TaskCompletionInput = { summary: string; references?: TaskEvidenceRef[]; outcomeId?: string; outcomes?: TaskCompletionOutcome[];
  retireOutcomeIds?: string[]; planRevisionReason?: string };
export type TaskCompletionReady = { state: "ready_for_native_completion"; nativeGoalId: string | null;
  revision: number; summary: string; outcomes: Array<{ id: string; intent: string; description: string; references: TaskEvidenceRef[] }> };
export type TaskEvidenceDescription = { evidenceCandidates: Array<Pick<VerifiedTaskEvidence, "kind" | "id" | "summary" | "effect">>; unavailableEvidenceCount: number };
export type TaskCompletionPending = TaskEvidenceDescription & { state: "outcomes_required" | "evidence_required"; nativeGoalId: string | null;
  revision: number; outcomes: TaskOutcome[]; missingOutcomeIds: string[]; questionArtifactId: string | null; instruction: string;
  rejectedEvidence?: Array<TaskEvidenceRef & { outcomeId?: string; code: string }>;
  rejectedEvidenceCount?: number;
  outcomeIssues?: Array<{ outcomeId: string; code: "task_operation_tool_not_receipted" | "task_operation_requirement_required" }>;
};
export type TaskCompletion = TaskCompletionReady | TaskCompletionPending;
export type TaskQuestion = {
  schemaVersion: 1; kind: "task_question"; text: string; reason: string; sourcePromptId: string;
  nativeSessionId: string; nativeGoalId: string | null; choices?: string[];
  questionType?: "clarification" | "approval" | "receipt_review";
  focus?: { kind: "contact" | "receipt" | "wiki" | "list_item" | "calendar_event" | "artifact"; id: string; revision?: number; scope?: string };
  /** Application-assigned root task binding for an independent topic, never model input. */
  independentTopicOf?: string;
  independentSourcePromptId?: string;
  approval?: { toolName: string; operationId: string; resourceId: string; waivedReasons?: string[] };
};
export type TaskReply = { sourcePromptId: string; sourceSha256: string; questionArtifactId: string | null;
  relation: "answer" | "steer" | "new_topic" | "ambiguous"; affectedOutcomeIds: string[]; decision?: "approve" | "reject"; actorProfileId?: string; independentTopicOf?: string; independentSourcePromptId?: string };
export type TaskHandoff = {
  schemaVersion: 1; kind: "task_handoff";
  nativeSessionId: string; nativeGoalId: string | null; taskId: string;
  objective: string; originalSourcePromptId: string; originalSourceSha256: string;
  mode: TaskFlowContext["mode"]; selectedDomains: string[]; phase: string;
  summary: string; nextAction: string; outcomes: TaskOutcome[];
  verifications: Record<string, VerifiedTaskEvidence[]>;
  questionArtifactId: string | null; replies: TaskReply[];
  /** Existing question artifacts suspended by independent same-conversation topics. */
  suspendedQuestionArtifactIds?: string[];
  previousArtifactId: string | null; terminal: "complete" | null;
  lastPlanRevision?: { reason: string; sourcePromptId: string };
};
export type TaskSnapshot = { checkpoint: HouseholdCheckpoint | null; handoff: TaskHandoff | null; question: TaskQuestion | null;
  currentReply?: TaskReply | null; replyQuestion?: TaskQuestion | null;
  suspendedQuestions?: Array<{ artifactId: string; question: TaskQuestion }>;
  resetPending?: true; archivedHandoff?: { artifactId: string; originalSourcePromptId: string; terminal: "complete" } };
export type TaskFlowPorts = {
  checkpoints: {
    get(context: TaskFlowContext): Promise<HouseholdCheckpoint | null> | HouseholdCheckpoint | null;
    update(context: TaskFlowContext, value: HouseholdCheckpointUpdate): Promise<HouseholdCheckpoint> | HouseholdCheckpoint;
  };
  artifacts: {
    verify?(id: string, principal: ArtifactPrincipal, assertCurrent?: () => void): Promise<ArtifactMetadata>;
    read(id: string, principal: ArtifactPrincipal): Promise<{ metadata: ArtifactMetadata; bytes: Buffer }>;
    put(scope: ArtifactScope, principal: ArtifactPrincipal, input: ArtifactInput): Promise<ArtifactMetadata>;
  };
  catalog(context: TaskFlowContext): Promise<TaskDomain[]> | TaskDomain[];
  evidence(context: TaskFlowContext, refs: TaskEvidenceRef[]): Promise<VerifiedTaskEvidence[]>;
  /** Current scoped owning catalog's receipt-producing write tools, never a model-authored registry. */
  operationToolNames?(context: TaskFlowContext): Promise<readonly string[]> | readonly string[];
  /** Owning resource policy must validate non-clarification questions before they persist. */
  validateQuestion?(context: TaskFlowContext, question: TaskQuestion): Promise<TaskQuestion> | TaskQuestion;
  /** A decision requires a fresh verified human source plus current resource/goal/profile policy. */
  validateReply?(context: TaskFlowContext, question: TaskQuestion, reply: TaskReply): Promise<void> | void;
  /** Root adapter may authorize an explicit contributor then retain the original artifact owner. */
  writeArtifact?(context: TaskFlowContext, input: ArtifactInput): Promise<ArtifactMetadata>;
};
export type TaskFinalizeDecision = { action: "finalize" | "revise"; reason: string;
  retry?: { instruction: string; idempotencyKey: string; maxAttempts: number } };
