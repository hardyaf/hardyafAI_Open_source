import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { PlatformError } from "../platform/errors.ts";

const allowed: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".html": "text/html", ".json": "application/json", ".csv": "text/csv", ".txt": "text/plain" };
const inside = (root: string, target: string) => { const relative = path.relative(root, target); return !!relative && !relative.startsWith("..") && !path.isAbsolute(relative); };
const fail = (): never => { throw new PlatformError("analysis_output_path_invalid", 403); };

/** The native workspace is trusted metadata; only a fixed output child and basename are model input. */
export async function readAnalysisOutput(workspaceDir: string | undefined, relativePath: string, configuredRoots: string[]) {
  if (!workspaceDir || !path.isAbsolute(workspaceDir) || !/^outputs\/[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(relativePath) || !configuredRoots.length) fail();
  const workspace = await realpath(workspaceDir);
  if (workspace !== path.resolve(workspaceDir)) fail();
  let contained = false;
  for (const root of configuredRoots) {
    if (!path.isAbsolute(root)) fail();
    const resolvedRoot = await realpath(root);
    if (inside(resolvedRoot, workspace)) contained = true;
  }
  if (!contained) fail();
  const outputDirectory = path.join(workspace, "outputs"), filename = path.basename(relativePath), target = path.join(outputDirectory, filename);
  const directory = await lstat(outputDirectory);
  if (!directory.isDirectory() || directory.isSymbolicLink() || await realpath(outputDirectory) !== outputDirectory) fail();
  const mimeType = allowed[path.extname(filename).toLowerCase()];
  if (!mimeType) throw new PlatformError("analysis_output_type_unsupported", 415);
  // Anchor the mutable child directory by descriptor. Linux /proc/self/fd prevents
  // a child swapping outputs/ to a host-pointing symlink between checks and open.
  if (process.platform !== "linux") throw new PlatformError("analysis_output_host_unsupported", 503);
  const directoryHandle = await open(outputDirectory, constants.O_RDONLY | constants.O_DIRECTORY | (constants.O_NOFOLLOW ?? 0));
  const handle = await open("/proc/self/fd/" + directoryHandle.fd + "/" + filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(async error => { await directoryHandle.close(); throw error; });
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size > 25 * 1024 * 1024 ||
      (process.getuid && before.uid !== process.getuid())) fail();
    const bytes = await handle.readFile(), after = await handle.stat();
    if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes.length !== after.size || await realpath(target) !== target) fail();
    if (mimeType.startsWith("text/") || mimeType === "application/json") {
      try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { fail(); }
      if (mimeType === "application/json") { try { JSON.parse(bytes.toString("utf8")); } catch { throw new PlatformError("analysis_output_json_invalid", 415); } }
    }
    return { filename, mimeType, bytes };
  } finally { await handle.close(); await directoryHandle.close(); }
}
