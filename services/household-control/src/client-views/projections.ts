import { ClientViewError } from "./contracts.ts";
import type { ClientReadScope } from "./contracts.ts";
import { isManagedKnowledgePath } from "../domains/memory/recipes.ts";

type Json = Record<string, unknown>;
export const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
export const rows = (value: unknown): Json[] => Array.isArray(value) ? value.filter(item => item && typeof item === "object" && !Array.isArray(item)) as Json[] : [];
export const text = (value: unknown, max = 2000): string => typeof value === "string" ? value.slice(0, max) : "";
export const strings = (value: unknown, max = 40, length = 2000): string[] => Array.isArray(value) ? value.filter(item => typeof item === "string").slice(0,max).map(item => text(item,length)) : [];
export function unwrap(value: unknown): Json { const result = object(value); return result.result && !Array.isArray(result.result) ? object(result.result) : result; }
function revision(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 1) throw new ClientViewError("client_projection_invalid", 503); return Number(value); }
const contactFields = ["full_name","organization","job_title","email","phone","website","address","notes"];
function fields(value: unknown): Json {
  const input = object(value);
  return Object.fromEntries(contactFields.flatMap(key => {
    const values = Array.isArray(input[key]) ? strings(input[key], 30, 2000) : typeof input[key] === "string" ? [text(input[key])] : [];
    return values.length ? [[key, values]] : [];
  }));
}
export function sourceProjection(value: unknown) {
  const row = object(value);
  return { artifactId: text(row.artifactId, 80), sha256: text(row.sha256,64), filename: text(row.filename,180),
    mimeType: text(row.mimeType,80), byteLength: Number.isSafeInteger(row.byteLength) ? Number(row.byteLength) : 0 };
}
export function contactProjection(value: unknown) {
  const row = object(value);
  if (!/^contact-[a-f0-9]{32}$/.test(text(row.id,100)) || !["household","private"].includes(String(row.audience))) throw new ClientViewError("client_projection_invalid",503);
  return { id: row.id, audience: row.audience, currentRevision: revision(row.currentRevision ?? row.revision),
    createdAt: text(row.createdAt,80), updatedAt: text(row.updatedAt,80), fields: fields(row.fields),
    uncertainties: strings(row.uncertainties), sources: rows(row.sources).slice(0,8).map(sourceProjection) };
}
export function contactsProjection(value: unknown) {
  const result = unwrap(value);
  const contacts = rows(result.items ?? result.contacts).slice(0,50).map(contactProjection);
  return { contacts, hasMore: result.hasMore === true, nextOffset: Number.isSafeInteger(result.nextOffset) ? result.nextOffset : null };
}
export function revisionsProjection(value: unknown) {
  const result = unwrap(value);
  return rows(result.items ?? result.revisions).slice(0,30).map(row => ({revision:revision(row.revision),createdAt:text(row.createdAt,80),reason:text(row.reason,80),fields:fields(row.fields),uncertainties:strings(row.uncertainties)}));
}
export function listsProjection(value: unknown, scope: ClientReadScope) {
  const result = unwrap(value);
  const groups = rows(result.lists).filter(row => row.scope === scope);
  const values = groups.length ? groups.flatMap(group => rows(group.items)) : rows(result.items);
  const items = values.filter(row => row.scope === undefined || row.scope === scope).filter(row => row.section !== "Removed").slice(0,1000).map(row => ({
    id:text(row.id,80),text:text(row.text,2000),kind:text(row.kind,40) || ({Shopping:"shopping",Tasks:"task",Waiting:"waiting",Completed:"completed"} as Record<string,string>)[String(row.section)] || "task",
    done:row.done === true || row.checked === true || row.section === "Completed",...(typeof row.due === "string" ? {due:text(row.due,40)} : {}),
  })).filter(row => row.id && row.text);
  return { scope, items, updatedAt: text(result.updatedAt,80), truncated: values.length > 1000 || result.truncated === true };
}
function managedLookup(value: unknown): string {
  const lookup = text(value,240);
  if (!isManagedKnowledgePath(lookup)) throw new ClientViewError("managed_topic_required",403);
  return lookup;
}
export function wikiSearchProjection(value: unknown, scope: ClientReadScope) {
  const top = object(value);
  const values = Array.isArray(top.result) ? rows(top.result) : rows(unwrap(value).pages ?? unwrap(value).results);
  return { scope, pages: values.slice(0,50).filter(row => isManagedKnowledgePath(String(row.path ?? row.lookup ?? row.id))).map(row => ({
    id:managedLookup(row.path ?? row.lookup ?? row.id),title:text(row.title,180) || "Knowledge",excerpt:text(row.snippet ?? row.excerpt ?? row.text,1500),
  })) };
}
export function wikiPageProjection(value: unknown, scope: ClientReadScope, lookup: string) {
  const result = unwrap(value), page = object(result.page ?? result);
  const path = page.path ?? page.lookup ?? lookup;
  if (path !== lookup) throw new ClientViewError("managed_topic_lookup_mismatch",503);
  const body = text(page.content ?? page.body,100000);
  return { scope, page:{id:managedLookup(lookup),title:text(page.title,180) || body.match(/^#\s+(.+)$/m)?.[1]?.slice(0,180) || "Knowledge",
    body, sources:rows(page.sources ?? page.evidence).slice(0,40).map(source => ({title:text(source.title ?? source.label,180) || "Captured source"})),
    truncated:page.truncated === true || (typeof (page.content ?? page.body) === "string" && String(page.content ?? page.body).length > 100000) } };
}
export function receiptReviewProjection(value: unknown) {
  const result = unwrap(value);
  return {items:rows(result.items).slice(0,100).map(row => {
    const source = object(row.source ?? row.receipt);
    const reasons = Array.isArray(row.reasons) ? row.reasons.slice(0,40).map(value => {
      const reason = object(value);
      return typeof value === "string" ? text(value,1000) : text(reason.message ?? reason.label ?? reason.code,1000);
    }).filter(Boolean) : [];
    return {receiptId:text(row.receiptId,128),reviewId:text(row.reviewId,128),revision:revision(row.revision),
      title:text(row.title ?? source.filename ?? source.vendor ?? source.merchant,180) || "Receipt awaiting review",reasons,
      question:text(row.question,2000),updatedAt:text(row.updatedAt,80)};
  }),hasMore:result.hasMore === true};
}
export { managedLookup };
