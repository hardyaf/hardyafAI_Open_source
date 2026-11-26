import { NativeDomainError } from "../native-contracts.ts";

/** Code-point positions in the versioned plain-text projection, never MIME byte offsets. */
export type GoogleBodyWindow = { offset?: number; maxChars: number; version?: string };
export type GoogleMessageReadInput = { messageId: string; format?: "full" | "metadata"; bodyWindow?: GoogleBodyWindow };
export const GOOGLE_BODY_WINDOW_MAX_CHARS = 60_000;
export const googleBodyWindowProperty = {
  type: "object", additionalProperties: false, required: ["maxChars"],
  description: "Optional plain-text body window. Offsets count Unicode code points. Continue with nextOffset and the returned version; a changed message or account binding is rejected. Valid only with full format.",
  properties: {
    offset: {type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER},
    maxChars: {type: "integer", minimum: 1, maximum: GOOGLE_BODY_WINDOW_MAX_CHARS},
    version: {type: "string", pattern: "^sha256-v1:[a-f0-9]{64}$", maxLength: 74},
  },
};
function invalid(): never { throw new NativeDomainError("invalid_google_read", 400); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
/** Shared closed validation at every boundary before any credential or provider work. */
export function googleMessageReadInput(value: unknown): GoogleMessageReadInput {
  const input = object(value);
  if (Object.keys(input).some(key => !["messageId", "format", "bodyWindow"].includes(key)) ||
      typeof input.messageId !== "string" || input.messageId.length > 128 || !/^[A-Za-z0-9_-]+$/.test(input.messageId)) return invalid();
  if (input.format !== undefined && input.format !== "full" && input.format !== "metadata") return invalid();
  const result: GoogleMessageReadInput = {messageId: input.messageId, ...(input.format !== undefined ? {format: input.format} : {})};
  if (input.bodyWindow !== undefined) {
    if (input.format === "metadata") return invalid();
    const window = object(input.bodyWindow), offset = window.offset === undefined ? 0 : window.offset;
    if (Object.keys(window).some(key => !["offset", "maxChars", "version"].includes(key)) ||
        !Number.isSafeInteger(offset) || Number(offset) < 0 ||
        !Number.isSafeInteger(window.maxChars) || Number(window.maxChars) < 1 || Number(window.maxChars) > GOOGLE_BODY_WINDOW_MAX_CHARS ||
        window.version !== undefined && (typeof window.version !== "string" || !/^sha256-v1:[a-f0-9]{64}$/.test(window.version)) ||
        Number(offset) > 0 && window.version === undefined) return invalid();
    result.bodyWindow = {offset: Number(offset), maxChars: Number(window.maxChars),
      ...(typeof window.version === "string" ? {version: window.version} : {})};
  }
  return result;
}
