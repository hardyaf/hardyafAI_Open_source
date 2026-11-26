import {lstat,open,readdir,rename,unlink} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import path from "node:path";
import {NativeDomainError} from "../native-contracts.ts";
import type {NativeDomainContext} from "../native-contracts.ts";
import {safeDirectory,safeRead,sourceDigest,sourceIdPattern,syncDirectory} from "./source-lifecycle.ts";
import {parse as parseYaml} from "yaml";
import {pruneManagedEntry} from "./entry-pruning.ts";
import {memoryPageSeries} from "./append-managed-memory.ts";

export type ManagedWikiSnapshot={fingerprint:string;body:string;metadata:Record<string,unknown>};
export type ManagedSourceProjection={removed:string[];pruned:string[];rebuildRequired:string[]};

export interface ManagedWikiPages {
  references(agentId:string,sourceId:string,context:NativeDomainContext):Promise<string[]>;
  removeReferencing(agentId:string,sourceId:string,context:NativeDomainContext):Promise<string[]>;
  pruneReferencing?(agentId:string,sourceId:string,context:NativeDomainContext,recordPlan?:(plan:ManagedSourceProjection)=>Promise<void>):Promise<ManagedSourceProjection>;
  readManaged?(agentId:string,lookup:string,context:NativeDomainContext):Promise<ManagedWikiSnapshot|null>;
  listManagedParts?(agentId:string,rootLookup:string,context:NativeDomainContext):Promise<string[]>;
  assertManagedUnchanged?(agentId:string,lookup:string,fingerprint:string|null,context:NativeDomainContext):Promise<void>;
}
/** Native wiki.apply has no source-aware deletion in pinned 2026.9.8. This
 * adapter changes only our attributed synthesis namespace in the same vault.
 * Native compiler and memory-core index remain the only derived authorities.
 */
