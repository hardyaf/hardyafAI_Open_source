import {createHash,randomUUID} from "node:crypto";
import {constants} from "node:fs";
import {lstat,mkdir,open,readdir,rename,unlink} from "node:fs/promises";
import path from "node:path";
import {NativeDomainError} from "../native-contracts.ts";
import type {NativeDomainContext,NativeScope} from "../native-contracts.ts";
import type {MemorySource} from "./source-files.ts";

export type SourceChangeInput={operationId:string;sourceId:string;expectedFingerprint:string;kind:"forget"|"supersede";replacementId?:string};
export type SourceProjectionReceipt={removed:string[];pruned:string[];rebuildRequired:string[]};
export type SourceChangeReceipt=SourceChangeInput&{key:string;scope:NativeScope;status:"pending"|"complete";topicsRemoved:string[];projection?:SourceProjectionReceipt;recordedAt:string;completedAt?:string};
export interface MemorySourceLifecycle {
  validateCorrection(agentId:string,scope:NativeScope,sourceId:string,expectedFingerprint:string,refs:string[],context:NativeDomainContext):Promise<void>;
  list(agentId:string,scope:NativeScope,after:string,limit:number,context:NativeDomainContext):Promise<{sources:Omit<MemorySource,"text"|"sourceIds">[];nextAfterSourceId:string|null}>;
  pending(agentId:string,scope:NativeScope,context:NativeDomainContext):Promise<boolean>;
  beginChange(agentId:string,scope:NativeScope,input:SourceChangeInput,context:NativeDomainContext):Promise<SourceChangeReceipt>;
  retire(agentId:string,scope:NativeScope,receipt:SourceChangeReceipt,context:NativeDomainContext):Promise<void>;
  recordTopics(agentId:string,receipt:SourceChangeReceipt,topics:string[],context:NativeDomainContext,projection?:SourceProjectionReceipt):Promise<SourceChangeReceipt>;
  finishChange(agentId:string,receipt:SourceChangeReceipt,topicsRemoved:string[],context:NativeDomainContext):Promise<SourceChangeReceipt>;
}
export const sourceIdPattern=/^source-[a-f0-9]{64}$/;
export function sourceDigest(value:string):string{return createHash("sha256").update(value).digest("hex");}
export async function safeRead(filename:string):Promise<string>{
  const handle=await open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const stat=await handle.stat();if(!stat.isFile()||stat.nlink!==1||stat.size>256_000)throw new NativeDomainError("memory_source_invalid",409);return await handle.readFile("utf8");}
  finally{await handle.close();}
}
export async function safeDirectory(root:string,parts:readonly string[],create=false):Promise<string>{
  if(!root||!path.isAbsolute(root))throw new NativeDomainError("memory_source_not_configured",503);
  let current=root;
  for(const part of ["",...parts]){
    if(part)current=path.join(current,part);
    if(part&&create)await mkdir(current,{mode:0o700}).catch(error=>{if((error as {code?:string}).code!=="EEXIST")throw error;});
    const stat=await lstat(current);if(!stat.isDirectory()||stat.isSymbolicLink())throw new NativeDomainError("memory_source_path_unsafe",503);
  }
  return current;
}
export async function durableJson(filename:string,value:unknown,context:NativeDomainContext):Promise<void>{
  const temporary=filename+"."+randomUUID()+".tmp",handle=await open(temporary,"wx",0o600);
  try{await handle.writeFile(JSON.stringify(value)+"\n");await handle.sync();await handle.close();context.assertCurrent();await rename(temporary,filename);
    const directory=await open(path.dirname(filename),"r");try{await directory.sync();}finally{await directory.close();}}
  finally{await handle.close().catch(()=>{});await unlink(temporary).catch(error=>{if((error as {code?:string}).code!=="ENOENT")throw error;});}
}
export async function absentOkay(filename:string):Promise<void>{await unlink(filename).catch(error=>{if((error as {code?:string}).code!=="ENOENT")throw error;});}
export async function syncDirectory(directory:string):Promise<void>{const handle=await open(directory,"r");try{await handle.sync();}finally{await handle.close();}}

