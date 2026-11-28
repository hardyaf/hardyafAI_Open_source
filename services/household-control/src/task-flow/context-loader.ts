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
    let root:string,manifest:Mapping;
    const fallback=(domain:DomainProjection):TaskDomain=>({...domain,instructions:"Optional guide unavailable. Use the current authorized tool schemas and choose useful methods."});
    try{
      root=await realpath(this.root);
      manifest=JSON.parse(await readFile(path.join(root,"household-domains.json"),"utf8"));
      if(manifest.schemaVersion!==1||!manifest.domains||typeof manifest.domains!=="object")return authorized.map(fallback);
    }catch{return authorized.map(fallback);}
    const result: TaskDomain[] = [];
    for (const domain of authorized) {
      const entry = manifest.domains[domain.id];
      if (!entry) { result.push({ ...domain, instructions: "Use the authorized typed tools and inspect their exact native schema before execution." }); continue; }
      if (typeof entry.path !== "string" || path.isAbsolute(entry.path) || entry.path.includes("\\") || entry.path.split("/").some(part => !part || part === "." || part === "..")) {result.push(fallback(domain));continue;}
      const target = path.resolve(root, entry.path), relative = path.relative(root, target);
      if (relative.startsWith("..") || path.isAbsolute(relative)) throw new PlatformError("task_skill_path_invalid", 503);
      let instructions:string;
      try{
        const stat=await lstat(target),resolved=await realpath(target);
        if(!stat.isFile()||stat.isSymbolicLink()||resolved!==target){result.push(fallback(domain));continue;}
        instructions=await readFile(target,"utf8");
      }catch{result.push(fallback(domain));continue;}
      const description=typeof entry.description==='string'&&entry.description.trim()&&!/[\x00-\x1f\x7f]/.test(entry.description)?entry.description:domain.description;
      result.push({ ...domain, description, instructions });
    }
    return result;
  }
}
