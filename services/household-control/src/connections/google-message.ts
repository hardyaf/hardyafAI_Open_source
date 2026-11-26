import { createHash } from "node:crypto";
import { ConnectionsError, object } from "./contracts.ts";
import { GOOGLE_BODY_WINDOW_MAX_CHARS } from "../domains/google/message-read.ts";
import type { GoogleMessageReadInput } from "../domains/google/message-read.ts";

const projection = "gmail-plain-text-v1";
const allowedHeaders = new Set(["from", "to", "cc", "bcc", "subject", "date", "reply-to", "message-id"]);
/** No MIME bytes, HTML or attachment payloads cross the credential boundary. */
export function projectGoogleMessage(value: unknown, input: GoogleMessageReadInput, messageScope: string) {
  const message = object(value);
  if (message.id !== input.messageId) throw new ConnectionsError("google_message_identity_mismatch", 503);
  if (!/^[a-f0-9]{64}$/.test(messageScope)) throw new ConnectionsError("google_message_scope_required", 403);
  const payload = message.payload && typeof message.payload === "object" && !Array.isArray(message.payload) ? object(message.payload) : {};
  const omissions = new Set<string>();
  const candidates = (Array.isArray(payload.headers) ? payload.headers : []).filter(item => item && typeof item === "object" && !Array.isArray(item))
    .map(item => item as Record<string, unknown>).filter(item => typeof item.name === "string" && allowedHeaders.has(item.name.toLowerCase()) && typeof item.value === "string");
  if (candidates.length > 24 || candidates.some(item => String(item.name).length > 64 || String(item.value).length > 4096)) omissions.add("headers_truncated");
  const headers = candidates.slice(0, 24).map(item => ({name: String(item.name).slice(0, 64),
    value: String(item.value).replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 4096)}));
  const parts: Array<{value: Record<string, unknown>; depth: number}> = [{value: payload, depth: 0}];
  const plain: string[] = [];
  let visited = 0, projectionComplete = input.format !== "metadata";
  if (input.format === "metadata") omissions.add("body_not_requested");
  else while (parts.length && visited < 100) {
    const part = parts.pop()!; visited++;
    const body = part.value.body && typeof part.value.body === "object" && !Array.isArray(part.value.body) ? object(part.value.body) : {};
    if (part.value.filename || typeof body.attachmentId === "string") { omissions.add("attachments_not_returned"); continue; }
    if (part.value.mimeType === "text/html") omissions.add("html_not_returned");
    if (part.value.mimeType === "text/plain") {
      const data = body.data;
      if (typeof data === "string" && /^[A-Za-z0-9_-]*={0,2}$/.test(data)) {
        try { const decoded = Buffer.from(data, "base64url");
          if (decoded.toString("base64url") !== data.replace(/=+$/, "")) throw new Error("invalid_base64");
          plain.push(new TextDecoder("utf-8", {fatal: true}).decode(decoded)); }
        catch { projectionComplete = false; omissions.add("invalid_text_encoding"); }
      } else if (body.size === 0 && data === undefined) plain.push("");
      else { projectionComplete = false; omissions.add("text_part_unavailable"); }
    }
    if (Array.isArray(part.value.parts)) {
      if (part.depth >= 12) { projectionComplete = false; omissions.add("mime_depth_limit"); }
      else for (const child of [...part.value.parts].reverse())
        if (child && typeof child === "object" && !Array.isArray(child)) parts.push({value: child, depth: part.depth + 1});
    }
  }
  if (input.format !== "metadata" && parts.length) { projectionComplete = false; omissions.add("mime_part_limit"); }
  const originalSnippet = typeof message.snippet === "string" ? message.snippet : "";
  if (originalSnippet.length > 2000) omissions.add("snippet_truncated");
  const snippet = originalSnippet.slice(0, 2000);
  const bodySource = plain.length ? "text/plain" : "snippet";
  if (!plain.length && input.format !== "metadata") { projectionComplete = false; omissions.add("snippet_only"); }
  const text = plain.length ? plain.join("\n") : snippet;
  const version = "sha256-v1:" + createHash("sha256").update(JSON.stringify({
    projection, messageScope, id: message.id, threadId: message.threadId ?? "", headers, snippet,
    internalDate: message.internalDate ?? "", bodySource, text, projectionComplete, omissions: [...omissions].sort(),
  })).digest("hex");
  const offset = input.bodyWindow?.offset ?? 0, chars = Array.from(text), totalChars = chars.length;
  if (input.bodyWindow?.version !== undefined && input.bodyWindow.version !== version)
    throw new ConnectionsError("google_message_version_changed", 409);
  if (offset > totalChars) throw new ConnectionsError("google_message_window_out_of_range", 400);
  const endOffset = Math.min(totalChars, offset + (input.bodyWindow?.maxChars ?? GOOGLE_BODY_WINDOW_MAX_CHARS));
  if (offset > 0 || endOffset < totalChars) omissions.add("body_window");
  const complete = projectionComplete && endOffset === totalChars;
  return {id: String(message.id), threadId: typeof message.threadId === "string" ? message.threadId : "",
    headers, snippet, body: chars.slice(offset, endOffset).join(""), bodySource,
    bodyTruncated: !projectionComplete || offset > 0 || endOffset < totalChars,
    bodyComplete: complete && offset === 0,
    bodyWindow: {projection, version, offset, endOffset, totalChars, nextOffset: endOffset < totalChars ? endOffset : null, complete},
    omissions: [...omissions],
    ...(typeof message.internalDate === "string" ? {internalDate: message.internalDate} : {})};
}
