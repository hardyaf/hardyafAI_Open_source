import type { MessageTaskContext } from "./request-context.ts";
export type HouseholdRole = "admin" | "adult" | "child";
export type ProfileStatus = "available" | "working" | "queued" | "paused" | "offline";
export type Capability = "chat" | "voiceInput" | "attachImages" | "viewHouseholdStatus" | "viewDiagnostics" | "manageAccess";

export type FamilyProfile = {
  id: string; displayName: string; initials: string; agentId: string; role: HouseholdRole;
  color: string; status: ProfileStatus; statusDetail: string; capabilities: Capability[];
};
export type PromptPreset = { id: string; label: string; description: string; allowedRoles: HouseholdRole[] };
export type ConversationFolder = {id:string;name:string;createdAt:string;updatedAt:string};
export type Conversation = {
  id: string; ownerProfileId: string; agentId: string; sessionKey: string; title: string; tags?: string[]; folderId?:string|null; deletedAt?:string|null;
  presetId: string | null; audience: "private" | "household"; updatedAt: string;
};
export type ChatMessage = { id: string; conversationId: string; role: "user" | "assistant" | "system"; text: string; createdAt: string };

export type SubmissionReceipt = {
  submissionId: string; conversationId: string; profileId: string; agentId: string;
  status: "dispatching" | "running" | "queued" | "complete" | "failed" | "cancelled" | "waiting_for_user";
  queuePosition: number | null; runId: string | null;
  failureCode?: string | null; recoveryRequired?: boolean; attemptCount?: number; goalId?: string | null;
};
export type HouseholdAgentEvent = {
  sessionKey: string; runId: string | null; phase: "changed" | "complete" | "failed" | "cancelled";
};
export type HouseholdAgentRunState = {
  status: "queued" | "running" | "complete" | "failed" | "cancelled" | "unknown";
  runId: string | null; updatedAt: string | null;
  continuationPending?: boolean; goalId?: string; sessionId?: string; phase?: string;
};
export type HouseholdSnapshot = {
  maxActiveRuns: number; activeRuns: number; queuedRuns: number; recoveryRequiredRuns?: number;
  profiles: Array<Pick<FamilyProfile, "id" | "displayName" | "initials" | "color" | "status" | "statusDetail">>;
};
export type HouseholdGoal = {
  id: string; objective: string;
  status: "active" | "paused" | "blocked" | "usage_limited" | "budget_limited" | "complete";
  updatedAt: number;
};
export type ConversationActivity = "idle" | "queued" | "dispatching" | "running";
export type HouseholdConversationContext = {
  sessionKey: string; sessionId: string | null; goal: HouseholdGoal | null; runId: string | null;
  continuationPending: boolean; parentSessionKey: string | null;
  contextTokens: number | null; contextBudgetStatus: string | null;
};
export type HouseholdNativeProgress = {
  sessionKey: string; revision: number; updatedAt: number; markdown?: string;
  steps?: Array<{ step: string; status: "pending" | "in_progress" | "completed" }>;
};
export type HouseholdCheckpoint = {
  conversationId: string; nativeSessionId: string; nativeGoalId: string | null; revision: number;
  phase: string; questionArtifactId: string | null; checkpointArtifactId: string | null; updatedAt: string;
};
export type HouseholdCheckpointUpdate = {
  nativeSessionId: string; nativeGoalId: string | null; expectedRevision: number; phase: string;
  questionArtifactId?: string | null; checkpointArtifactId?: string | null;
};
export type HouseholdGoalMutation = {
  goalId: string; operationId: string; issuedAtMs: number;
  action: "edit" | "pause" | "resume" | "block" | "complete" | "clear";
  objective?: string; note?: string;
};
export type HouseholdGoalMutationResult = { goalId: string; runId: string | null; status: string; replayed: boolean; receipt?: SubmissionReceipt };
export type HouseholdNativeContext = { page: string; title?: string; selection?: string };
export type HouseholdSubmitMessage = {
  conversation: Conversation; profile: FamilyProfile; text: string; submissionId: string;
  shouldQueue: boolean; queuePosition: number | null;
  nativeContext?: HouseholdNativeContext; goalStart?: { issuedAtMs: number }; taskContext?: MessageTaskContext;
  /** Trusted service fence; never accepted from HTTP or persisted. */
  assertAdmission?: () => void;
};

export interface HouseholdAgentAdapter {
  readonly mode: "mock" | "openclaw";
  ensureConversation(conversation: Conversation): Promise<void>;
  listMessages(conversation: Conversation): Promise<ChatMessage[]>;
  submitMessage(args: HouseholdSubmitMessage): Promise<SubmissionReceipt>;
  getRunState(conversation: Conversation, expectedRunId?: string, expectedGoalId?: string): Promise<HouseholdAgentRunState>;
  /** Exact submitted turn observation without borrowing another goal's continuation. */
  getExactRunState?(conversation:Conversation,expectedRunId:string):Promise<HouseholdAgentRunState>;
  getContext?(conversation: Conversation): Promise<HouseholdConversationContext>;
  getProgress?(conversation: Conversation): Promise<HouseholdNativeProgress | null>;
  mutateGoal?(conversation: Conversation, operation: HouseholdGoalMutation, assertAdmission?: () => void): Promise<HouseholdGoalMutationResult>;
  cancel(conversation: Conversation, runId?: string): Promise<void>;
  onEvent(listener: (event: HouseholdAgentEvent) => void): () => void;
  diagnostics(): Promise<{ status: string; detail?: string }>;
  close(): Promise<void>;
}
