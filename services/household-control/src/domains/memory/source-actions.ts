import {NativeDomainError} from "../native-contracts.ts";
import type {NativeDomainContext,NativeRpcPort,NativeScope} from "../native-contracts.ts";
import {choice,closed,integer,operation,strings,text} from "../native-validation.ts";
import {boundMemorySourceIds,containsSourceQuote} from "./source-files.ts";
import type {NativeMemorySources} from "./source-files.ts";
import type {ManagedWikiPages} from "./managed-pages.ts";
import {sourceDigest} from "./source-lifecycle.ts";
export type NativeMemoryReindex=(agentId:string,context:NativeDomainContext)=>Promise<unknown>;

/** Selected-domain application operations over the existing native authorities.
 * All destructive source changes leave pending receipts before mutation, so a
 * failed compiler/index refresh cannot silently serve a stale projection.
 */
export class MemorySourceActions {
  private readonly sources:NativeMemorySources;
  private readonly rpc:NativeRpcPort;
  private readonly pages?:ManagedWikiPages;
  private readonly reindex?:NativeMemoryReindex;
  constructor(sources:NativeMemorySources,rpc:NativeRpcPort,pages?:ManagedWikiPages,reindex?:NativeMemoryReindex){this.sources=sources;this.rpc=rpc;this.pages=pages;this.reindex=reindex;}
  async requireReady(agentId:string,scope:NativeScope,context:NativeDomainContext){
    if(this.sources.lifecycle&&await this.sources.lifecycle.pending(agentId,scope,context))throw new NativeDomainError("memory_projection_refresh_required",409);
  }
  async execute(name:string,args:unknown,agentId:string,scope:NativeScope,context:NativeDomainContext):Promise<unknown>{
    const lifecycle=this.sources.lifecycle;
    if(!lifecycle)throw new NativeDomainError("memory_source_lifecycle_not_configured",503);
    if(name==="household_memory_source_list"){
      const input=closed(args,["scope","afterSourceId","limit"],["scope"]);
      return lifecycle.list(agentId,scope,input.afterSourceId===undefined?"":text(input.afterSourceId,80),integer(input.limit,50,1,100),context);
    }
    if(name==="household_memory_source_references"){
      const input=closed(args,["scope","sourceId"],["scope","sourceId"]),id=text(input.sourceId,80);
      const source=await this.sources.read(agentId,scope,id,context);
      if(!this.pages)throw new NativeDomainError("managed_wiki_vault_not_configured",503);
      const lookups=await this.pages.references(agentId,id,context);
      return {sourceId:id,certainty:source.certainty,topics:lookups.slice(0,100),hasMore:lookups.length>100,total:lookups.length};
    }
    const supersede=name==="household_memory_source_supersede";
    if(!supersede&&name!=="household_memory_source_forget")throw new NativeDomainError("unknown_tool",404);
    const input=closed(args,["scope","sourceId","expectedFingerprint","operationId",...(supersede?["title","text","sourceIds","certainty"]:[])],["scope","sourceId","expectedFingerprint","operationId",...(supersede?["title","text","certainty"]:[])]);
    const op=operation(input.operationId),sourceId=text(input.sourceId,80),expectedFingerprint=text(input.expectedFingerprint,64);
    if(!supersede&&!context.destructiveApproved)throw new NativeDomainError("destructive_approval_required",403);
    if(!this.pages||!this.reindex)throw new NativeDomainError("memory_projection_maintenance_not_configured",503);
    let replacementId:string|undefined;
    if(supersede){
      const body=text(input.text,20_000),refs=boundMemorySourceIds(input.sourceIds,body,context);
      if(!refs.length||refs.some(id=>!context.confirmedSourceIds?.includes(id)||!(typeof context.confirmedSourceText?.[id]==="string"&&containsSourceQuote(context.confirmedSourceText[id],body))))
        throw new NativeDomainError("memory_correction_requires_later_user_source",403);
      await lifecycle.validateCorrection(agentId,scope,sourceId,expectedFingerprint,refs,context);
      const replacement=await this.sources.save(agentId,scope,{operationId:"replace-"+sourceDigest(op+"\n"+sourceId),title:text(input.title,180),text:body,sourceIds:refs,
        certainty:choice(input.certainty,["fact","inference","uncertain"]) as "fact"|"inference"|"uncertain"},context);
      replacementId=replacement.id;
    }
    let receipt=await lifecycle.beginChange(agentId,scope,{operationId:op,sourceId,expectedFingerprint,kind:supersede?"supersede":"forget",...(replacementId?{replacementId}:{})},context);
    if(receipt.status!=="complete"){
      const topics=await this.pages.references(agentId,sourceId,context);
      receipt=await lifecycle.recordTopics(agentId,receipt,topics,context);
      try{
        await lifecycle.retire(agentId,scope,receipt,context);
        if(this.pages.pruneReferencing)await this.pages.pruneReferencing(agentId,sourceId,context,async projection=>{receipt=await lifecycle.recordTopics(agentId,receipt,[],context,projection);});
        else{const removed=await this.pages.removeReferencing(agentId,sourceId,context);receipt=await lifecycle.recordTopics(agentId,receipt,[],context,{removed,pruned:[],rebuildRequired:removed});}
        context.assertCurrent();await this.rpc.request("wiki.compile",{agentId},context);
        context.assertCurrent();await this.reindex(agentId,context);
        receipt=await lifecycle.finishChange(agentId,receipt,[],context);
      }catch{throw new NativeDomainError("memory_projection_refresh_required",503,"unknown");}
    }
    const projection=receipt.projection??{removed:receipt.topicsRemoved,pruned:[],rebuildRequired:receipt.topicsRemoved};
    return {state:"committed",operationId:op,sourceId,replacementSourceId:replacementId??null,scope,affectedTopicCount:receipt.topicsRemoved.length,removedTopicCount:projection.removed.length,removedTopicRefs:projection.removed,
      prunedTopicCount:projection.pruned.length,prunedTopicRefs:projection.pruned,rebuildRequiredTopicCount:projection.rebuildRequired.length,rebuildRequiredTopicRefs:projection.rebuildRequired,
      liveProjections:"native_wiki_compiled_and_memory_index_refreshed",historyRetained:supersede,
      forgottenScope:supersede?null:"captured_source_active_and_owned_history_plus_managed_dependent_topics",
      retainedOutsideScope:["original_conversation_and_task_artifacts","unmanaged_pages_or_untracked_copies","external_backups"],
      tombstone:"content_free",unrelatedContentPreservation:"source_attributed_entries_only",topicRebuild:projection.rebuildRequired.length?"required_for_opaque_invalidated_pages":supersede?"curate_replacement_fact":"not_required_for_preserved_entries"};
  }
}
