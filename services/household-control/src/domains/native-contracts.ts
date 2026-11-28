export type NativeJson = Record<string, unknown>;
export type NativeScope = "personal" | "household";
export type NativeToolDescriptor = {
  name: string; description: string; inputSchema: NativeJson;
  effect: "read" | "write"; capability: string; operationField?: string;
};

export type NativeDeliveryTarget = { channel: string; to: string; accountId?: string; threadId?: string; audience: "private" | "household" };

/** Constructed by the authenticated application/native composition boundary. */
export type NativeDomainContext = {
  profileId: string; agentId: string; sessionKey: string; conversationId: string;
  credentialAuthority?: { agentId?:string;sessionKey?:string;sessionId?:string;runId?:string;nativeRunId?:string|null;nativeGoalId?:string|null;nativeGoalStatus?:string|null;nativeSessionId?:string|null };
  audience: "private" | "household";
  allowedScopes: readonly NativeScope[];
  authorizedAttendees: readonly string[];
  confirmedSourceIds?: readonly string[];
  confirmedSourceText?: Readonly<Record<string,string>>;
  destructiveApproved?: boolean;
  /** Trusted private owner execution; never populated from tool arguments. */
  ownerAutonomy?: boolean;
  /** Trusted transport/config routes only; tool arguments cannot select raw recipients. */
  deliveryTarget?: NativeDeliveryTarget;
  notificationTarget?: NativeDeliveryTarget;
  signal?: AbortSignal;
  assertCurrent(): void;
};

export interface NativeRpcPort {
  request(method: string, params: NativeJson, context:NativeDomainContext): Promise<unknown>;
}
export interface NativeJsonRunner {
  runJson(binary: string, args: readonly string[], options: {
    cwd?: string; timeoutMs: number; maxBytes: number; signal?: AbortSignal;
    assertCurrent?: () => void;
    effect?: boolean;
  }): Promise<unknown>;
}

export class NativeDomainError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly deliveryOutcome: "not_sent" | "unknown";
  constructor(code: string, statusCode = 400, outcome: "not_sent" | "unknown" = "not_sent") {
    super(code); this.name = "NativeDomainError"; this.code = code;
    this.statusCode = statusCode; this.deliveryOutcome = outcome;
  }
}

export const operationProperty = { type: "string", minLength: 8, maxLength: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$" };
export const scopeProperty = { type: "string", enum: ["personal", "household"] };
export const textProperty = (maxLength = 2000) => ({ type: "string", minLength: 1, maxLength });
export const objectSchema = (properties: NativeJson, required: string[] = []) => ({ type: "object", additionalProperties: false, properties, required });
export const integerProperty = (minimum: number, maximum: number) => ({ type: "integer", minimum, maximum });
export function descriptor(name: string, description: string, capability: string, properties: NativeJson, required: string[], effect: "read" | "write" = "read"): NativeToolDescriptor {
  return { name, description, capability, effect, inputSchema: objectSchema({ ...properties, ...(effect === "write" ? { operationId: operationProperty } : {}) }, [...required, ...(effect === "write" ? ["operationId"] : [])]), ...(effect === "write" ? { operationField: "operationId" } : {}) };
}
