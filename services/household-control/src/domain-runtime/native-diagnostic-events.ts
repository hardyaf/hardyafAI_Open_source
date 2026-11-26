import { createHash } from "node:crypto";
import type { ArtifactScope,ArtifactStore } from "../platform/artifacts.ts";
import { DomainError,fingerprint } from "./common.ts";

export const diagnosticEventLimit=64;
const filename="native-diagnostic-metadata.json";
const metricNames=["contextWindowTokens","durationMs","requestPayloadBytes","responseStreamBytes","timeToFirstByteMs","inputTokens","outputTokens","cacheReadTokens","cacheWriteTokens","messageCount","compactedMessageCount","tokenCount"] as const;
const kinds=new Set(["model_call_ended","llm_output","after_compaction"]);
const categories=new Set(["rate_limit","authentication","authorization","billing","timeout","context_overflow","invalid_request","tool_schema","model_error","connection","server_error","aborted","unknown","provider_error","model_output_error"]);
const failures=new Set(["aborted","connection_closed","connection_reset","terminated","timeout"]);
const reasons=new Set(["stop","end_turn","max_tokens","length","tool_calls","tool_use","error","aborted","timeout","content_filter"]);
type Row=Record<string,unknown>;
export type NativeDiagnosticEvent={schemaVersion:1;kind:"model_call_ended"|"llm_output"|"after_compaction";observationId:string;
  runId:string;sessionKey:string;sessionId:string;agentId:string;at:string;metrics:Partial<Record<typeof metricNames[number],number>>;
  previousSessionId?:string;outcome?:"completed"|"error";errorCategory?:string;failureKind?:string;finishReason?:string};