export class LocalManagedWikiPages implements ManagedWikiPages {
  private readonly vaults:Readonly<Record<string,string>>;
  constructor(config:{vaults:Readonly<Record<string,string>>}){this.vaults=config.vaults;}
  async listManagedParts(agentId:string,rootLookup:string,context:NativeDomainContext):Promise<string[]>{
    context.assertCurrent();if(!/^syntheses\/household-topic-[\p{L}\p{N}\p{M}-]+\.md$/u.test(rootLookup))throw new NativeDomainError("managed_topic_required",403);
    const prefix=memoryPageSeries(rootLookup).lookupPrefix.slice("syntheses/".length);
    let names:string[];try{names=await readdir(await safeDirectory(this.vaults[agentId],["syntheses"]));}
    catch(error){if((error as {code?:string}).code==="ENOENT")return [rootLookup];throw error;}
    const parts=names.filter(name=>name.startsWith(prefix)&&/^[2-9]\d*\.md$|^1\d+\.md$/.test(name.slice(prefix.length)))
      .sort((a,b)=>Number(a.slice(prefix.length,-3))-Number(b.slice(prefix.length,-3)));
    if(parts.length>=5000)throw new NativeDomainError("managed_topic_navigation_bound",413);
    context.assertCurrent();return [rootLookup,...parts.map(name=>"syntheses/"+name)];
  }
  async readManaged(agentId:string,lookup:string,context:NativeDomainContext):Promise<ManagedWikiSnapshot|null>{
    context.assertCurrent();
    if(!/^syntheses\/household-topic-[\p{L}\p{N}\p{M}-]+\.md$/u.test(lookup))throw new NativeDomainError("managed_topic_required",403);
    let raw:string;
    try{const directory=await safeDirectory(this.vaults[agentId],["syntheses"]);raw=await safeRead(path.join(directory,path.posix.basename(lookup)));}
    catch(error){if((error as {code?:string}).code==="ENOENT")return null;throw error;}
    const match=raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if(!match)throw new NativeDomainError("managed_topic_metadata_invalid",409);
    let metadata:unknown;
    try{metadata=parseYaml(match[1],{maxAliasCount:0,uniqueKeys:true,strict:true});}catch{throw new NativeDomainError("managed_topic_metadata_invalid",409);}
    if(!metadata||typeof metadata!=="object"||Array.isArray(metadata))throw new NativeDomainError("managed_topic_metadata_invalid",409);
    context.assertCurrent();return {fingerprint:sourceDigest(raw),body:raw.slice(match[0].length).trimStart(),metadata:metadata as Record<string,unknown>};
  }
  async assertManagedUnchanged(agentId:string,lookup:string,fingerprint:string|null,context:NativeDomainContext){
    const current=await this.readManaged(agentId,lookup,context);
    if((current?.fingerprint??null)!==fingerprint)throw new NativeDomainError("memory_revision_conflict",409);
  }
  private async matches(agentId:string,sourceId:string,context:NativeDomainContext){
    context.assertCurrent();if(!sourceIdPattern.test(sourceId))throw new NativeDomainError("invalid_memory_source_id");
    let directory:string;
    try{directory=await safeDirectory(this.vaults[agentId],["syntheses"]);}catch(error){if((error as {code?:string}).code==="ENOENT")return [];throw error;}
    const names=(await readdir(directory)).filter(name=>/^household-topic-[\p{L}\p{N}\p{M}-]+\.md$/u.test(name)).sort();
    if(names.length>5000)throw new NativeDomainError("managed_topic_navigation_bound",413);
    const result:{filename:string;lookup:string;hash:string}[]=[];
    for(const name of names){const filename=path.join(directory,name),body=await safeRead(filename);
      if(body.includes(sourceId))result.push({filename,lookup:"syntheses/"+name,hash:sourceDigest(body)});}
    return result;
  }
  async references(agentId:string,sourceId:string,context:NativeDomainContext){return (await this.matches(agentId,sourceId,context)).map(value=>value.lookup);}
  async removeReferencing(agentId:string,sourceId:string,context:NativeDomainContext){
    const result=await this.pruneReferencing(agentId,sourceId,context);return [...result.removed,...result.pruned];
  }
  async pruneReferencing(agentId:string,sourceId:string,context:NativeDomainContext,recordPlan?:(plan:ManagedSourceProjection)=>Promise<void>):Promise<ManagedSourceProjection>{
    const matches=await this.matches(agentId,sourceId,context),plans=[];
    const projection:ManagedSourceProjection={removed:[],pruned:[],rebuildRequired:[]};
    for(const page of matches){
      context.assertCurrent();const raw=await safeRead(page.filename);if(sourceDigest(raw)!==page.hash)throw new NativeDomainError("memory_revision_conflict",409);
      const change=pruneManagedEntry(raw,sourceId);plans.push({...page,action:change.action});
      if(change.action==="prune")projection.pruned.push(page.lookup);else{projection.removed.push(page.lookup);if(change.rebuildRequired)projection.rebuildRequired.push(page.lookup);}
    }
    // The existing source-change receipt records opaque invalidation before
    // effects, so restart cannot lose its required-rebuild disclosure.
    await recordPlan?.(projection);
    for(const page of plans){
      context.assertCurrent();const stat=await lstat(page.filename),raw=await safeRead(page.filename);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||sourceDigest(raw)!==page.hash)throw new NativeDomainError("memory_revision_conflict",409);
      const change=pruneManagedEntry(raw,sourceId);if(change.action!==page.action)throw new NativeDomainError("memory_revision_conflict",409);
      if(change.action==="remove")await unlink(page.filename);
      else{
        const temporary=path.join(path.dirname(page.filename),".source-prune-"+randomUUID()+".tmp"),handle=await open(temporary,"wx",0o600);
        try{
          await handle.writeFile(change.content,"utf8");await handle.sync();await handle.close();context.assertCurrent();
          if(sourceDigest(await safeRead(page.filename))!==page.hash)throw new NativeDomainError("memory_revision_conflict",409);
          await rename(temporary,page.filename);
        }finally{await handle.close().catch(()=>{});await unlink(temporary).catch(error=>{if((error as {code?:string}).code!=="ENOENT")throw error;});}
      }
    }
    if(matches.length)await syncDirectory(path.dirname(matches[0].filename));return projection;
  }
}
