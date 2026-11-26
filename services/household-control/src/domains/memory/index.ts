import { createHash } from "node:crypto";
import { descriptor, integerProperty, NativeDomainError, objectSchema, scopeProperty, textProperty } from "../native-contracts.ts";
import type { NativeDomainContext, NativeJson, NativeRpcPort, NativeScope } from "../native-contracts.ts";
import { boundMemorySourceIds, containsSourceQuote } from "./source-files.ts";
import type { MemorySource, NativeMemorySources } from "./source-files.ts";
import type {ManagedWikiPages} from "./managed-pages.ts";
import {MemorySourceActions} from "./source-actions.ts";
import {rememberMemory} from "./remember.ts";
import {isManagedKnowledgePath,isRecipePath,saveRecipe,saveRecipeTool} from "./recipes.ts";
import type {ReadRecipeReference} from "./recipes.ts";
import type {NativeMemoryReindex} from "./source-actions.ts";
import { closed, integer, operation, safeLookup, scope, strings, text, choice, record } from "../native-validation.ts";

const sourceIds={type:"array",minItems:1,maxItems:40,items:textProperty(240)};
const claim=objectSchema({text:textProperty(2000),sourceIds,evidenceQuote:textProperty(2400),certainty:{type:"string",enum:["fact","inference","uncertain"]}},["text","sourceIds","certainty"]);
const sourceFingerprint={type:"string",pattern:"^[a-f0-9]{64}$"};
export const memoryTools=[
  saveRecipeTool,
  descriptor("household_memory_remember","Remember lasting human-shared facts or inference in one operation. Private-source content writes use personal scope; household writes require an actual shared conversation. Supply an exact current sourceQuote, topic and interpreted claims (with evidenceQuote when wording differs). The domain preserves topic content/claims and appends the daily journal without page/hash ceremony. After source_supersede, pass its replacementSourceId as sourceId to curate that same current-human source without another capture. Ordinary capture omits sourceId; old-human or unconfirmed sources cannot be adopted.","memory.write",{scope:scopeProperty,sourceId:{type:"string",pattern:"^source-[a-f0-9]{64}$"},topic:textProperty(150),sourceQuote:textProperty(20_000),claims:{type:"array",minItems:1,maxItems:40,items:objectSchema({text:textProperty(2000),evidenceQuote:textProperty(2400),certainty:{type:"string",enum:["fact","inference","uncertain"]}},["text","certainty"])}},["scope","topic","sourceQuote","claims"],"write"),
  descriptor("household_memory_source_list","Navigate scoped captured source metadata, certainty and stable source IDs. No transcript/private-store fallback.","memory.read",{scope:scopeProperty,afterSourceId:textProperty(80),limit:integerProperty(1,100)},["scope"]),
  descriptor("household_memory_source_references","Find managed topic pages derived from a captured scoped source; read the source and page before resolving a conflict.","memory.read",{scope:scopeProperty,sourceId:textProperty(80)},["scope","sourceId"]),
  descriptor("household_memory_source_supersede","Correct a captured source using an exact quote from a later verified user response. Retires the old source, prunes attributed entries or discloses opaque-page invalidation, retains non-indexed history and refreshes projections. After success call remember with sourceId=returned replacementSourceId and current quote/claims to maintain both topic and daily journal; no manual journal/hash reconstruction.","memory.write",{scope:scopeProperty,sourceId:textProperty(80),expectedFingerprint:sourceFingerprint,title:textProperty(180),text:textProperty(20_000),sourceIds,certainty:{type:"string",enum:["fact","inference","uncertain"]}},["scope","sourceId","expectedFingerprint","title","text","certainty"],"write"),
  descriptor("household_memory_source_forget","Forget an exact captured source and its owned history/dependent managed topics, then refresh native projections. Requires current trusted destructive approval and source fingerprint. Reports retained conversation/backups honestly; no promise of global erasure.","memory.write",{scope:scopeProperty,sourceId:textProperty(80),expectedFingerprint:sourceFingerprint},["scope","sourceId","expectedFingerprint"],"write"),
  descriptor("household_memory_source_save","Save an immutable source in the native memory Markdown tree. Exact current human quotes are attributed automatically; omit internal sourceIds for current-source capture. Paraphrases and inference stay candidates until grounded synthesis.","memory.write",{scope:scopeProperty,title:textProperty(180),text:textProperty(20_000),sourceIds,certainty:{type:"string",enum:["fact","inference","uncertain"]}},["scope","title","text","certainty"],"write"),
  descriptor("household_memory_source_read","Read a scoped explicitly captured memory source by its stable ID. Shared scope never falls through to a private agent store.","memory.read",{scope:scopeProperty,sourceId:textProperty(80)},["scope","sourceId"]),
  descriptor("household_memory_status","Inspect the selected native wiki's structural readiness. This does not claim factual curation or recall acceptance.","memory.read",{scope:scopeProperty},["scope"]),
  descriptor("household_memory_search","Search only the selected native Knowledge wiki. For saved recipes set kind to recipe and query a title, alternate name, or ingredient. Private and household vaults stay separate.","memory.read",{scope:scopeProperty,query:textProperty(2000),kind:{type:"string",enum:["recipe"]},mode:{type:"string",enum:["auto","find-person","route-question","source-evidence","raw-claim"]},limit:integerProperty(1,50)},["scope","query"]),
  descriptor("household_memory_get","Read a native wiki page/claim in the selected scope. Use the returned contentHash when updating an existing topic.","memory.read",{scope:scopeProperty,lookup:textProperty(240),fromLine:integerProperty(1,100_000),lineCount:integerProperty(1,400)},["scope","lookup"]),
  descriptor("household_memory_synthesize","Create or update a managed topic from saved scoped sources. A fact may use normalized wording with an exact supporting evidenceQuote from a bound confirmed source; inference and uncertainty remain candidates. Existing topics require expectedContentHash; new topics require null.","memory.write",{scope:scopeProperty,title:textProperty(180),body:textProperty(20_000),sourceIds,claims:{type:"array",minItems:1,maxItems:40,items:claim},expectedContentHash:{anyOf:[{type:"string",pattern:"^[a-f0-9]{64}$"},{type:"null"}]},questions:{type:"array",maxItems:20,items:textProperty(1000)},contradictions:{type:"array",maxItems:20,items:textProperty(1000)}},["scope","title","body","sourceIds","claims","expectedContentHash"],"write"),
  descriptor("household_memory_annotate","Add contradiction/question/review metadata to an existing native topic without changing its saved source or promoting a candidate claim.","memory.write",{scope:scopeProperty,lookup:textProperty(240),expectedContentHash:{type:"string",pattern:"^[a-f0-9]{64}$"},questions:{type:"array",maxItems:20,items:textProperty(1000)},contradictions:{type:"array",maxItems:20,items:textProperty(1000)}},["scope","lookup","expectedContentHash"],"write"),
  descriptor("household_memory_compile","Rebuild the selected native wiki's derived pages/index/snapshot from its authoritative sources. Uses the native compiler; creates no parallel index.","memory.write",{scope:scopeProperty},["scope"],"write"),
];
export type MemoryDomainConfig={sharedAgentId?:string;enabled:boolean;timeZone?:string};
function contentOf(value:unknown):string|null {
  if(value===null||value===undefined)return null;
  const result=record(value);
  if(typeof result.content==="string")return result.content;
  if(result.page&&typeof result.page==="object"&&typeof record(result.page).content==="string")return record(result.page).content as string;
  return null;
}
function hash(content:string,result:unknown):string {
  const value=record(result);
  return createHash("sha256").update(JSON.stringify({content,updatedAt:value.updatedAt??null,path:value.path??null})).digest("hex");
}
function managedTitle(title:string):string {
  // Stable native synthesis namespace, separate from pages curated outside this adapter.
  const value="Household topic "+title;
  if(Buffer.byteLength(value)>180||/[\r\n]/.test(value))throw new NativeDomainError("topic_title_too_long");
  return value;
}
// Pinned OpenClaw 2026.9.8 native wiki normalization. Managed titles stay below native byte caps.
function slug(value:string):string {return value.trim().toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu,"-").replace(/-+/g,"-").replace(/^-+|-+$/g,"");}

