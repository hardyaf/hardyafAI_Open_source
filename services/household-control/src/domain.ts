export type HouseholdRole = "admin" | "adult" | "child";

export type ProfileStatus = "available" | "working" | "queued" | "paused" | "offline";

export type Capability =
  | "chat"
  | "voiceInput"
  | "attachImages"
  | "viewHouseholdStatus"
  | "viewDiagnostics"
  | "manageAccess";

export type FamilyProfile = {
  id: string;
  displayName: string;
  initials: string;
  agentId: string;
  role: HouseholdRole;
  color: string;
  status: ProfileStatus;
  statusDetail: string;
  capabilities: Capability[];
};

export type PromptPreset = {
  id: string;
  label: string;
  description: string;
  allowedRoles: HouseholdRole[];
};

export type Conversation = {
  id: string;
  ownerProfileId: string;
  agentId: string;
  sessionKey: string;
  title: string;
  presetId: string | null;
  audience: "private" | "household";
  updatedAt: string;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt: string;
};

export type SubmissionReceipt = {
  submissionId: string;
  conversationId: string;
  profileId: string;
  agentId: string;
  status: "dispatching" | "running" | "queued" | "complete" | "failed" | "cancelled";
  queuePosition: number | null;
  runId: string | null;
};

export type HouseholdAgentEvent = {
  sessionKey: string;
  runId: string | null;
  phase: "changed" | "complete" | "failed" | "cancelled";
};

export type HouseholdAgentRunState = {
  status: "queued" | "running" | "complete" | "failed" | "cancelled" | "unknown";
  runId: string | null;
  updatedAt: string | null;
};

export type HouseholdSnapshot = {
  maxActiveRuns: number;
  activeRuns: number;
  queuedRuns: number;
  profiles: Array<Pick<FamilyProfile, "id" | "displayName" | "initials" | "color" | "status" | "statusDetail">>;
};

export interface HouseholdAgentAdapter {
  readonly mode: "mock" | "openclaw";
  ensureConversation(conversation: Conversation): Promise<void>;
  listMessages(conversation: Conversation): Promise<ChatMessage[]>;
  submitMessage(args: {
    conversation: Conversation;
    profile: FamilyProfile;
    text: string;
    submissionId: string;
    shouldQueue: boolean;
    queuePosition: number | null;
  }): Promise<SubmissionReceipt>;
  getRunState(conversation: Conversation): Promise<HouseholdAgentRunState>;
  cancel(conversation: Conversation, runId?: string): Promise<void>;
  onEvent(listener: (event: HouseholdAgentEvent) => void): () => void;
  diagnostics(): Promise<{ status: string; detail?: string }>;
  close(): Promise<void>;
}
