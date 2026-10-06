import { randomUUID } from "node:crypto";
import type {
  ChatMessage,
  Conversation,
  FamilyProfile,
  HouseholdAgentAdapter,
  HouseholdAgentEvent,
  HouseholdAgentRunState,
  SubmissionReceipt,
} from "./domain.ts";

export class MockHouseholdAgentAdapter implements HouseholdAgentAdapter {
  readonly mode = "mock" as const;
  private readonly messageStore: ChatMessage[];
  private readonly listeners = new Set<(event: HouseholdAgentEvent) => void>();
  private readonly runStates = new Map<string, HouseholdAgentRunState>();

  constructor(messageStore: ChatMessage[]) {
    this.messageStore = messageStore;
  }

  async ensureConversation(_conversation: Conversation): Promise<void> {}

  async listMessages(conversation: Conversation): Promise<ChatMessage[]> {
    return this.messageStore.filter((message) => message.conversationId === conversation.id);
  }

  async submitMessage(args: {
    conversation: Conversation;
    profile: FamilyProfile;
    text: string;
    submissionId: string;
    shouldQueue: boolean;
    queuePosition: number | null;
  }): Promise<SubmissionReceipt> {
    this.messageStore.push({
      id: randomUUID(),
      conversationId: args.conversation.id,
      role: "user",
      text: args.text,
      createdAt: new Date().toISOString(),
    });

    const receipt: SubmissionReceipt = {
      submissionId: args.submissionId,
      conversationId: args.conversation.id,
      profileId: args.profile.id,
      agentId: args.profile.agentId,
      status: args.shouldQueue ? "queued" : "running",
      queuePosition: args.shouldQueue ? args.queuePosition : null,
      runId: args.shouldQueue ? null : `run-${args.submissionId}`,
    };
    this.runStates.set(args.conversation.sessionKey, {
      status: args.shouldQueue ? "queued" : "running",
      runId: receipt.runId,
      updatedAt: new Date().toISOString(),
    });
    return receipt;
  }

  async getRunState(conversation: Conversation): Promise<HouseholdAgentRunState> {
    return this.runStates.get(conversation.sessionKey) ?? { status: "unknown", runId: null, updatedAt: null };
  }

  setRunState(conversation: Conversation, state: HouseholdAgentRunState) {
    this.runStates.set(conversation.sessionKey, state);
  }

  emitEvent(event: HouseholdAgentEvent) {
    for (const listener of this.listeners) listener(event);
  }

  async cancel(conversation: Conversation, runId?: string): Promise<void> {
    const event = { sessionKey: conversation.sessionKey, runId: runId ?? null, phase: "cancelled" } as const;
    this.runStates.set(conversation.sessionKey, {
      status: "cancelled",
      runId: event.runId,
      updatedAt: new Date().toISOString(),
    });
    this.emitEvent(event);
  }

  onEvent(listener: (event: HouseholdAgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async diagnostics() {
    return { status: "healthy", detail: "in-memory test adapter" };
  }

  async close(): Promise<void> {}
}
