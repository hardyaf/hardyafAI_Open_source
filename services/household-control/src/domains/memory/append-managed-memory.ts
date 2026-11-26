import {createHash} from "node:crypto";
import {NativeDomainError} from "../native-contracts.ts";
import type {NativeDomainContext,NativeRpcPort} from "../native-contracts.ts";
import type {ManagedWikiPages,ManagedWikiSnapshot} from "./managed-pages.ts";

const generatedStart="<!-- openclaw:wiki:generated:start -->",generatedEnd="<!-- openclaw:wiki:generated:end -->";
const slug=(value:string)=>value.trim().toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu,"-").replace(/-+/g,"-").replace(/^-+|-+$/g,"");
export type WikiClaim=Record<string,unknown>;
export function memoryPageSeries(rootLookup:string){
  const key=createHash("sha256").update(rootLookup).digest("hex").slice(0,24);
  const titlePrefix="Household topic continuation "+key+" part ";
  return {titlePrefix,lookupPrefix:"syntheses/"+slug(titlePrefix)+"-"};
}
function previousSummary(snapshot:ManagedWikiSnapshot|null):string{
  if(!snapshot)return "";
  const first=snapshot.body.indexOf(generatedStart),last=snapshot.body.indexOf(generatedEnd);
  if(first===-1&&last===-1)return "";
  if(first<0||last<first||snapshot.body.indexOf(generatedStart,first+1)!==-1||snapshot.body.indexOf(generatedEnd,last+1)!==-1)throw new NativeDomainError("managed_topic_markers_invalid",409);
  return snapshot.body.slice(first+generatedStart.length,last).trim();
}
function metadataArray(snapshot:ManagedWikiSnapshot|null,key:string):unknown[]{
  const value=snapshot?.metadata[key];if(value===undefined)return [];
  if(!Array.isArray(value))throw new NativeDomainError("managed_topic_metadata_invalid",409);return value;
}
function metadata(snapshot:ManagedWikiSnapshot|null){
  const sources=metadataArray(snapshot,"sourceIds"),claims=metadataArray(snapshot,"claims");
  if(sources.some(id=>typeof id!=="string")||claims.some(claim=>!claim||typeof claim!=="object"||Array.isArray(claim)||typeof (claim as WikiClaim).id!=="string"))throw new NativeDomainError("managed_topic_metadata_invalid",409);
  return {sources:sources as string[],claims:claims as WikiClaim[],questions:metadataArray(snapshot,"questions"),contradictions:metadataArray(snapshot,"contradictions")};
}
function fits(body:string){return body.length<=20_000&&body.split("\n").length<=350;}
function entry(sourceId:string,date:string,topic:string,claims:WikiClaim[]){
  // Display formatting cannot consume thousands of lines for one short claim.
  // Original text and supporting quotes remain unchanged in claim metadata.
  return ["<!-- household-memory-entry:"+sourceId+" -->","### "+date+" · "+topic,...claims.map(claim=>"- "+(claim.status==="supported"?"":"[Candidate] ")+String(claim.text).replace(/\s+/gu," ")),
    "Source: `"+sourceId+"`","<!-- household-memory-entry-end:"+sourceId+" -->"].join("\n\n");
}
/** Bounded native wiki pages are derived projections, never a second source
 * authority. Source/claim markers make partial-page and journal recovery safe.
 * A large single capture may occupy multiple parts, with one source entry per
 * part so existing source-aware correction/forgetting can prune it normally. */
