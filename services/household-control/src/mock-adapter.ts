import { randomUUID, createHash } from "node:crypto";
import type {
  ChatMessage, Conversation, HouseholdAgentAdapter, HouseholdAgentEvent, HouseholdAgentRunState,
  HouseholdConversationContext, HouseholdGoal, HouseholdGoalMutation, HouseholdGoalMutationResult,
  HouseholdSubmitMessage, SubmissionReceipt,
} from "./domain.ts";
import { HouseholdDispatchError } from "./gateway-errors.ts";

// In-memory fixture adapter only; production goal/transcript authority is OpenClaw.
export class MockHouseholdAgentAdapter implements HouseholdAgentAdapter {
  readonly mode = "mock" as const;
  private readonly messageStore: ChatMessage[];
  private readonly listeners = new Set<(event: HouseholdAgentEvent) => void>();
  private readonly runStates = new Map<string, HouseholdAgentRunState>();
  private readonly goals = new Map<string, HouseholdGoal>();
  private readonly submissions = new Map<string, { hash: string; receipt: SubmissionReceipt }>();
  private readonly operations = new Map<string, { hash: string; result: HouseholdGoalMutationResult }>();

  constructor(messageStore: ChatMessage[]) { this.messageStore = messageStore; }
  async ensureConversation(_conversation: Conversation): Promise<void> {}
  async listMessages(conversation: Conversation): Promise<ChatMessage[]> {
    return this.messageStore.filter((message) => message.conversationId === conversation.id);
  }

  async submitMessage(args: HouseholdSubmitMessage): Promise<SubmissionReceipt> {
    args.assertAdmission?.();
    const hash = createHash("sha256").update(JSON.stringify([
      args.conversation.id, args.profile.id, args.text, args.nativeContext ?? null, args.goalStart ?? null,
    ])).digest("hex");
    const prior = this.submissions.get(args.submissionId);
    if (prior && prior.hash !== hash) throw new HouseholdDispatchError("submission_conflict", "not_sent");
    if (prior && (prior.receipt.status !== "queued" || args.shouldQueue)) return prior.receipt;
    const receipt: SubmissionReceipt = {
      submissionId: args.submissionId, conversationId: args.conversation.id, profileId: args.profile.id,
      agentId: args.conversation.agentId, status: args.shouldQueue ? "queued" : "running",
      queuePosition: args.shouldQueue ? args.queuePosition : null, runId: args.shouldQueue ? null : `run-${args.submissionId}`,
    };
    if (!args.shouldQueue) {
      if (args.goalStart) {
        if (this.goals.has(args.conversation.sessionKey)) throw new HouseholdDispatchError("goal_already_exists", "not_sent");
        const goal: HouseholdGoal = { id: `goal-${args.submissionId}`, objective: args.text, status: "active", updatedAt: Date.now() };
        this.goals.set(args.conversation.sessionKey, goal);
        receipt.goalId = goal.id;
      }
      this.messageStore.push({ id: randomUUID(), conversationId: args.conversation.id, role: "user", text: args.text, createdAt: new Date().toISOString() });
      this.runStates.set(args.conversation.sessionKey, { status: "running", runId: receipt.runId, updatedAt: new Date().toISOString() });
    }
    this.submissions.set(args.submissionId, { hash, receipt });
    return receipt;
  }

  async getRunState(conversation: Conversation, expectedRunId?: string): Promise<HouseholdAgentRunState> {
    const state = this.runStates.get(conversation.sessionKey);
    if (!state || expectedRunId && state.runId !== expectedRunId) return { status: "unknown", runId: state?.runId ?? null, updatedAt: state?.updatedAt ?? null };
    return state;
  }

  async getProgress(_conversation: Conversation): Promise<null> { return null; }

  async getContext(conversation: Conversation): Promise<HouseholdConversationContext> {
    return {
      sessionKey: conversation.sessionKey, sessionId: `mock-${conversation.id}`,
      goal: this.goals.get(conversation.sessionKey) ?? null,
      runId: this.runStates.get(conversation.sessionKey)?.runId ?? null,
      continuationPending: this.runStates.get(conversation.sessionKey)?.continuationPending ?? false,
      parentSessionKey: null, contextTokens: null, contextBudgetStatus: null,
    };
  }

  async mutateGoal(conversation: Conversation, operation: HouseholdGoalMutation, assertAdmission?: () => void): Promise<HouseholdGoalMutationResult> {
    assertAdmission?.();
    const key = `${conversation.sessionKey}:${operation.operationId}`;
    const hash = createHash("sha256").update(JSON.stringify(operation)).digest("hex");
    const prior = this.operations.get(key);
    if (prior) {
      if (prior.hash !== hash) throw new HouseholdDispatchError("goal_operation_conflict", "not_sent");
      return { ...prior.result, replayed: true };
    }
    const goal = this.goals.get(conversation.sessionKey);
    if (!goal || goal.id !== operation.goalId) throw new HouseholdDispatchError("goal_not_found", "not_sent");
    const result: HouseholdGoalMutationResult = { goalId: goal.id, runId: null, status: operation.action === "clear" ? "cleared" : "updated", replayed: false };
    if (operation.action === "clear") this.goals.delete(conversation.sessionKey);
    else {
      const status = operation.action === "pause" ? "paused" : operation.action === "block" ? "blocked" : operation.action === "complete" ? "complete" : "active";
      this.goals.set(conversation.sessionKey, { ...goal, status, objective: operation.action === "edit" ? operation.objective ?? goal.objective : goal.objective, updatedAt: Date.now() });
      if (operation.action === "resume") {
        result.runId = `goal-resume-${operation.operationId}`;
        this.runStates.set(conversation.sessionKey, { status: "running", runId: result.runId, goalId: goal.id, updatedAt: new Date().toISOString() });
      }
    }
    this.operations.set(key, { hash, result });
    return result;
  }

  setRunState(conversation: Conversation, state: HouseholdAgentRunState): void {
    this.runStates.set(conversation.sessionKey, state);
    for (const entry of this.submissions.values()) if (entry.receipt.conversationId === conversation.id && entry.receipt.runId === state.runId && ["complete", "failed", "cancelled"].includes(state.status)) {
      entry.receipt.status = state.status as SubmissionReceipt["status"];
    }
  }
  emitEvent(event: HouseholdAgentEvent): void { for (const listener of this.listeners) listener(event); }
  async cancel(conversation: Conversation, runId?: string): Promise<void> {
    const current = this.runStates.get(conversation.sessionKey);
    if (runId && current?.runId && runId !== current.runId) throw new HouseholdDispatchError("cancel_target_not_active", "not_sent");
    const event = { sessionKey: conversation.sessionKey, runId: runId ?? current?.runId ?? null, phase: "cancelled" } as const;
    this.runStates.set(conversation.sessionKey, { status: "cancelled", runId: event.runId, updatedAt: new Date().toISOString() });
    this.emitEvent(event);
  }
  onEvent(listener: (event: HouseholdAgentEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async diagnostics() { return { status: "healthy", detail: "in-memory test adapter" }; }
  async close(): Promise<void> { this.listeners.clear(); }
}
