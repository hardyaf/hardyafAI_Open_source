import { lstat, readFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { PlatformError } from "../platform/errors.ts";
import type { TaskDomain } from "./types.ts";

type DomainProjection = { id: string; description: string; tools: string[] };
type Mapping = { schemaVersion: 1; domains: Record<string, { path: string; description?: string }> };
export type LoadedTaskContract = { domainId: string; contractDigest: string };
export function taskContractDigest(instructions: string): string { return createHash("sha256").update(instructions, "utf8").digest("hex"); }
/** Source-owned instruction projection. Capability membership still belongs to live admission. */
export class SelectedDomainContextLoader {
  private readonly root: string;
  constructor(skillsRoot: string) {
    if (!path.isAbsolute(skillsRoot)) throw new PlatformError("task_skills_root_invalid", 500);
    this.root = skillsRoot;
  }
  async load(authorized: DomainProjection[]): Promise<TaskDomain[]> {
    const root = await realpath(this.root);
    const manifest = JSON.parse(await readFile(path.join(root, "household-domains.json"), "utf8")) as Mapping;
    if (manifest.schemaVersion !== 1 || !manifest.domains || typeof manifest.domains !== "object") throw new PlatformError("task_skill_map_invalid", 503);
    const result: TaskDomain[] = [];
    for (const domain of authorized) {
      const entry = manifest.domains[domain.id];
      if (!entry) { result.push({ ...domain, instructions: "Use the authorized typed tools and inspect their exact native schema before execution." }); continue; }
      if (typeof entry.path !== "string" || path.isAbsolute(entry.path) || entry.path.includes("\\") || entry.path.split("/").some(part => !part || part === "." || part === "..")) throw new PlatformError("task_skill_path_invalid", 503);
      const target = path.resolve(root, entry.path), relative = path.relative(root, target);
      if (relative.startsWith("..") || path.isAbsolute(relative)) throw new PlatformError("task_skill_path_invalid", 503);
      const stat = await lstat(target), resolved = await realpath(target);
      if (!stat.isFile() || stat.isSymbolicLink() || resolved !== target || stat.size > 32 * 1024) throw new PlatformError("task_skill_source_invalid", 503);
      const instructions = await readFile(target, "utf8");
      if (entry.description !== undefined && (typeof entry.description !== "string" || !entry.description.trim() || entry.description.length > 500 || /[\x00-\x1f\x7f]/.test(entry.description))) throw new PlatformError("task_skill_description_invalid", 503);
      result.push({ ...domain, description: entry.description ?? domain.description, instructions });
    }
    return result;
  }
}
