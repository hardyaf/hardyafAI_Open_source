import type { Conversation } from "./domain.ts";
import { matchesNativeSession, record } from "./native-session-state.ts";

export type NativeProgress = {
  sessionKey: string;
  revision: number;
  updatedAt: number;
  markdown?: string;
  steps?: Array<{ step: string; status: "pending" | "in_progress" | "completed" }>;
};

/** Read projection only. Native progress tools remain the sole card writer. */
export function nativeProgressFromResult(result: unknown, conversation: Pick<Conversation, "sessionKey" | "agentId">): NativeProgress | null {
  const value = record(result);
  if (!value || !("card" in value)) throw new Error("native_progress_invalid");
  if (value.card === null) return null;
  const card = record(value.card);
  if (!card || !matchesNativeSession({ key: card.sessionKey }, conversation) ||
    !Number.isSafeInteger(card.revision) || (card.revision as number) < 1 ||
    !Number.isSafeInteger(card.updatedAt) || (card.updatedAt as number) < 0 ||
    card.markdown !== undefined && (typeof card.markdown !== "string" || Buffer.byteLength(card.markdown, "utf8") > 8192) ||
    card.steps !== undefined && (!Array.isArray(card.steps) || card.steps.length > 50)) throw new Error("native_progress_invalid");
  const steps = card.steps === undefined ? undefined : (card.steps as unknown[]).map((value) => {
    const entry = record(value);
    if (!entry || typeof entry.step !== "string" || !entry.step.trim() || Buffer.byteLength(entry.step, "utf8") > 512 ||
      !["pending", "in_progress", "completed"].includes(String(entry.status))) throw new Error("native_progress_invalid");
    return { step: entry.step, status: entry.status as "pending" | "in_progress" | "completed" };
  });
  return {
    sessionKey: card.sessionKey as string, revision: card.revision as number, updatedAt: card.updatedAt as number,
    ...(typeof card.markdown === "string" ? { markdown: card.markdown } : {}), ...(steps ? { steps } : {}),
  };
}