export type DiagnosticScope=Pick<ArtifactScope,"ownerProfileId"|"conversationId">;
type StoredEvent=NativeDiagnosticEvent & {sourceId:string};
function object(value:unknown):Row{return value&&typeof value==="object"&&!Array.isArray(value)?value as Row:{};}
function identifier(value:unknown,max=512):value is string{return typeof value==="string"&&value.length>0&&value.length<=max&&/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value);}
function projected(value:unknown):NativeDiagnosticEvent{
  const input=object(value),metrics:NativeDiagnosticEvent["metrics"]={};
  if(input.schemaVersion!==1||!kinds.has(String(input.kind))||typeof input.observationId!=="string"||!/^[a-f0-9]{64}$/.test(input.observationId)||
    !identifier(input.runId,200)||!identifier(input.sessionKey)||!identifier(input.sessionId,200)||!identifier(input.agentId,64)||typeof input.at!=="string"||!Number.isFinite(Date.parse(input.at)))throw new DomainError("diagnostic_native_event_invalid");
  for(const name of metricNames){const raw=object(input.metrics)[name];if(Number.isSafeInteger(raw)&&Number(raw)>=0)metrics[name]=Number(raw);}
  return {schemaVersion:1,kind:input.kind as NativeDiagnosticEvent["kind"],observationId:input.observationId,runId:input.runId,sessionKey:input.sessionKey,sessionId:input.sessionId,agentId:input.agentId,at:new Date(input.at).toISOString(),metrics,
    ...(identifier(input.previousSessionId,200)?{previousSessionId:input.previousSessionId}:{}),
    ...(["completed","error"].includes(String(input.outcome))?{outcome:input.outcome as "completed"|"error"}:{}),
    ...(categories.has(String(input.errorCategory))?{errorCategory:String(input.errorCategory)}:{}),
    ...(failures.has(String(input.failureKind))?{failureKind:String(input.failureKind)}:{}),
    ...(reasons.has(String(input.finishReason))?{finishReason:String(input.finishReason)}:{})};
}
export function nativeDiagnosticScope(scope:DiagnosticScope,sourceId:string,runId:string):ArtifactScope{
  return {...scope,taskId:"diagnostic:"+fingerprint([sourceId,runId]).slice(0,64),audience:"private"};
}
function slotKey(slot:number){return "native-diagnostic-slot:"+slot;}
function slotId(scope:ArtifactScope,slot:number){return "artifact-"+createHash("sha256").update(JSON.stringify([scope.ownerProfileId,scope.conversationId,scope.taskId,slotKey(slot)])).digest("hex");}
async function readSlot(artifacts:ArtifactStore,scope:ArtifactScope,slot:number):Promise<StoredEvent|null>{
  let item;
  try{item=await artifacts.read(slotId(scope,slot),{profileId:scope.ownerProfileId,canReadHousehold:false});}
  catch(error){if((error as {code?:string}).code==="artifact_not_found")return null;throw error;}
  if(item.metadata.ownerProfileId!==scope.ownerProfileId||item.metadata.conversationId!==scope.conversationId||item.metadata.taskId!==scope.taskId||item.metadata.audience!=="private"||item.metadata.kind!=="evidence"||item.metadata.filename!==filename||item.metadata.mimeType!=="application/json"||item.bytes.length>4096)throw new DomainError("diagnostic_native_evidence_invalid");
  let value:Row;
  try{value=object(JSON.parse(item.bytes.toString("utf8")));}catch{throw new DomainError("diagnostic_native_evidence_invalid");}
  if(!identifier(value.sourceId,200))throw new DomainError("diagnostic_native_evidence_invalid");
  return {...projected(value),sourceId:value.sourceId};
}
/** Immutable bounded evidence in the existing artifact owner. No queue, event database or runtime policy change. */
export async function captureNativeDiagnosticEvent(options:{artifacts:ArtifactStore;scope:DiagnosticScope;sourceId:string;observation:unknown;assertCurrent():void}):Promise<{recorded:boolean;replayed?:boolean;captureLimit?:boolean}>{
  options.assertCurrent();
  if(!identifier(options.sourceId,200))throw new DomainError("diagnostic_native_source_invalid");
  const observation=projected(options.observation),scope=nativeDiagnosticScope(options.scope,options.sourceId,observation.runId),value={...observation,sourceId:options.sourceId};
  for(let slot=0;slot<diagnosticEventLimit;slot++){
    options.assertCurrent();const previous=await readSlot(options.artifacts,scope,slot);
    if(previous){if(previous.observationId===observation.observationId){
      // Exact repeated delivery may have a new capture timestamp; other metadata must agree.
      const {at:oldAt,...old}=previous,{at:newAt,...now}=value;void oldAt;void newAt;
      if(fingerprint(old)!==fingerprint(now))throw new DomainError("diagnostic_native_event_conflict");
      return {recorded:true,replayed:true};
    }continue;}
    try{await options.artifacts.put(scope,{profileId:scope.ownerProfileId,canReadHousehold:false},{bytes:Buffer.from(JSON.stringify(value)),mimeType:"application/json",kind:"evidence",filename,idempotencyKey:slotKey(slot)});options.assertCurrent();return {recorded:true,replayed:false};}
    catch(error){
      if((error as {code?:string}).code!=="artifact_operation_conflict")throw error;
      // Another native callback won this immutable slot. Re-read it before
      // advancing so concurrent delivery of the same observation is deduplicated.
      slot--;
    }
  }
  return {recorded:false,captureLimit:true};
}
export async function readNativeDiagnosticEvents(options:{artifacts:ArtifactStore;scope:DiagnosticScope;sourceId:string;runId:string;assertCurrent():void}):Promise<{records:StoredEvent[];truncated:boolean}>{
  const scope=nativeDiagnosticScope(options.scope,options.sourceId,options.runId),records:StoredEvent[]=[];
  for(let slot=0;slot<diagnosticEventLimit;slot++){
    options.assertCurrent();const record=await readSlot(options.artifacts,scope,slot);if(!record)break;
    if(record.sourceId!==options.sourceId||record.runId!==options.runId)throw new DomainError("diagnostic_native_evidence_binding_invalid");
    records.push(record);
  }
  options.assertCurrent();return {records,truncated:records.length>=diagnosticEventLimit};
}