/** Lifecycle receipts and revision JSON live beside the authoritative memory
 * sources, outside *.md. They are not a second fact store or retrieval index.
 * A tombstone has no fact text and prevents operation replay from resurrecting it.
 */
export class WorkspaceSourceLifecycle implements MemorySourceLifecycle {
  private readonly workspaces:Readonly<Record<string,string>>;
  private readonly readSource:(agentId:string,scope:NativeScope,id:string,context:NativeDomainContext)=>Promise<MemorySource>;
  constructor(workspaces:Readonly<Record<string,string>>,readSource:WorkspaceSourceLifecycle["readSource"]){this.workspaces=workspaces;this.readSource=readSource;}
  private async directory(agentId:string,create=false){return safeDirectory(this.workspaces[agentId],["memory","household-sources"],create);}
  private async state(agentId:string){return safeDirectory(await this.directory(agentId,true),[".household-state"],true);}
  async isRetired(agentId:string,id:string):Promise<boolean>{try{await safeRead(path.join(await this.state(agentId),id+".retired.json"));return true;}catch(error){if((error as {code?:string}).code==="ENOENT")return false;throw error;}}
  async list(agentId:string,scope:NativeScope,after:string,limit:number,context:NativeDomainContext){
    context.assertCurrent();const directory=await this.directory(agentId,true),names=(await readdir(directory)).filter(name=>/^source-[a-f0-9]{64}\.md$/.test(name)).sort();
    if(names.length>5000)throw new NativeDomainError("memory_source_navigation_bound",413);
    const result:Omit<MemorySource,"text"|"sourceIds">[]=[];
    for(const name of names){if(name.slice(0,-3)<=after)continue;
      const source=await this.readSource(agentId,scope,name.slice(0,-3),context).catch(error=>{if((error as {code?:string}).code==="memory_source_retired")return null;throw error;});
      if(!source)continue;const {text:body,sourceIds,...metadata}=source;result.push(metadata);if(result.length>limit)break;
    }
    return {sources:result.slice(0,limit),nextAfterSourceId:result.length>limit?result[limit-1].id:null};
  }
  async pending(agentId:string,scope:NativeScope,context:NativeDomainContext){
    context.assertCurrent();const directory=await this.state(agentId),names=(await readdir(directory)).filter(name=>/^change-[a-f0-9]{64}\.json$/.test(name));
    if(names.length>10000)throw new NativeDomainError("memory_lifecycle_navigation_bound",413);
    for(const name of names){const value=JSON.parse(await safeRead(path.join(directory,name))) as SourceChangeReceipt;
      if(value.scope===scope&&value.status!=="complete")return true;}
    return false;
  }
  private async forChange(agentId:string,scope:NativeScope,id:string,context:NativeDomainContext):Promise<MemorySource>{
    if(!sourceIdPattern.test(id))throw new NativeDomainError("invalid_memory_source_id");
    try{return await this.readSource(agentId,scope,id,context);}
    catch(error){if((error as {code?:string}).code!=="memory_source_retired")throw error;
      const archived=JSON.parse(await safeRead(path.join(await this.state(agentId),id+".history.json"))) as MemorySource;
      if(archived.id!==id||archived.scope!==scope)throw new NativeDomainError("memory_source_invalid",409);return archived;
    }
  }
  async validateCorrection(agentId:string,scope:NativeScope,sourceId:string,expectedFingerprint:string,refs:string[],context:NativeDomainContext){
    const source=await this.forChange(agentId,scope,sourceId,context);
    if(source.fingerprint!==expectedFingerprint)throw new NativeDomainError("memory_source_revision_conflict",409);
    if(!refs.length||refs.some(id=>source.sourceIds.includes(id)||!context.confirmedSourceIds?.includes(id)))throw new NativeDomainError("memory_correction_requires_later_user_source",403);
  }
  async beginChange(agentId:string,scope:NativeScope,input:SourceChangeInput,context:NativeDomainContext){
    context.assertCurrent();if(!sourceIdPattern.test(input.sourceId)||!/^[a-f0-9]{64}$/.test(input.expectedFingerprint))throw new NativeDomainError("invalid_memory_source_id");
    const directory=await this.state(agentId),key="change-"+sourceDigest(context.profileId+"\n"+context.conversationId+"\n"+input.operationId),filename=path.join(directory,key+".json");
    try{const prior=JSON.parse(await safeRead(filename)) as SourceChangeReceipt;
      if(JSON.stringify({...input,scope})!==JSON.stringify({operationId:prior.operationId,sourceId:prior.sourceId,expectedFingerprint:prior.expectedFingerprint,kind:prior.kind,...(prior.replacementId?{replacementId:prior.replacementId}:{}),scope:prior.scope}))
        throw new NativeDomainError("memory_operation_conflict",409);return prior;
    }catch(error){if((error as {code?:string}).code!=="ENOENT")throw error;}
    const source=await this.forChange(agentId,scope,input.sourceId,context);
    if(source.fingerprint!==input.expectedFingerprint)throw new NativeDomainError("memory_source_revision_conflict",409);
    if(input.kind==="supersede"){
      if(!input.replacementId)throw new NativeDomainError("memory_replacement_required");
      const replacement=await this.readSource(agentId,scope,input.replacementId,context);
      if(!replacement.sourceIds.length||replacement.sourceIds.some(id=>source.sourceIds.includes(id)||!context.confirmedSourceIds?.includes(id)))
        throw new NativeDomainError("memory_correction_requires_later_user_source",403);
    }
    const receipt:SourceChangeReceipt={...input,key,scope,status:"pending",topicsRemoved:[],recordedAt:new Date().toISOString()};
    await durableJson(filename,receipt,context);return receipt;
  }
  async retire(agentId:string,scope:NativeScope,receipt:SourceChangeReceipt,context:NativeDomainContext){
    context.assertCurrent();const directory=await this.directory(agentId),state=await this.state(agentId),filename=path.join(directory,receipt.sourceId+".md");
    if(receipt.kind==="supersede"){
      try{const source=await this.readSource(agentId,scope,receipt.sourceId,context);await durableJson(path.join(state,receipt.sourceId+".history.json"),source,context);}
      catch(error){if(!["memory_source_retired","memory_source_not_found"].includes((error as {code?:string}).code??""))throw error;}
    }
    // Publish the content-free retirement marker before unlinking the source.
    await durableJson(path.join(state,receipt.sourceId+".retired.json"),{sourceId:receipt.sourceId,scope,kind:receipt.kind,operationKey:receipt.key,replacementId:receipt.replacementId??null},context);
    context.assertCurrent();await absentOkay(filename);
    if(receipt.kind==="forget")await absentOkay(path.join(state,receipt.sourceId+".history.json"));
    await syncDirectory(directory);await syncDirectory(state);
  }
  async finishChange(agentId:string,receipt:SourceChangeReceipt,topicsRemoved:string[],context:NativeDomainContext){
    const complete:SourceChangeReceipt={...receipt,topicsRemoved:[...new Set([...receipt.topicsRemoved,...topicsRemoved])],status:"complete",completedAt:new Date().toISOString()};
    await durableJson(path.join(await this.state(agentId),receipt.key+".json"),complete,context);return complete;
  }
  async recordTopics(agentId:string,receipt:SourceChangeReceipt,topics:string[],context:NativeDomainContext,projection?:SourceProjectionReceipt){
    // A topic title can itself reveal a fact. Durable deletion receipts keep
    // opaque page references, never the removed topic path/title or its body.
    const previous=receipt.projection;
    const progress={...receipt,topicsRemoved:[...new Set([...receipt.topicsRemoved,...topics.map(value=>"topic-"+sourceDigest(value))])],
      ...(projection?{projection:Object.fromEntries((["removed","pruned","rebuildRequired"] as const).map(key=>[key,[...new Set([...(previous?.[key]??[]),...projection[key].map(value=>"topic-"+sourceDigest(value))])]])) as SourceProjectionReceipt}:{})};
    await durableJson(path.join(await this.state(agentId),receipt.key+".json"),progress,context);return progress;
  }
}
