import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import type { ArtifactStore, ArtifactScope } from "../platform/artifacts.ts";
import { DomainError } from "./common.ts";

export type NativeMediaFact = { path?: string; contentType?: string; messageId?: string; kind?: string };
const supported = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);
const inferredMime=(fact:NativeMediaFact)=>typeof fact.contentType === "string" ? fact.contentType.split(";", 1)[0].trim().toLowerCase() :
  ({".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",".pdf":"application/pdf"}[path.extname(fact.path ?? "").toLowerCase()] ?? "");
export const supportsDiscordArtifact=(fact:NativeMediaFact)=>supported.has(inferredMime(fact));
/** Native transport owns staging and URLs. This adapter copies bounded originals, never fetches a model-supplied URL. */
export async function importDiscordArtifacts(options: { artifacts: ArtifactStore; scope: ArtifactScope; media: readonly NativeMediaFact[];
  messageId: string; mediaRoot?: string; assertCurrent(): void }): Promise<string[]> {
  if (options.media.length > 12) throw new DomainError("discord_attachment_limit");
  if(!options.media.some(fact=>supported.has(inferredMime(fact))))return [];
  const configuredRoot = options.mediaRoot ?? path.join(process.env.OPENCLAW_STATE_DIR ?? path.join(homedir(), ".openclaw"), "media");
  const root = await realpath(configuredRoot), result: string[] = [];
  for (const [index, fact] of options.media.entries()) {
    const mime = inferredMime(fact);
    if (!supported.has(mime)) continue;
    if (fact.messageId && fact.messageId !== options.messageId) throw new DomainError("discord_attachment_message_conflict");
    if (typeof fact.path !== "string" || !path.isAbsolute(fact.path)) throw new DomainError("discord_attachment_not_staged");
    options.assertCurrent();
    const resolved = await realpath(fact.path), relative = path.relative(root, resolved);
    if (!relative || relative.startsWith(".." + path.sep) || relative === ".." || path.isAbsolute(relative)) throw new DomainError("discord_attachment_path_not_authorized");
    const stat = await lstat(fact.path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > options.artifacts.maxBytes) throw new DomainError("discord_attachment_file_invalid");
    const handle = await open(fact.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let bytes: Buffer;
    try {
      const current = await handle.stat();
      if (!current.isFile() || current.nlink !== 1 || current.dev !== stat.dev || current.ino !== stat.ino || current.size !== stat.size) throw new DomainError("discord_attachment_changed");
      const buffer=Buffer.alloc(current.size);let offset=0;
      while(offset<buffer.length){const read=await handle.read(buffer,offset,buffer.length-offset,offset);if(!read.bytesRead)break;offset+=read.bytesRead;}
      const after=await handle.stat();
      if(after.size!==current.size)throw new DomainError("discord_attachment_changed");
      bytes=buffer.subarray(0,offset);
      if (bytes.length !== current.size) throw new DomainError("discord_attachment_changed");
    } finally { await handle.close(); }
    options.assertCurrent();
    const extension = mime === "image/jpeg" ? "jpg" : mime.split("/")[1];
    const saved = await options.artifacts.put(options.scope, { profileId: options.scope.ownerProfileId, canReadHousehold: true }, {
      bytes, mimeType: mime, kind: "input", filename: "discord-attachment-" + (index + 1) + "." + extension,
      idempotencyKey: "discord-original:" + options.messageId + ":" + index });
    options.assertCurrent(); result.push(saved.id);
  }
  return result;
}
