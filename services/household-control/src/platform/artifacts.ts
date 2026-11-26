import { constants } from "node:fs";
import { lstat, mkdir, open, opendir, realpath, rename, rmdir, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { PlatformError } from "./errors.ts";

export type ArtifactAudience = "private" | "household";
export type ArtifactPrincipal = { profileId: string; canReadHousehold: boolean };
export type ArtifactScope = {
  ownerProfileId: string;
  conversationId: string;
  taskId: string;
  audience: ArtifactAudience;
};
export type ArtifactMetadata = ArtifactScope & {
  id: string;
  schemaVersion: 1;
  filename: string;
  mimeType: string;
  kind: "input" | "output" | "evidence";
  byteLength: number;
  sha256: string;
  createdAt: string;
};
export type ArtifactInput = {
  bytes: Buffer;
  filename: string;
  mimeType: string;
  kind: ArtifactMetadata["kind"];
  idempotencyKey?: string;
};

const mimeTypes = new Set([
  "image/png", "image/jpeg", "image/webp", "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain", "text/csv", "text/x-python", "application/json", "text/html", "image/svg+xml",
]);
const idPattern = /^artifact-[0-9a-f]{64}$/;
const scopePattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const noFollow = constants.O_NOFOLLOW ?? 0;

function hash(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}
function safeFilename(value: unknown): value is string {
  if (typeof value !== "string" || !value.length || Buffer.byteLength(value) > 200) return false;
  try { encodeURIComponent(value); } catch { return false; }
  return !value.includes("/") && !value.includes(String.fromCharCode(92)) &&
    !Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}
function validateScope(scope: ArtifactScope): void {
  if (![scope.ownerProfileId, scope.conversationId, scope.taskId].every((value) => typeof value === "string" && scopePattern.test(value)) ||
    !["private", "household"].includes(scope.audience)) throw new PlatformError("artifact_scope_invalid", 400);
}
function authorize(metadata: ArtifactScope, principal: ArtifactPrincipal, write = false): void {
  if (metadata.ownerProfileId === principal.profileId) return;
  if (!write && metadata.audience === "household" && principal.canReadHousehold) return;
  throw new PlatformError("artifact_not_found", 404);
}
function assertMedia(bytes: Buffer, mimeType: string): void {
  if (!mimeTypes.has(mimeType)) throw new PlatformError("artifact_media_unsupported", 415);
  const signatures: Record<string, boolean> = {
    "image/png": bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    "image/jpeg": bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
    "image/webp": bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP",
    "application/pdf": bytes.subarray(0, 5).toString("ascii") === "%PDF-",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": bytes.subarray(0,4).equals(Buffer.from([80,75,3,4])),
  };
  if (mimeType in signatures && !signatures[mimeType]) throw new PlatformError("artifact_media_mismatch", 415);
  if (mimeType.startsWith("text/") || mimeType === "application/json" || mimeType === "image/svg+xml") {
    try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new PlatformError("artifact_text_encoding_invalid", 415); }
  }
}
async function privateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new PlatformError("artifact_storage_unsafe", 503);
  if (process.platform !== "win32" && ((stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid()))) {
    throw new PlatformError("artifact_storage_permissions", 503);
  }
}
async function readRegular(filename: string, maxBytes: number): Promise<Buffer> {
  const handle = await open(filename, constants.O_RDONLY | noFollow);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > maxBytes) throw new PlatformError("artifact_storage_invalid", 503);
    return await handle.readFile();
  } finally { await handle.close(); }
}

export class ArtifactStore {
  readonly maxBytes: number;
  private readonly configuredRoot: string;
  private root: string | null = null;

