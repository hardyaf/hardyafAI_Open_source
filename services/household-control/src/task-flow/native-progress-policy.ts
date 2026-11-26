import type { HouseholdNativeProgress } from "../domain.ts";
import type { TaskHandoff } from "./types.ts";

export type NativeProgressStep = { step: string; status: "pending" | "in_progress" | "completed" };
const verificationStep = "Verify the declared outcomes and finish the original native goal";
const verificationId = "__verification__";

function displayStep(id: string, description: string): string {
  const text = id + ": " + description;
  if (Buffer.byteLength(text, "utf8") <= 512) return text;
  let label = "";
  for (const character of text) {
    if (Buffer.byteLength(label + character + "…", "utf8") > 512) break;
    label += character;
  }
  return label + "…";
}
function verified(handoff: TaskHandoff, id: string): boolean {
  const refs = handoff.verifications[id];
  return Array.isArray(refs) && refs.length > 0 && refs.every(ref => ref.verified === true && typeof ref.digest === "string" && !!ref.digest);
}
/** Rebuildable native presentation of canonical task outcomes and owning verification state. */
export function projectNativeProgressPlan(handoff: TaskHandoff): NativeProgressStep[] {
  let active = false;
  const plan = handoff.outcomes.map(outcome => {
    const completed = verified(handoff, outcome.id), status = completed ? "completed" : !active ? "in_progress" : "pending";
    if (!completed) active = true;
    return { step: displayStep(outcome.id, outcome.description), status } as NativeProgressStep;
  });
  const complete = handoff.outcomes.length > 0 && plan.every(step => step.status === "completed") && handoff.terminal === "complete";
  plan.push({ step: verificationId + ": " + verificationStep, status: complete ? "completed" : active ? "pending" : "in_progress" });
  return plan;
}

/** The native tool targets only its current session; no target or policy overrides are accepted. */
export function validateNativeProgressWrite(args: unknown, handoff: TaskHandoff | null | undefined): boolean {
  if (!handoff?.outcomes.length || handoff.outcomes.length > 40 || !args || typeof args !== "object" || Array.isArray(args)) return false;
  const input = args as Record<string, unknown>;
  if (Object.keys(input).some(key => !["markdown", "plan"].includes(key)) ||
    input.markdown !== undefined && (typeof input.markdown !== "string" || Buffer.byteLength(input.markdown, "utf8") > 8192) ||
    !Array.isArray(input.plan) || input.plan.length > 50) return false;
  const expected = projectNativeProgressPlan(handoff), statuses = new Map<string, string>();
  for (const [index, outcome] of handoff.outcomes.entries()) statuses.set(outcome.id, expected[index].status);
  statuses.set(verificationId, expected.at(-1)!.status);
  if (input.plan.length !== statuses.size) return false;
  const seen = new Set<string>();
  for (const value of input.plan) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const entry = value as Record<string, unknown>;
    if (Object.keys(entry).some(key => !["step", "status"].includes(key)) ||
      typeof entry.step !== "string" || Buffer.byteLength(entry.step, "utf8") > 512 ||
      !["pending", "in_progress", "completed"].includes(String(entry.status))) return false;
    const label = entry.step as string;
    // Stable identity binds presentation to the outcome; wording and order are free.
    // The unprefixed verification label is retained for already-saved native cards.
    const id = label === verificationStep ? verificationId : [...statuses.keys()].find(candidate => label === candidate || label.startsWith(candidate + ": "));
    if (!id || seen.has(id) || entry.status === "completed" && statuses.get(id) !== "completed") return false;
    seen.add(id);
  }
  return true;
}

/** The card is a native read projection, never completion evidence or a grant. */
export function nativeProgressPlanCurrent(card: HouseholdNativeProgress | null, handoff: TaskHandoff | null | undefined,
  _sourceCreatedAtMs: number, complete = false): boolean {
  // Fresh human prompts and label changes do not invalidate a derived display.
  if (!card || !handoff || !Number.isSafeInteger(card.updatedAt) ||
    !card.steps || !validateNativeProgressWrite({ plan: card.steps }, handoff)) return false;
  if (complete) return handoff.terminal === "complete" && card.steps.every(step => step.status === "completed");
  return handoff.terminal !== "complete" && card.steps.some(step => step.status !== "completed");
}