export async function appendManagedMemory(input:{agentId:string;title:string;topic:string;date:string;sourceId:string;claims:WikiClaim[]},context:NativeDomainContext,ports:{pages:ManagedWikiPages;rpc:NativeRpcPort}){
  if(!ports.pages.readManaged||!ports.pages.assertManagedUnchanged)throw new NativeDomainError("memory_managed_merge_not_configured",503);
  const rootLookup="syntheses/"+slug(input.title)+".md",series=memoryPageSeries(rootLookup);
  const lookups=ports.pages.listManagedParts?await ports.pages.listManagedParts(input.agentId,rootLookup,context):[rootLookup];
  if(!lookups.length||lookups[0]!==rootLookup||lookups.length>5000||new Set(lookups).size!==lookups.length)throw new NativeDomainError("managed_topic_navigation_invalid",409);
  const incoming=[...new Map(input.claims.map(claim=>[String(claim.id),claim])).values()],ids=new Set(incoming.map(claim=>claim.id));
  const marker="<!-- household-memory-entry:"+input.sourceId+" -->",recorded=new Set<unknown>(),saved:string[]=[];
  let latest:{lookup:string;snapshot:ManagedWikiSnapshot|null;part:number}={lookup:rootLookup,snapshot:null,part:1};
  for(const lookup of lookups){
    const suffix=lookup===rootLookup?"1":lookup.startsWith(series.lookupPrefix)?lookup.slice(series.lookupPrefix.length,-3):"";
    const part=Number(suffix);if(!/^[1-9]\d*$/.test(suffix)||!Number.isSafeInteger(part)||part<latest.part||lookup!==rootLookup&&part<2)throw new NativeDomainError("managed_topic_navigation_invalid",409);
    const snapshot=await ports.pages.readManaged(input.agentId,lookup,context),body=previousSummary(snapshot),old=metadata(snapshot);
    if(body.includes(marker)){
      const own=old.claims.filter(claim=>Array.isArray(claim.evidence)&&claim.evidence.some(raw=>raw&&typeof raw==="object"&&(raw as WikiClaim).sourceId===input.sourceId));
      if(!old.sources.includes(input.sourceId)||!own.length||own.some(claim=>!ids.has(claim.id)))throw new NativeDomainError("memory_entry_receipt_mismatch",409);
      for(const claim of own)recorded.add(claim.id);saved.push(lookup);
    }
    latest={lookup,snapshot,part};
  }
  const missing=incoming.filter(claim=>!recorded.has(claim.id));let wrote=false;
  while(missing.length){
    let previous=previousSummary(latest.snapshot);
    // A recovered partial source uses another part, keeping exactly one entry
    // for that source in each page and preserving the pruning contract.
    if(previous.includes(marker)||!fits(previous+"\n\n"+entry(input.sourceId,input.date,input.topic,[missing[0]]))){
      if(!ports.pages.listManagedParts)throw new NativeDomainError("memory_rollover_not_configured",503);
      latest={lookup:series.lookupPrefix+(latest.part+1)+".md",snapshot:null,part:latest.part+1};previous="";
      // A separately written part must not be overwritten after enumeration.
      const existing=await ports.pages.readManaged(input.agentId,latest.lookup,context);if(existing)throw new NativeDomainError("memory_revision_conflict",409);
    }
    const chunk:WikiClaim[]=[];
    for(const claim of missing){if(!fits([previous,entry(input.sourceId,input.date,input.topic,[...chunk,claim])].filter(Boolean).join("\n\n")))break;chunk.push(claim);}
    if(!chunk.length)throw new NativeDomainError("memory_claim_exceeds_page_bound",413);
    const old=metadata(latest.snapshot),merged=[...old.claims,...chunk.filter(claim=>!old.claims.some(value=>value.id===claim.id))];
    const body=[previous,entry(input.sourceId,input.date,input.topic,chunk)].filter(Boolean).join("\n\n");
    const status=merged.some(claim=>claim.status!=="supported")||old.questions.length||old.contradictions.length||latest.snapshot?.metadata.status==="review"?"review":"supported";
    context.assertCurrent();await ports.pages.assertManagedUnchanged(input.agentId,latest.lookup,latest.snapshot?.fingerprint??null,context);
    await ports.rpc.request("wiki.apply",{agentId:input.agentId,op:"create_synthesis",title:latest.part===1?input.title:series.titlePrefix+latest.part,body,
      sourceIds:[...new Set([...old.sources,input.sourceId])],claims:merged,questions:old.questions,contradictions:old.contradictions,status},context);
    const readback=await ports.pages.readManaged(input.agentId,latest.lookup,context);context.assertCurrent();
    if(!readback?.body.includes(marker)||!metadata(readback).sources.includes(input.sourceId)||!chunk.every(claim=>metadata(readback).claims.some(old=>old.id===claim.id)))throw new NativeDomainError("memory_readback_missing",502,"unknown");
    saved.push(latest.lookup);wrote=true;missing.splice(0,chunk.length);latest.snapshot=readback;
  }
  if(!saved.length)throw new NativeDomainError("memory_entry_receipt_mismatch",409);
  return {lookup:saved[0],state:"committed" as const,alreadyRecorded:!wrote,rootLookup,lookups:saved,partCount:saved.length};
}
