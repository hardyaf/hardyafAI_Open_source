import { isIP } from "node:net";
export type GooglePreset = "gmail_read" | "calendar_read" | "household_calendar_manage";
export type ConnectionStatus = "connected" | "disconnected" | "needs_reauthorization" | "unknown";
export type ConnectionRecord = {
  id: string; ownerProfileId: string; label: string; kind: "password" | "google" | "google_client";
  account?: string; accountId?: string; origin?: string; preset?: GooglePreset; scopes: string[];
  secretId: string; status: ConnectionStatus; createdAt: string; updatedAt: string;
  clientId?: string; redirectUri?: string;
};
/** The existing household database owns non-secret connection metadata. */
export interface ConnectionsStore {
  list(ownerProfileId: string): ConnectionRecord[];
  get(ownerProfileId: string, id: string): ConnectionRecord | undefined;
  save(record: ConnectionRecord): void;
}
export type VaultReceipt = { secretId: string; revision: string };
export interface ConnectionVault {
  configured(): Promise<boolean>;
  bootstrap(input: { accessToken: string; organizationId: string; projectId: string }): Promise<void>;
  put(key: string, value: string, allowCreate: boolean): Promise<VaultReceipt>;
  read(secretId: string): Promise<string>;
  replace(secretId: string, previous: string, value: string): Promise<VaultReceipt>;
}
export type GoogleAuthorization = {
  clientId: string; clientSecret: string; redirectUri: string;
  state: string; verifier: string; nonce: string; scopes: string[]; expectedEmail: string;
};
export type GoogleGrant = { refreshToken: string; email: string; accountId: string; scopes: string[] };
export type GoogleReadOperation = "gmail.search" | "gmail.get" | "calendar.list" | "calendar.get";
/** Trusted credential-service context; never accepted from tool or IPC input. */
export type GoogleReadContext = { messageScope: string };
export interface GoogleProvider {
  authorizationUrl(input: GoogleAuthorization): Promise<string>;
  exchange(input: GoogleAuthorization, code: string): Promise<GoogleGrant>;
  revoke(refreshToken: string): Promise<void>;
  refresh(client: {clientId: string;clientSecret: string;redirectUri: string}, refreshToken: string): Promise<{accessToken: string;refreshToken?: string}>;
  read(accessToken: string, operation: GoogleReadOperation, input: unknown, context?: GoogleReadContext): Promise<unknown>;
}
export class ConnectionsError extends Error {
  readonly code: string; readonly statusCode: number; readonly outcome: string;
  constructor(code: string, statusCode = 503, outcome = "not_sent") {
    super(code); this.code = code; this.statusCode = statusCode; this.outcome = outcome;
  }
}
export const presets: Record<GooglePreset, string[]> = {
  gmail_read: ["https://www.googleapis.com/auth/gmail.readonly"],
  calendar_read: ["https://www.googleapis.com/auth/calendar.readonly"],
  household_calendar_manage: ["https://www.googleapis.com/auth/calendar.events"],
};
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConnectionsError("invalid_connection_request", 400);
  return value as Record<string, unknown>;
}
export function fields(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).some(key => !keys.includes(key))) throw new ConnectionsError("invalid_connection_request", 400);
}
export function string(value: unknown, maximum = 256): string {
  if (typeof value !== "string" || !value.length || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value))
    throw new ConnectionsError("invalid_connection_request", 400);
  return value;
}
export function operation(value: unknown): string {
  const result = string(value, 96);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/.test(result)) throw new ConnectionsError("invalid_connection_request", 400);
  return result;
}
export function origin(value: unknown): string {
  let url: URL;
  try { url = new URL(string(value, 512)); } catch { throw new ConnectionsError("invalid_connection_origin", 400); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname))
    throw new ConnectionsError("invalid_connection_origin", 400);
  return url.origin;
}
export function redirect(value: unknown): string {
  let url: URL;
  try { url = new URL(string(value, 1024)); } catch { throw new ConnectionsError("invalid_google_redirect", 400); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || (!loopback && isIP(url.hostname.replace(/^\[|\]$/g, "")) !== 0) || url.username || url.password || url.search || url.hash)
    throw new ConnectionsError("invalid_google_redirect", 400);
  return url.href;
}
