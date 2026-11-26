import { NativeDomainError } from "./native-contracts.ts";
import type { NativeDomainContext, NativeJson, NativeScope } from "./native-contracts.ts";

export function record(value: unknown): NativeJson {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new NativeDomainError("invalid_arguments");
  return value as NativeJson;
}
export function closed(value: unknown, allowed: readonly string[], required: readonly string[] = []): NativeJson {
  const input = record(value);
  if (Object.keys(input).some(key => !allowed.includes(key)) || required.some(key => input[key] === undefined)) throw new NativeDomainError("invalid_arguments");
  return input;
}
export function text(value: unknown, max = 2000, allowEmpty = false): string {
  if (typeof value !== "string" || value.includes("\0") || value.length > max || (!allowEmpty && !value.trim())) throw new NativeDomainError("invalid_text");
  return value;
}
export function integer(value: unknown, fallback: number, minimum = 1, maximum = 100): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) throw new NativeDomainError("invalid_integer");
  return value as number;
}
export function boolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new NativeDomainError("invalid_boolean");
  return value;
}
export function scope(value: unknown, context: NativeDomainContext): NativeScope {
  if (value !== "personal" && value !== "household") throw new NativeDomainError("invalid_scope");
  if (!context.allowedScopes.includes(value) || value === "personal" && context.audience !== "private") throw new NativeDomainError("scope_not_authorized", 403);
  context.assertCurrent(); return value;
}
export function operation(value: unknown): string {
  const id = text(value, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(id)) throw new NativeDomainError("invalid_operation_id");
  return id;
}
export function choice(value: unknown, allowed: readonly string[], fallback?: string): string {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "string" || !allowed.includes(value)) throw new NativeDomainError("invalid_choice");
  return value;
}
export function strings(value: unknown, maximum = 40, stringMaximum = 1000): string[] {
  if (!Array.isArray(value) || value.length > maximum) throw new NativeDomainError("invalid_array");
  return value.map(item => text(item, stringMaximum));
}
export function dateOnly(value: unknown): string {
  const date = text(value, 10);
  const epoch=Date.parse(date + "T00:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(epoch) || new Date(epoch).toISOString().slice(0,10) !== date) throw new NativeDomainError("invalid_date");
  return date;
}
export function timezone(value: unknown): string {
  const name = text(value, 100);
  try { new Intl.DateTimeFormat("en", { timeZone: name }).format(0); } catch { throw new NativeDomainError("invalid_timezone"); }
  return name;
}
export function rfc3339Instant(value:unknown):string {
  const input=text(value,40);
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(input)||!Number.isFinite(Date.parse(input)))throw new NativeDomainError("explicit_offset_required");
  const local=input.slice(0,19),wallEpoch=Date.parse(local+"Z");
  if(!Number.isFinite(wallEpoch)||new Date(wallEpoch).toISOString().slice(0,19)!==local)throw new NativeDomainError("invalid_datetime");
  return input;
}
export function safeLookup(value: unknown): string {
  const lookup = text(value, 240);
  if (lookup.startsWith("/") || lookup.includes("\\") || /(^|\/)\.\.(\/|$)/.test(lookup) || /^[A-Za-z]:/.test(lookup)) throw new NativeDomainError("invalid_lookup");
  return lookup;
}
