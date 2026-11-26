import {createHash} from "node:crypto";
import {NativeDomainError} from "../native-contracts.ts";
import type {NativeDomainContext,NativeRpcPort,NativeScope} from "../native-contracts.ts";
import {choice,closed,operation,text} from "../native-validation.ts";
import {boundMemorySourceIds,containsSourceQuote} from "./source-files.ts";
import type {NativeMemorySources,MemorySource} from "./source-files.ts";
import type {ManagedWikiPages} from "./managed-pages.ts";
import {appendManagedMemory} from "./append-managed-memory.ts";
import type {WikiClaim} from "./append-managed-memory.ts";

const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
type Claim={text:string;evidenceQuote?:string;certainty:"fact"|"inference"|"uncertain"};
type Ports={agentId:string;scope:NativeScope;sources:NativeMemorySources;rpc:NativeRpcPort;pages?:ManagedWikiPages;timeZone?:string};

function claimFor(source:MemorySource,claim:Claim,scope:NativeScope):WikiClaim{
  const quote=claim.evidenceQuote??claim.text,supported=claim.certainty==="fact"&&source.certainty==="confirmed"&&containsSourceQuote(source.text,quote);
  return {id:"claim."+hash(source.id+"\n"+claim.text).slice(0,24),text:claim.text,status:supported?"supported":"candidate",evidence:[{
    kind:source.originClass,sourceId:source.id,path:source.nativePath,privacyTier:scope==="household"?"household":"local-private",
    note:"Source certainty: "+source.certainty+(containsSourceQuote(source.text,quote)?"; verified quote: "+quote:"")}]};
}
function journalDate(at:string,timeZone:string):string{
  try{return new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(at));}
  catch{throw new NativeDomainError("memory_time_zone_invalid",503);}
}

/** One application operation over existing scoped sources, managed pages and
 * native wiki mutations. Main supplies meaning; this helper owns projection,
 * source association, hashes and idempotent topic/journal append mechanics. */
export async function rememberMemory(args:unknown,context:NativeDomainContext,ports:Ports){
  const input=closed(args,["operationId","scope","topic","sourceQuote","claims","sourceId"],["operationId","scope","topic","sourceQuote","claims"]);
  const op=operation(input.operationId),topic=text(input.topic,150),quote=text(input.sourceQuote,20_000);
  if(Buffer.byteLength("Household topic "+topic)>180||/[\r\n]/.test(topic))throw new NativeDomainError("topic_title_too_long");
  if(!ports.pages?.readManaged||!ports.pages.assertManagedUnchanged)throw new NativeDomainError("memory_managed_merge_not_configured",503);
  if(!Array.isArray(input.claims)||input.claims.length<1||input.claims.length>40)throw new NativeDomainError("invalid_claims");
  const claims:Claim[]=input.claims.map(raw=>{
    const claim=closed(raw,["text","evidenceQuote","certainty"],["text","certainty"]);
    return {text:text(claim.text,2000),certainty:choice(claim.certainty,["fact","inference","uncertain"]) as Claim["certainty"],
      ...(claim.evidenceQuote===undefined?{}:{evidenceQuote:text(claim.evidenceQuote,2400)})};
  });
  const sourceIds=boundMemorySourceIds(undefined,quote,context);
  // The source is the quotation; claims may still be inferences. Quote capture
  // does not promote a claim unless its own classification/evidence qualifies.
  let source:MemorySource;
  if(input.sourceId!==undefined){
    source=await ports.sources.read(ports.agentId,ports.scope,text(input.sourceId,80),context);
    if(source.scope!==ports.scope||source.certainty!=="confirmed"||source.originClass!=="user-stated"||source.text!==quote||
      !source.sourceIds.length||source.sourceIds.length!==sourceIds.length||source.sourceIds.some(id=>!sourceIds.includes(id)||
        !context.confirmedSourceIds?.includes(id)||typeof context.confirmedSourceText?.[id]!=="string"||!containsSourceQuote(context.confirmedSourceText[id],quote)))
      throw new NativeDomainError("memory_existing_source_not_current",403);
  }else source=await ports.sources.save(ports.agentId,ports.scope,{operationId:op,title:topic,text:quote,sourceIds,certainty:"fact"},context);
  const incoming=claims.map(claim=>claimFor(source,claim,ports.scope)),date=journalDate(source.recordedAt,ports.timeZone??"UTC");
  const titles=["Household topic "+topic,"Household topic Daily journal "+date];
  const saved:Awaited<ReturnType<typeof appendManagedMemory>>[]=[];
  try{
    for(const title of titles)saved.push(await appendManagedMemory({agentId:ports.agentId,title,topic,date,sourceId:source.id,claims:incoming},context,{pages:ports.pages,rpc:ports.rpc}));
  return {state:"committed",sourceId:source.id,sourceReused:input.sourceId!==undefined,sourceCertainty:source.certainty,scope:ports.scope,topic:saved[0],journal:saved[1],journalDate:date,journalTimeZone:ports.timeZone??"UTC",
    supportedClaimCount:incoming.filter(claim=>claim.status==="supported").length,candidateClaimCount:incoming.filter(claim=>claim.status!=="supported").length,
    supportCheck:"verified_source_quote_with_model_interpretation",detailsTool:"household_memory_get",concurrency:"managed_adapter_serialization_and_preimage_check"};
  }catch(error){
    // The immutable source may already exist and a topic may have committed.
    // The same operation can inspect owner markers and safely finish remaining
    // projections; never report a successful whole curation or blindly replay.
    const failure=new NativeDomainError("memory_projection_refresh_required",503,"unknown");
    (failure as Error&{cause?:unknown}).cause=error;throw failure;
  }
}
