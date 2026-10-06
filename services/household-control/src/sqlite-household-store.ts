import { createHash, randomUUID } from "node:crypto";
import type {
  ChatMessage,
  Conversation,
  FamilyProfile,
  HouseholdAgentAdapter,
  HouseholdAgentEvent,
  HouseholdSnapshot,
  PromptPreset,
  SubmissionReceipt,
} from "./domain.ts";
import type { HouseholdStoreApi } from "./household-store.ts";
import type { HouseholdDatabase } from "./database.ts";

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export class SqliteHouseholdStore implements HouseholdStoreApi {
  readonly maxActiveRuns = 2;
  readonly adapterMode: HouseholdAgentAdapter["mode"];
  private readonly database: HouseholdDatabase;
  private readonly adapter: HouseholdAgentAdapter;

  constructor(database: HouseholdDatabase, adapter: HouseholdAgentAdapter) {
    this.database = database;
    this.adapter = adapter;
    this.adapterMode = adapter.mode;
  }

  getProfile(profileId: string): FamilyProfile | undefined {
    return this.database.getProfile(profileId);
  }

  getSnapshot(): HouseholdSnapshot {
    const profiles = this.database.listProfiles();
    return {
      maxActiveRuns: this.maxActiveRuns,
      activeRuns: profiles.filter((profile) => profile.status === "working").length,
      queuedRuns: profiles.filter((profile) => profile.status === "queued").length,
      profiles: profiles.map(({ id, displayName, initials, color, status, statusDetail }) => ({
        id,
        displayName,
        initials,
        color,
        status,
        statusDetail,
      })),
    };
  }

  async reconcileRuns(): Promise<void> {
    for (const active of this.database.listActiveSubmissions()) {
      const conversation = this.database.getConversation(active.receipt.conversationId);
      if (!conversation) continue;
      try {
        const state = await this.adapter.getRunState(conversation);
        if (state.status === "queued" || state.status === "running" || state.status === "unknown") continue;
        if (state.runId && active.receipt.runId && state.runId !== active.receipt.runId) continue;
        if (
          state.updatedAt &&
          Date.parse(state.updatedAt) < Date.parse(active.createdAt)
        ) continue;
        this.database.updateSubmission({
          ...active.receipt,
          status: state.status,
          runId: active.receipt.runId ?? state.runId,
        });
        this.database.setProfileStatus(conversation.ownerProfileId, "available", "Ready");
      } catch {
        // A transient Gateway problem must not make household status unavailable.
        // The live event stream or the next status request will retry reconciliation.
      }
    }
  }

  listPresets(profile: FamilyProfile): PromptPreset[] {
    return this.database.listPresets().filter((preset) => preset.allowedRoles.includes(profile.role));
  }

  listConversations(profile: FamilyProfile): Conversation[] {
    return this.database.listConversations(profile.id);
  }

  getConversation(profile: FamilyProfile, conversationId: string): Conversation | undefined {
    const conversation = this.database.getConversation(conversationId);
    if (!conversation) return undefined;
    return conversation.ownerProfileId === profile.id || conversation.audience === "household"
      ? conversation
      : undefined;
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
    this.database.insertConversation(conversation);
    return conversation;
  }

  async listMessages(profile: FamilyProfile, conversationId: string): Promise<ChatMessage[] | undefined> {
    const conversation = this.getConversation(profile, conversationId);
    return conversation ? this.adapter.listMessages(conversation) : undefined;
  }

  async submitMessage(args: {
    profile: FamilyProfile;
    conversationId: string;
    text: string;
    submissionId: string;
  }): Promise<SubmissionReceipt | undefined> {
    const conversation = this.getConversation(args.profile, args.conversationId);
    if (!conversation) return undefined;
    const textHash = hashText(args.text);
    const existing = this.database.getSubmission(args.submissionId);
    if (existing) {
      if (
        existing.receipt.conversationId !== conversation.id ||
        existing.receipt.profileId !== args.profile.id ||
        existing.textHash !== textHash
      ) throw new Error("submission_conflict");
      if (existing.receipt.status !== "dispatching") return existing.receipt;
    }

    const snapshot = this.getSnapshot();
    const profileAlreadyRunning = args.profile.status === "working";
    const shouldQueue = !profileAlreadyRunning && snapshot.activeRuns >= snapshot.maxActiveRuns;
    const queuePosition = shouldQueue ? snapshot.queuedRuns + 1 : null;
    if (!existing) {
      this.database.insertSubmission({
        submissionId: args.submissionId,
        conversationId: conversation.id,
        profileId: args.profile.id,
        agentId: args.profile.agentId,
        textHash,
        status: shouldQueue ? "queued" : "dispatching",
        queuePosition,
      });
    }
    if (shouldQueue) {
      this.database.setProfileStatus(args.profile.id, "queued", `Queue position ${queuePosition}`);
      return this.database.getSubmission(args.submissionId)?.receipt;
    }

    try {
      const receipt = await this.adapter.submitMessage({
        conversation,
        profile: args.profile,
        text: args.text,
        submissionId: args.submissionId,
        shouldQueue: false,
        queuePosition: null,
      });
      this.database.updateSubmission(receipt);
      this.database.setProfileStatus(args.profile.id, "working", "Responding");
      this.database.touchConversation(conversation.id);
      return receipt;
    } catch (error) {
      // Keep dispatching: the Gateway may have accepted the idempotency key before
      // the connection failed. Retrying the same submission safely reconciles it.
      const receipt = this.database.getSubmission(args.submissionId)?.receipt;
      if (receipt) this.database.updateSubmission(receipt, error instanceof Error ? error.message : "dispatch_failed");
      throw error;
    }
  }

  async cancel(profile: FamilyProfile, conversationId: string, runId?: string): Promise<boolean> {
    const conversation = this.getConversation(profile, conversationId);
    if (!conversation) return false;
    await this.adapter.cancel(conversation, runId);
    return true;
  }

  findBySessionKey(sessionKey: string): Conversation | undefined {
    return this.database.findConversationBySessionKey(sessionKey);
  }

  onAgentEvent(listener: (event: HouseholdAgentEvent) => void): () => void {
    return this.adapter.onEvent((event) => {
      const status = event.phase === "complete"
        ? "complete"
        : event.phase === "failed"
          ? "failed"
          : event.phase === "cancelled"
            ? "cancelled"
            : "running";
      this.database.updateRunBySession(event.sessionKey, event.runId, status);
      if (event.phase !== "changed") {
        const conversation = this.database.findConversationBySessionKey(event.sessionKey);
        if (conversation) this.database.setProfileStatus(conversation.ownerProfileId, "available", "Ready");
      }
      listener(event);
    });
  }

  diagnostics() {
    return this.adapter.diagnostics();
  }

  async close(): Promise<void> {
    await this.adapter.close();
    this.database.close();
  }
}
