import { randomUUID } from "node:crypto";
import type {
  ChatMessage,
  Conversation,
  FamilyProfile,
  HouseholdAgentAdapter,
  HouseholdSnapshot,
  PromptPreset,
  SubmissionReceipt,
} from "./domain.ts";

export class HouseholdStore {
  readonly maxActiveRuns = 2;
  readonly adapterMode: HouseholdAgentAdapter["mode"];
  private readonly profiles: FamilyProfile[];
  private readonly presets: PromptPreset[];
  private readonly conversations: Conversation[];
  private readonly adapter: HouseholdAgentAdapter;
  private readonly submissions = new Map<string, { text: string; receipt: SubmissionReceipt }>();

  constructor(
    profiles: FamilyProfile[],
    presets: PromptPreset[],
    conversations: Conversation[],
    adapter: HouseholdAgentAdapter,
  ) {
    this.profiles = profiles;
    this.presets = presets;
    this.conversations = conversations;
    this.adapter = adapter;
    this.adapterMode = adapter.mode;
  }

  getProfile(profileId: string): FamilyProfile | undefined {
    return this.profiles.find((profile) => profile.id === profileId);
  }

  getSnapshot(): HouseholdSnapshot {
    const activeRuns = this.profiles.filter((profile) => profile.status === "working").length;
    const queuedRuns = this.profiles.filter((profile) => profile.status === "queued").length;
    return {
      maxActiveRuns: this.maxActiveRuns,
      activeRuns,
      queuedRuns,
      profiles: this.profiles.map(({ id, displayName, initials, color, status, statusDetail }) => ({
        id,
        displayName,
        initials,
        color,
        status,
        statusDetail,
      })),
    };
  }

  async reconcileRuns(): Promise<void> {}

  listPresets(profile: FamilyProfile): PromptPreset[] {
    return this.presets.filter((preset) => preset.allowedRoles.includes(profile.role));
  }

  listConversations(profile: FamilyProfile): Conversation[] {
    return this.conversations
      .filter((conversation) =>
        conversation.ownerProfileId === profile.id || conversation.audience === "household",
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  getConversation(profile: FamilyProfile, conversationId: string): Conversation | undefined {
    return this.listConversations(profile).find((conversation) => conversation.id === conversationId);
  }

  async createConversation(profile: FamilyProfile, title: string, presetId: string | null): Promise<Conversation> {
    if (presetId !== null && !this.listPresets(profile).some((preset) => preset.id === presetId)) {
      throw new Error("preset_not_allowed");
    }

    const id = `conv-${randomUUID()}`;
    const conversation: Conversation = {
      id,
      ownerProfileId: profile.id,
      agentId: profile.agentId,
      sessionKey: `hardy-home:${id}`,
      title,
      presetId,
      audience: "private",
      updatedAt: new Date().toISOString(),
    };
    await this.adapter.ensureConversation(conversation);
    this.conversations.push(conversation);
    return conversation;
  }

  async listMessages(profile: FamilyProfile, conversationId: string) {
    const conversation = this.getConversation(profile, conversationId);
    if (!conversation) return undefined;
    return this.adapter.listMessages(conversation);
  }

  async submitMessage(args: {
    profile: FamilyProfile;
    conversationId: string;
    text: string;
    submissionId: string;
  }): Promise<SubmissionReceipt | undefined> {
    const conversation = this.getConversation(args.profile, args.conversationId);
    if (!conversation) return undefined;

    const existing = this.submissions.get(args.submissionId);
    if (existing) {
      if (existing.receipt.conversationId !== args.conversationId || existing.text !== args.text) {
        throw new Error("submission_conflict");
      }
      return existing.receipt;
    }

    const snapshot = this.getSnapshot();
    const profileAlreadyRunning = args.profile.status === "working";
    const shouldQueue = !profileAlreadyRunning && snapshot.activeRuns >= snapshot.maxActiveRuns;
    const queuePosition = shouldQueue ? snapshot.queuedRuns + 1 : null;

    const receipt = await this.adapter.submitMessage({
      conversation,
      profile: args.profile,
      text: args.text,
      submissionId: args.submissionId,
      shouldQueue,
      queuePosition,
    });
    this.submissions.set(args.submissionId, { text: args.text, receipt });
    return receipt;
  }

  async cancel(profile: FamilyProfile, conversationId: string, runId?: string): Promise<boolean> {
    const conversation = this.getConversation(profile, conversationId);
    if (!conversation) return false;
    await this.adapter.cancel(conversation, runId);
    return true;
  }

  findBySessionKey(sessionKey: string): Conversation | undefined {
    return this.conversations.find((conversation) => conversation.sessionKey === sessionKey);
  }

  onAgentEvent(listener: Parameters<HouseholdAgentAdapter["onEvent"]>[0]): () => void {
    return this.adapter.onEvent(listener);
  }

  diagnostics() {
    return this.adapter.diagnostics();
  }

  async close(): Promise<void> {
    await this.adapter.close();
  }
}

export interface HouseholdStoreApi {
  readonly maxActiveRuns: number;
  readonly adapterMode: HouseholdAgentAdapter["mode"];
  getProfile(profileId: string): FamilyProfile | undefined;
  getSnapshot(): HouseholdSnapshot;
  reconcileRuns(): Promise<void>;
  listPresets(profile: FamilyProfile): PromptPreset[];
  listConversations(profile: FamilyProfile): Conversation[];
  getConversation(profile: FamilyProfile, conversationId: string): Conversation | undefined;
  createConversation(profile: FamilyProfile, title: string, presetId: string | null): Promise<Conversation>;
  listMessages(profile: FamilyProfile, conversationId: string): Promise<ChatMessage[] | undefined>;
  submitMessage(args: {
    profile: FamilyProfile;
    conversationId: string;
    text: string;
    submissionId: string;
  }): Promise<SubmissionReceipt | undefined>;
  cancel(profile: FamilyProfile, conversationId: string, runId?: string): Promise<boolean>;
  findBySessionKey(sessionKey: string): Conversation | undefined;
  onAgentEvent(listener: Parameters<HouseholdAgentAdapter["onEvent"]>[0]): () => void;
  diagnostics(): Promise<{ status: string; detail?: string }>;
  close(): Promise<void>;
}
