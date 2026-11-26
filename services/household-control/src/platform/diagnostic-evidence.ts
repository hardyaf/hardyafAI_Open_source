import { PlatformError } from "./errors.ts";

export type DiagnosticEvidence = {
  schemaVersion: 1;
  taskId: string;
  phase: string;
  outcome: string;
  events: Array<{ component: string; code: string; at: string }>;
  context: { promptTokens?: number; contextWindowTokens?: number; headroomTokens?: number; estimatedPromptTokens?: number; reserveTokens?: number; overflowTokens?: number; budgetRoute?: string; compactions?: number; finishReason?: string };
  unavailable?: string[];
  versions: Record<string, string>;
};
function label(value: unknown, max = 128): string {
  if (typeof value !== "string" || value.length > max || !/^[a-zA-Z0-9][a-zA-Z0-9._: -]*$/.test(value)) {
    throw new PlatformError("diagnostic_evidence_invalid", 400);
  }
  return value;
}
export function buildDiagnosticEvidence(input: {
  taskId: string; phase: string; outcome: string;
  events?: Array<{ component: string; code: string; at: string }>;
  promptTokens?: number; contextWindowTokens?: number; headroomTokens?: number; estimatedPromptTokens?: number; reserveTokens?: number; overflowTokens?: number; budgetRoute?: string; compactions?: number; finishReason?: string;
  unavailable?: string[];
  versions?: Record<string, string>;
}): DiagnosticEvidence {
  const events = input.events ?? [];
  if (events.length > 200 || Object.keys(input.versions ?? {}).length > 20) throw new PlatformError("diagnostic_evidence_too_large", 413);
  const context: DiagnosticEvidence["context"] = {};
  for (const key of ["promptTokens", "contextWindowTokens", "headroomTokens", "estimatedPromptTokens", "reserveTokens", "overflowTokens", "compactions"] as const) {
    const value = input[key];
    if (value !== undefined) {
      if (!Number.isSafeInteger(value) || value < 0) throw new PlatformError("diagnostic_evidence_invalid", 400);
      context[key] = value;
    }
  }
  if (input.finishReason !== undefined) context.finishReason = label(input.finishReason, 64);
  if (input.budgetRoute !== undefined) context.budgetRoute = label(input.budgetRoute, 64);
  return {
    schemaVersion: 1, taskId: label(input.taskId), phase: label(input.phase), outcome: label(input.outcome),
    events: events.map((event) => {
      if (!Number.isFinite(Date.parse(event.at))) throw new PlatformError("diagnostic_evidence_invalid", 400);
      return { component: label(event.component, 64), code: label(event.code, 64), at: new Date(event.at).toISOString() };
    }),
    context,
    ...(input.unavailable ? { unavailable: input.unavailable.slice(0, 20).map(value => label(value, 64)) } : {}),
    versions: Object.fromEntries(Object.entries(input.versions ?? {}).map(([key, value]) => [label(key, 64), label(value, 64)])),
  };
}
