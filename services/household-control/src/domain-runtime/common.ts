import { createHash } from "node:crypto";

export type JsonSchema = Record<string, unknown>;
export type DomainTool = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  effect: "read" | "write";
  capability?: string;
  replaySafe?: boolean;
  operationIdentity?: { fields:readonly string[]; defaults?:Readonly<Record<string,unknown>> };
};
export type DomainPrincipal = {
  profileId: string;
  agentId: string;
  sessionKey: string;
  conversationId: string;
  taskId: string;
  audience: "private" | "household";
  sourcePromptId: string;
  sourcePromptCreatedAt: string;
  originDeviceId: string | null;
  authorizationFingerprint: string;
  canReadHousehold: boolean;
  canWriteHousehold: boolean;
  canEditContacts: boolean;
  assertCurrent(): void;
  signal?: AbortSignal;
};
export class DomainError extends Error {
  readonly code: string;
  readonly outcome: "not_sent" | "unknown";
  readonly httpStatus: number;
  constructor(code: string, options: { outcome?: "not_sent" | "unknown"; httpStatus?: number } = {}) {
    super(code); this.name = "DomainError"; this.code = code;
    this.outcome = options.outcome ?? "not_sent"; this.httpStatus = options.httpStatus ?? 400;
  }
}
export function domainErrorCode(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  if (typeof code === "string" && /^[a-z][a-z0-9_]{0,100}$/.test(code)) return code;
  return "domain_operation_failed";
}
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b))
    .map(([key,v]) => JSON.stringify(key) + ":" + canonical(v)).join(",") + "}";
}
export function fingerprint(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
export function safeOperationId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/.test(value);
}
export function nativeToolName(name: string): string {
  const result = "household_" + name.replaceAll(".", "_");
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(result)) throw new DomainError("domain_tool_name_invalid");
  return result;
}