const reviewNotice="<!-- household-memory-review:start -->\n> Review needed: This topic contains candidate claims, unresolved questions or contradictions. Candidate claims are not confirmed facts.\n<!-- household-memory-review:end -->";
function managedBody(body:string,review:boolean):string {
  // Replace only our exact generated notice, preserving all other topic prose.
  const content=body.split(reviewNotice+"\n\n").join("").split(reviewNotice).join("");
  const result=review?reviewNotice+"\n\n"+content:content;
  if(result.length>20_000||result.split("\n").length>350)throw new NativeDomainError("managed_topic_exceeds_read_bound");
  return result;
}

export class MemoryDomain {
  private readonly locks=new Map<string,Promise<void>>();
  private readonly config:MemoryDomainConfig;
  private readonly rpc:NativeRpcPort;
  private readonly sources:NativeMemorySources;
  private readonly sourceActions:MemorySourceActions;
  private readonly pages?:ManagedWikiPages;
  private readonly readRecipeReference?:ReadRecipeReference;
  constructor(config:MemoryDomainConfig,rpc:NativeRpcPort,sources:NativeMemorySources,pages?:ManagedWikiPages,reindex?:NativeMemoryReindex,readRecipeReference?:ReadRecipeReference) {
    this.config=config;this.rpc=rpc;this.sources=sources;this.pages=pages;this.sourceActions=new MemorySourceActions(sources,rpc,pages,reindex);this.readRecipeReference=readRecipeReference;
  }
  private agent(selected:NativeScope,context:NativeDomainContext):string {
    if(!this.config.enabled)throw new NativeDomainError("memory_wiki_not_configured",503);
    if(selected==="household"){
      if(!this.config.sharedAgentId)throw new NativeDomainError("household_wiki_not_configured",503);
      return this.config.sharedAgentId;
    }
    return context.agentId;
  }
  private async current(agentId:string,lookup:string,context:NativeDomainContext):Promise<{content:string|null,result:unknown}> {
    const result=await this.rpc.request("wiki.get",{agentId,lookup,fromLine:1,lineCount:400,backend:"local",corpus:"wiki"},context);
    if(result&&record(result).truncated===true)throw new NativeDomainError("managed_topic_exceeds_read_bound",409);
    return {content:contentOf(result),result};
  }
  private async serial<T>(key:string,operation:()=>Promise<T>):Promise<T> {
    const prior=this.locks.get(key)??Promise.resolve();
    let release!:()=>void;const current=new Promise<void>(resolve=>{release=resolve;});this.locks.set(key,current);
    await prior;
    try{return await operation();}finally{release();if(this.locks.get(key)===current)this.locks.delete(key);}
  }
  async execute(name:string,args:unknown,context:NativeDomainContext):Promise<unknown> {
    context.assertCurrent();
    const common=record(args);const selected=scope(common.scope,context);
    // Scope grants permit access, not publication of this private source. No
    // cross-audience memory publication grant exists in the current contract.
    const contentWrite=memoryTools.some(tool=>tool.name===name&&tool.effect==="write")&&
      !["household_memory_source_forget","household_memory_compile"].includes(name);
    if(contentWrite&&selected==="household"&&context.audience!=="household")
      throw new NativeDomainError("memory_shared_write_requires_shared_conversation",403);
    const agentId=this.agent(selected,context);
    // Agent-wide serialization keeps recall and synthesis outside a partial
    // retire/compile/index sequence, including distinct managed topic names.
    return this.serial(agentId,async()=>{
    if(["household_memory_source_list","household_memory_source_references","household_memory_source_supersede","household_memory_source_forget"].includes(name))
      return this.sourceActions.execute(name,args,agentId,selected,context);
    if(!["household_memory_source_read","household_memory_status"].includes(name))await this.sourceActions.requireReady(agentId,selected,context);
    if(name==="household_memory_remember")return rememberMemory(args,context,{agentId,scope:selected,sources:this.sources,rpc:this.rpc,pages:this.pages,timeZone:this.config.timeZone});
    if(name===saveRecipeTool.name)return saveRecipe(args,context,{agentId,scope:selected,rpc:this.rpc,readReference:this.readRecipeReference});
    if(name==="household_memory_source_save") {
      const input=closed(args,["operationId","scope","title","text","sourceIds","certainty"],["operationId","scope","title","text","certainty"]);
      const refs=boundMemorySourceIds(input.sourceIds,text(input.text,20_000),context);
      const source=await this.sources.save(agentId,selected,{operationId:operation(input.operationId),title:text(input.title,180),text:text(input.text,20_000),sourceIds:refs,certainty:choice(input.certainty,["fact","inference","uncertain"]) as "fact"|"inference"|"uncertain"},context);
      const {text:body,sourceIds:nativeRefs,...metadata}=source;
      return {state:"committed",source:metadata,indexStatus:"native_index_lifecycle",wikiProjection:"not_requested",detailsTool:"household_memory_source_read"};
    }
    if(name==="household_memory_source_read") {
      const input=closed(args,["scope","sourceId"],["scope","sourceId"]);const source=await this.sources.read(agentId,selected,text(input.sourceId,80),context);
      return {source:{...source,sourceIds:undefined},untrusted:source.certainty!=="confirmed"};
    }
    if(name==="household_memory_status") {closed(args,["scope"],["scope"]);return this.rpc.request("wiki.status",{agentId},context);}
    if(name==="household_memory_search") {
      const input=closed(args,["scope","query","kind","mode","limit"],["scope","query"]);
      const recipes=input.kind!==undefined&&choice(input.kind,["recipe"])==="recipe";
      const result=await this.rpc.request("wiki.search",{agentId,query:text(input.query,2000),maxResults:integer(input.limit,10,1,50),mode:choice(input.mode,["auto","find-person","route-question","source-evidence","raw-claim"],"auto"),backend:"local",corpus:"wiki"},context);
      if(!Array.isArray(result))throw new NativeDomainError("native_wiki_search_contract_invalid",503);
      const allowedPath=recipes?isRecipePath:isManagedKnowledgePath;
      return {source:"native_wiki",untrusted:true,result:result.filter(value=>value&&typeof value==="object"&&typeof value.path==="string"&&allowedPath(value.path)),recallScope:recipes?"saved_recipes_only":"managed_household_knowledge_only"};
    }
    if(name==="household_memory_get") {
      const input=closed(args,["scope","lookup","fromLine","lineCount"],["scope","lookup"]);
      const lookup=safeLookup(input.lookup);
      if(!isManagedKnowledgePath(lookup))throw new NativeDomainError("managed_topic_required",403);
      const result=await this.rpc.request("wiki.get",{agentId,lookup,fromLine:integer(input.fromLine,1,1,100_000),lineCount:integer(input.lineCount,400,1,400),backend:"local",corpus:"wiki"},context);
      if(result&&record(result).path!==lookup)throw new NativeDomainError("managed_topic_lookup_mismatch",503);
      const content=contentOf(result);
      const complete=result&&record(result).truncated!==true&&(record(result).fromLine??1)===1;
      return {source:"native_wiki",untrusted:true,result,contentHash:content===null||!complete?null:hash(content,result),hashScope:complete?"full_body_and_native_metadata":"incomplete_excerpt",updateNote:"For edits, retrieve the complete managed page; a partial excerpt cannot authorize a full-page update."};
    }
    if(name==="household_memory_compile") {
      const input=closed(args,["operationId","scope"],["operationId","scope"]);operation(input.operationId);context.assertCurrent();return this.rpc.request("wiki.compile",{agentId},context);
    }
    if(name!=="household_memory_synthesize"&&name!=="household_memory_annotate")throw new NativeDomainError("unknown_tool",404);
    const synthesis=name==="household_memory_synthesize";
    const input=closed(args,["operationId","scope","expectedContentHash","questions","contradictions",...(synthesis?["title","body","sourceIds","claims"]:["lookup"])],["operationId","scope","expectedContentHash",...(synthesis?["title","body","sourceIds","claims"]:["lookup"])]);
    operation(input.operationId);
    const title=synthesis?managedTitle(text(input.title,180)):undefined;
    const lookup=synthesis?"syntheses/"+slug(title!)+".md":safeLookup(input.lookup);
    if(!/^syntheses\/household-topic-[\p{L}\p{N}\p{M}-]+\.md$/u.test(lookup))throw new NativeDomainError("managed_topic_required",403);
    if(input.expectedContentHash!==null&&(typeof input.expectedContentHash!=="string"||!/^[a-f0-9]{64}$/.test(input.expectedContentHash)))throw new NativeDomainError("invalid_content_hash");
    return this.serial(agentId+"\n"+lookup,async()=>{
      const current=await this.current(agentId,lookup,context);
      if((current.content===null?null:hash(current.content,current.result))!==input.expectedContentHash)throw new NativeDomainError("memory_revision_conflict",409);
      if(synthesis&&text(input.body,20_000).split("\n").length>350)throw new NativeDomainError("managed_topic_exceeds_read_bound");
      const mutation:NativeJson={agentId,op:synthesis?"create_synthesis":"update_metadata",...(synthesis?{title,body:text(input.body,20_000)}:{lookup}),
        ...(input.questions!==undefined?{questions:strings(input.questions,20,1000)}:{}),...(input.contradictions!==undefined?{contradictions:strings(input.contradictions,20,1000)}:{})};
      if(synthesis) {
        const ids=strings(input.sourceIds,40,80);if(!ids.length)throw new NativeDomainError("source_reference_required");
        const sources=new Map<string,MemorySource>();
        for(const id of ids)sources.set(id,await this.sources.read(agentId,selected,id,context));
        if(!Array.isArray(input.claims)||input.claims.length<1||input.claims.length>40)throw new NativeDomainError("invalid_claims");
        mutation.sourceIds=ids;
        mutation.claims=input.claims.map((raw,index)=>{
          const claim=closed(raw,["text","sourceIds","evidenceQuote","certainty"],["text","sourceIds","certainty"]);
          const refs=strings(claim.sourceIds,40,80),certainty=choice(claim.certainty,["fact","inference","uncertain"]);
          if(!refs.length||refs.some(id=>!sources.has(id)))throw new NativeDomainError("claim_source_not_bound",403);
          const claimText=text(claim.text,2000),evidenceQuote=claim.evidenceQuote===undefined?claimText:text(claim.evidenceQuote,2400);
          const grounded=certainty==="fact"&&refs.every(id=>sources.get(id)!.certainty==="confirmed")&&refs.some(id=>containsSourceQuote(sources.get(id)!.text,evidenceQuote));
          return {id:"claim."+createHash("sha256").update(lookup+"\n"+index+"\n"+claimText).digest("hex").slice(0,24),text:claimText,status:grounded?"supported":"candidate",evidence:refs.map(id=>({kind:sources.get(id)!.originClass,sourceId:id,path:sources.get(id)!.nativePath,privacyTier:selected==="household"?"household":"local-private",note:"Source certainty: "+sources.get(id)!.certainty+(containsSourceQuote(sources.get(id)!.text,evidenceQuote)?"; verified quote: "+evidenceQuote:"")}))};
        });
        mutation.status=(mutation.claims as NativeJson[]).every(claim=>claim.status==="supported")&&!(mutation.questions as unknown[]|undefined)?.length&&!(mutation.contradictions as unknown[]|undefined)?.length?"supported":"review";
        mutation.body=managedBody(mutation.body as string,mutation.status==="review");
      }
      context.assertCurrent();
      try{
        await this.rpc.request("wiki.apply",mutation,context);
        const readback=await this.current(agentId,lookup,context);
        if(!readback.content)throw new NativeDomainError("memory_readback_missing",502,"unknown");
        const claims=(mutation.claims??[]) as NativeJson[];
        return {source:"native_wiki",state:"committed",untrusted:true,lookup,contentHash:hash(readback.content,readback.result),
          claimCount:claims.length,supportedClaimCount:claims.filter(claim=>claim.status==="supported").length,candidateClaimCount:claims.filter(claim=>claim.status!=="supported").length,
          status:mutation.status??"metadata_updated",supportCheck:"verified_source_quote_with_model_interpretation",detailsTool:"household_memory_get",concurrency:"managed_adapter_serialization_and_preimage_check"};
      }catch{throw new NativeDomainError("memory_write_outcome_unknown",502,"unknown");}
    });
    });
  }
}
