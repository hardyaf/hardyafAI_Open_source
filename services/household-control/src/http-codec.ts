import type { ServerResponse } from "node:http";
import type { Capability, FamilyProfile } from "./domain.ts";

export function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(body);
}
export function parseJson(body: Buffer): Record<string, unknown> {
  if (!body.length) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(body.toString("utf8")); } catch { throw new Error("invalid_json_object"); }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("invalid_json_object");
  return parsed as Record<string, unknown>;
}
export function requireCapability(response: ServerResponse, context: { profile: FamilyProfile }, capability: Capability): boolean {
  if (context.profile.capabilities.includes(capability)) return true;
  sendJson(response, 403, { error: "forbidden", requiredCapability: capability });
  return false;
}
