import type { Conversation, HouseholdAgentRunState } from "./domain.ts";

export type JsonRecord = Record<string, unknown>;
export type NativeGoal = {
  id: string;
  objective: string;
  status: "active" | "paused" | "blocked" | "usage_limited" | "budget_limited" | "complete";
  updatedAt: number;
};
export type NativeConversationContext = {
  sessionKey: string;
  sessionId: string | null;
  goal: NativeGoal | null;
  runId: string | null;
  continuationPending: boolean;
  parentSessionKey: string | null;
  contextTokens: number | null;
  contextBudgetStatus: string | null;
};
export type NativeGoalMutation = {
  goalId: string;
  operationId: string;
  issuedAtMs: number;
  action: "edit" | "pause" | "resume" | "block" | "complete" | "clear";
  objective?: string;
  note?: string;
};

export function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : undefined;
}

export function matchesNativeSession(row: JsonRecord, conversation: Pick<Conversation, "agentId" | "sessionKey">): boolean {
  return (row.agentId === undefined || row.agentId === conversation.agentId) &&
    (row.key === conversation.sessionKey || row.key === `agent:${conversation.agentId}:${conversation.sessionKey}`);
}

export function goalFromRow(row: JsonRecord): NativeGoal | null {
  const goal = record(row.goal);
  if (!goal || typeof goal.id !== "string" || typeof goal.objective !== "string" ||
    typeof goal.status !== "string" || !["active", "paused", "blocked", "usage_limited", "budget_limited", "complete"].includes(goal.status)) return null;
  return {
    id: goal.id,
    objective: goal.objective,
    status: goal.status as NativeGoal["status"],
    updatedAt: typeof goal.updatedAt === "number" && Number.isFinite(goal.updatedAt) ? goal.updatedAt : 0,
  };
}

export function hasPendingContinuation(row: JsonRecord): boolean {
  if (row.subagentRunState === "paused" || row.hasActiveSubagentRun === true) return true;
  const swarm = record(row.swarm);
  if (typeof swarm?.otherActiveGroups === "number" && swarm.otherActiveGroups > 0) return true;
  return Array.isArray(swarm?.groups) && swarm.groups.some((value) => {
    const group = record(value);
    return typeof group?.queued === "number" && group.queued > 0 ||
      typeof group?.running === "number" && group.running > 0;
  });
}

export function contextFromRow(row: JsonRecord, conversation: Pick<Conversation, "sessionKey">): NativeConversationContext {
  const budget = record(row.contextBudgetStatus);
  return {
    sessionKey: typeof row.key === "string" ? row.key : conversation.sessionKey,
    sessionId: typeof row.sessionId === "string" ? row.sessionId : null,
    goal: goalFromRow(row),
    runId: typeof row.lastRunId === "string" ? row.lastRunId : null,
    continuationPending: hasPendingContinuation(row),
    parentSessionKey: typeof row.parentSessionKey === "string" ? row.parentSessionKey : null,
    contextTokens: typeof row.contextTokens === "number" && Number.isFinite(row.contextTokens) ? row.contextTokens : null,
    contextBudgetStatus: typeof row.contextBudgetStatus === "string" ? row.contextBudgetStatus :
      typeof budget?.status === "string" ? budget.status : typeof budget?.state === "string" ? budget.state : null,
  };
}

export function stateFromRow(row: JsonRecord, expectedRunId?: string, expectedGoalId?: string): HouseholdAgentRunState {
  const pending = hasPendingContinuation(row);
  const goal = goalFromRow(row);
  const observedRun = typeof row.lastRunId === "string" ? row.lastRunId : null;
  const updatedAt = typeof row.updatedAt === "number" && Number.isFinite(row.updatedAt)
    ? new Date(row.updatedAt).toISOString() : null;
  const metadata = {
    continuationPending: pending,
    ...(goal ? { goalId: goal.id } : {}),
    ...(typeof row.sessionId === "string" ? { sessionId: row.sessionId } : {}),
  };
  const activeIds = Array.isArray(row.activeRunIds) ? row.activeRunIds : [];
  const anchored = !expectedRunId || observedRun === expectedRunId || activeIds.includes(expectedRunId) ||
    Boolean(expectedGoalId && goal?.id === expectedGoalId);
  if (pending || row.hasActiveRun === true || row.status === "running" || row.status === "queued") {
    return { ...metadata, status: anchored ? row.status === "queued" && !pending ? "queued" : "running" : "unknown",
      runId: anchored ? expectedRunId ?? observedRun : observedRun, updatedAt };
  }
  // The native goal ID is an explicit lineage anchor across successor turns.
  if (expectedGoalId && goal?.id === expectedGoalId && goal.status === "complete") {
    return { ...metadata, status: "complete", runId: expectedRunId ?? observedRun, updatedAt };
  }
  // The same exact goal can finish a later parent/announce turn without finishing
  // its business objective. The delivery owner decides proof/question/failure.
  const sameGoalSuccessor = Boolean(expectedGoalId && goal?.id === expectedGoalId && observedRun &&
    (row.parentSessionKey === undefined || row.parentSessionKey === null));
  // Session recency, a child row or an unrelated goal cannot establish this lineage.
  if (expectedRunId && expectedRunId !== observedRun && !sameGoalSuccessor) return { ...metadata, status: "unknown", runId: observedRun, updatedAt };
  const status: HouseholdAgentRunState["status"] = row.status === "done" ? "complete" :
    row.status === "failed" || row.status === "timeout" ? "failed" :
      row.status === "interrupted" || row.status === "killed" ? "cancelled" : "unknown";
  return { ...metadata, status, runId: observedRun, updatedAt };
}

export function terminalFromExactObservation(value: unknown): HouseholdAgentRunState["status"] {
  const observation = record(value);
  if (!observation || observation.yielded === true || observation.livenessState === "paused" ||
    observation.status === "pending" || observation.status === "timeout") return "unknown";
  // agent.wait timeout is an observation deadline, not an execution timeout.
  if (observation.status === "ok") return "complete";
  if (observation.status === "error") return "failed";
  if (observation.status === "aborted" || observation.status === "cancelled") return "cancelled";
  return "unknown";
}

export function stateFromExactObservation(value: unknown): HouseholdAgentRunState["status"] {
  const observation = record(value);
  if (!observation) return "unknown";
  if (observation.yielded === true && observation.livenessState === "paused") return "running";
  if (observation.status === "pending" && observation.timeoutPhase === "queue") return "queued";
  return terminalFromExactObservation(observation);
}