  constructor(options: { root: string; maxBytes?: number }) {
    if (!path.isAbsolute(options.root)) throw new PlatformError("artifact_root_invalid", 500);
    this.configuredRoot = options.root;
    this.maxBytes = options.maxBytes ?? 25 * 1024 * 1024;
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 1 || this.maxBytes > 100 * 1024 * 1024) {
      throw new PlatformError("artifact_limit_invalid", 500);
    }
  }

  async initialize(): Promise<void> {
    await privateDirectory(this.configuredRoot);
    this.root = await realpath(this.configuredRoot);
    await privateDirectory(path.join(this.root, "objects"));
    await privateDirectory(path.join(this.root, "staging"));
  }

  readiness() {
    return { status: this.root ? "ready" : "not_initialized", maxBytes: this.maxBytes } as const;
  }

  private objectPath(id: string): string {
    if (!this.root) throw new PlatformError("artifact_storage_unavailable", 503);
    if (!idPattern.test(id)) throw new PlatformError("artifact_not_found", 404);
    return path.join(this.root, "objects", id);
  }

  private async metadata(id: string): Promise<ArtifactMetadata> {
    try {
      const directory = this.objectPath(id);
      const stat = await lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new PlatformError("artifact_storage_invalid", 503);
      const metadata = JSON.parse((await readRegular(path.join(directory, "manifest.json"), 16_384)).toString("utf8")) as ArtifactMetadata;
      validateScope(metadata);
      if (metadata.id !== id || metadata.schemaVersion !== 1 || !mimeTypes.has(metadata.mimeType) ||
        !/^[0-9a-f]{64}$/.test(metadata.sha256) || !Number.isSafeInteger(metadata.byteLength) ||
        metadata.byteLength < 0 || metadata.byteLength > this.maxBytes ||
        !["input", "output", "evidence"].includes(metadata.kind) || !safeFilename(metadata.filename) ||
        !Number.isFinite(Date.parse(metadata.createdAt))) throw new PlatformError("artifact_storage_invalid", 503);
      return metadata;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") throw new PlatformError("artifact_not_found", 404);
      if (error instanceof PlatformError) throw error;
      throw new PlatformError("artifact_storage_invalid", 503);
    }
  }

  async get(id: string, principal: ArtifactPrincipal): Promise<ArtifactMetadata> {
    const metadata = await this.metadata(id);
    authorize(metadata, principal);
    return metadata;
  }

  async read(id: string, principal: ArtifactPrincipal): Promise<{ metadata: ArtifactMetadata; bytes: Buffer }> {
    const metadata = await this.get(id, principal);
    const bytes = await readRegular(path.join(this.objectPath(id), "content"), this.maxBytes);
    if (bytes.length !== metadata.byteLength || hash(bytes) !== metadata.sha256) throw new PlatformError("artifact_integrity_failed", 503);
    return { metadata, bytes };
  }

  async put(scope: ArtifactScope, principal: ArtifactPrincipal, input: ArtifactInput): Promise<ArtifactMetadata> {
    validateScope(scope);
    authorize(scope, principal, true);
    if (!this.root) throw new PlatformError("artifact_storage_unavailable", 503);
    if (!Buffer.isBuffer(input.bytes) || input.bytes.length > this.maxBytes) throw new PlatformError("artifact_too_large", 413);
    if (!["input", "output", "evidence"].includes(input.kind)) throw new PlatformError("artifact_kind_invalid", 400);
    if (!safeFilename(input.filename)) throw new PlatformError("artifact_filename_invalid", 400);

    if (input.idempotencyKey !== undefined &&
      (typeof input.idempotencyKey !== "string" || input.idempotencyKey.length < 8 || input.idempotencyKey.length > 200)) {
      throw new PlatformError("artifact_operation_invalid", 400);
    }
    assertMedia(input.bytes, input.mimeType);
    const identity = JSON.stringify([scope.ownerProfileId, scope.conversationId, scope.taskId, input.idempotencyKey ?? randomUUID()]);
    const id = "artifact-" + hash(identity);
    const metadata: ArtifactMetadata = {
      ...scope, id, schemaVersion: 1, filename: input.filename, mimeType: input.mimeType,
      kind: input.kind, byteLength: input.bytes.length, sha256: hash(input.bytes), createdAt: new Date().toISOString(),
    };
    const same = (existing: ArtifactMetadata) => existing.sha256 === metadata.sha256 &&
      existing.ownerProfileId === scope.ownerProfileId && existing.conversationId === scope.conversationId &&
      existing.taskId === scope.taskId && existing.audience === scope.audience &&
      existing.kind === metadata.kind && existing.mimeType === metadata.mimeType && existing.filename === metadata.filename;
    try {
      const existing = await this.metadata(id);
      if (!same(existing)) throw new PlatformError("artifact_operation_conflict", 409);
      return existing;
    } catch (error) {
      if (!(error instanceof PlatformError) || error.code !== "artifact_not_found") throw error;
    }
    const stage = path.join(this.root, "staging", randomUUID());
    await privateDirectory(stage);
    try {
      const blob = await open(path.join(stage, "content"), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow, 0o600);
      try { await blob.writeFile(input.bytes); await blob.sync(); } finally { await blob.close(); }
      const manifest = await open(path.join(stage, "manifest.json"), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow, 0o600);
      try { await manifest.writeFile(JSON.stringify(metadata)); await manifest.sync(); } finally { await manifest.close(); }
      try { await rename(stage, this.objectPath(id)); }
      catch (error) {
        if (!["EEXIST", "ENOTEMPTY", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
        const existing = await this.metadata(id);
        if (!same(existing)) throw new PlatformError("artifact_operation_conflict", 409);
        return existing;
      }
      const directory = await open(path.join(this.root, "objects"), constants.O_RDONLY);
      try { await directory.sync(); } finally { await directory.close(); }
      return metadata;
    } finally {
      // Only remove the generated staging files; committed objects are immutable.
      await unlink(path.join(stage, "content")).catch(() => {});
      await unlink(path.join(stage, "manifest.json")).catch(() => {});
      await rmdir(stage).catch(() => {});
    }
  }

  async list(principal: ArtifactPrincipal, filter: { conversationId: string; taskId?: string; limit?: number }) {
    if (!this.root) throw new PlatformError("artifact_storage_unavailable", 503);
    if (!scopePattern.test(filter.conversationId) || (filter.taskId && !scopePattern.test(filter.taskId))) throw new PlatformError("artifact_scope_invalid", 400);
    if (filter.limit !== undefined && (!Number.isSafeInteger(filter.limit) || filter.limit < 1)) throw new PlatformError("artifact_limit_invalid", 400);
    const limit = Math.min(filter.limit ?? 100, 200);
    const entries = await opendir(path.join(this.root, "objects"));
    const items: ArtifactMetadata[] = [];
    let scanned = 0;
    let truncated = false;
    for await (const entry of entries) {
      if (++scanned > 5000) { truncated = true; break; }
      if (!entry.isDirectory() || !idPattern.test(entry.name)) continue;
      const metadata = await this.metadata(entry.name);
      try { authorize(metadata, principal); } catch { continue; }
      if (metadata.conversationId === filter.conversationId && (!filter.taskId || metadata.taskId === filter.taskId)) items.push(metadata);
    }
    items.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id));
    return { items: items.slice(0, limit), truncated: truncated || items.length > limit };
  }
}

export function artifactResponseHeaders(metadata: ArtifactMetadata): Record<string, string> {
  const inline = ["image/png", "image/jpeg", "image/webp"].includes(metadata.mimeType);
  return {
    "Content-Type": metadata.mimeType,
    "Content-Length": String(metadata.byteLength),
    "Content-Disposition": (inline ? "inline" : "attachment") + "; filename*=UTF-8''" + encodeURIComponent(metadata.filename),
    "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  };
}
