import {scheduleDeliveryIdentity,scheduleDeliverySessionKey} from "../domains/scheduling/delivery-session.ts";
import type {QueuedNoticePolicy} from "../domains/scheduling/delivery-session.ts";
import { importDiscordArtifacts, supportsDiscordArtifact } from "./discord-artifacts.ts";
import type { NativeDeliveryTarget } from "../domains/native-contracts.ts";
import type { NativeMediaFact } from "./discord-artifacts.ts";
import type {ArtifactStore} from "../platform/artifacts.ts";
import { createHash } from "node:crypto";
import type { HouseholdDatabase } from "../database.ts";
import type { OpenClawAgentAdapter } from "../openclaw-adapter.ts";
import type { Conversation,FamilyProfile } from "../domain.ts";
import { ExecutionAuthorityRepository } from "../request-context.ts";
import type { MessageTaskContext,ExecutionGrant } from "../request-context.ts";
import { DomainError, fingerprint } from "./common.ts";
import type { StoredSubmission } from "../submission-repository.ts";
import { normalizedSessionKey } from "./native-scope.ts";
import type {ProfileDomainGrant} from "./native-scope.ts";
import {domainCatalog} from "./catalog.ts";
import {taskNativeNames} from "../task-flow/catalog.ts";
const scheduledSystemTools=new Set([...taskNativeNames.filter(name=>!["household_task_stop","household_task_bind_reply"].includes(name)),
  "get_goal","create_goal","update_goal","progress_card","sessions_spawn","sessions_yield","session_status","subagents","sessions_send","tool_search","tool_describe","tool_call"]);

type Json=Record<string,unknown>;
export type NativeEntryRule={profileId:string;externalUserId:string;channelId:string;agentId:string;audience:"private"|"household";brainDump:boolean};
export type NativeAdmissionOptions={schedulingEnabled:boolean;scheduledToolNames:readonly string[];profileGrants:Readonly<Record<string,ProfileDomainGrant>>;diagnosticCommand?:string|null;mediaRoot?:string;notificationTargets?:Readonly<Record<string,NativeDeliveryTarget>>;queuedNoticePolicy?:QueuedNoticePolicy};
export type NativeObservation={runId?:string|null;sessionKey?:string|null;sessionId?:string|null;agentId?:string|null;channel?:string|null;channelId?:string|null;senderId?:string|null;jobId?:string|null;sourceMessageId?:string|null;sourceText?:string|null;exactCurrentMessage?:boolean;supportedMediaExpected?:boolean;inputProvenance?:unknown;assertCurrent?:()=>void};
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
export class NativeAdmission {
  readonly authority:ExecutionAuthorityRepository;
  private readonly sources=new Map<string,{text:string;hash:string;exact:boolean;at:number}>();
  private readonly database:HouseholdDatabase;
  private readonly adapter:OpenClawAgentAdapter;
  private readonly rules:NativeEntryRule[];
  private readonly artifacts:ArtifactStore;
  private readonly options:NativeAdmissionOptions;
  private readonly diagnosticCommand:string|null;
  constructor(database:HouseholdDatabase,adapter:OpenClawAgentAdapter,rules:NativeEntryRule[],artifacts:ArtifactStore,options:NativeAdmissionOptions={schedulingEnabled:false,scheduledToolNames:[],profileGrants:{}}){this.database=database;this.adapter=adapter;this.rules=rules;this.artifacts=artifacts;this.options=options;this.diagnosticCommand=options.diagnosticCommand===null?null:options.diagnosticCommand??"!diagnose";if(this.diagnosticCommand!==null&&!/^![A-Za-z][A-Za-z0-9_-]{0,31}$/.test(this.diagnosticCommand))throw new DomainError("diagnostic_command_configuration_invalid");this.authority=new ExecutionAuthorityRepository(database.domainConnection());}
  isManagedAgent(agentId:unknown){return typeof agentId==="string"&&[...this.database.listProfiles().map(p=>p.agentId),"household-analysis","household-diagnostics"].includes(agentId);}
  externalCurrent(packet:MessageTaskContext,profileId:string){
    if(packet.origin?.kind==="discord")return this.rules.some(rule=>rule.profileId===profileId&&rule.externalUserId===packet.origin!.externalUserId&&rule.channelId===packet.origin!.channelId&&rule.audience===(packet.origin!.shared?"household":"private"));
    // The trusted native job snapshot authorizes this run, not every later job
    // revision. Cancelling a declaration affects future runs; user cancellation
    // of this admitted run separately invalidates its source/control watermark.
    if(packet.origin?.kind!=="scheduled"||!this.options.schedulingEnabled||typeof packet.origin.jobId!=="string"||!packet.origin.sourceId.startsWith("native-cron:")||
      !Array.isArray(packet.scheduledTools)||typeof packet.scheduledRevision!=="string"||!packet.scheduledRevision)return false;
    const grant=this.options.profileGrants[profileId];
    return Boolean(grant?.enabled&&grant.domains.includes("schedule")&&(!packet.origin.shared||grant.scopes.includes("household")&&grant.sharedDomains.includes("schedule"))&&
      packet.scheduledTools.every(name=>this.scheduledToolAllowed(name,grant,packet.origin!.shared))&&
      Boolean(packet.scheduledScope&&this.scheduledDelivery(packet.scheduledDelivery,profileId,grant,packet.scheduledScope)));
  }
  private scheduledDelivery(value:unknown,profileId:string,grant:ProfileDomainGrant,selected:"personal"|"household",rules:NativeEntryRule[]=this.rules,notificationTargets=this.options.notificationTargets):{mode:"none"}|({mode:"announce"}&NativeDeliveryTarget)|null{
    const delivery=value&&typeof value==="object"&&!Array.isArray(value)?value as Json:{};
    if(delivery.mode==="none")return {mode:"none"};
    if(delivery.mode!=="announce"||typeof delivery.channel!=="string"||typeof delivery.to!=="string")return null;
    const same=(target:NativeDeliveryTarget)=>["channel","to","accountId","threadId"].every(key=>{
      const actual=String(delivery[key]??""),expected=String((target as unknown as Json)[key]??"");
      return key==="to"&&target.channel==="discord"&&expected.startsWith("channel:")?actual===expected||actual===expected.slice(8):actual===expected;
    });
    const eligible=(target:NativeDeliveryTarget)=>same(target)&&(selected!=="personal"||target.audience==="private")&&(target.audience!=="household"||grant.scopes.includes("household")&&grant.sharedDomains.includes("schedule"));
    const protectedTarget=notificationTargets?.[profileId];
    if(protectedTarget&&eligible(protectedTarget))return {mode:"announce",...protectedTarget};
    const profile=this.database.getProfile(profileId);
    for(const rule of rules){
      if(rule.profileId!==profileId||rule.agentId!==profile?.agentId)continue;
      const target:NativeDeliveryTarget={channel:"discord",to:"channel:"+rule.channelId,audience:rule.audience};
      if(eligible(target))return {mode:"announce",...target};
    }
    return null;
  }
  /** The first native preparation is the authorization boundary; accepted durable batches may finish unchanged. */
  authorizeScheduledNotice(job:Json,event:Json,context:Json,options:NativeAdmissionOptions=this.options,rules:NativeEntryRule[]=this.rules):boolean{
    if(!options.schedulingEnabled||options.queuedNoticePolicy==="recheck_each_attempt")return false;
    const identity=scheduleDeliveryIdentity(context.sessionKey??event.sessionKey),owner=job.owner as Json|undefined;
    if(!identity||job.agentId!==identity.agentId||job.sessionTarget!=="isolated"||typeof job.declarationKey!=="string"||job.sessionKey!==identity.sessionKey||
      scheduleDeliverySessionKey(identity.agentId,job.declarationKey)!==identity.sessionKey||owner?.agentId!==identity.agentId||typeof owner.sessionKey!=="string")return false;
    const payload=job.payload&&typeof job.payload==="object"?job.payload as Json:{};
    if(payload.kind!=="agentTurn")return false;
    const origin=this.database.findConversationBySessionKey(owner.sessionKey);if(!origin)return false;
    const profile=this.database.listProfiles().find(candidate=>candidate.role!=="child"&&candidate.agentId===identity.agentId&&
      (job.declarationKey as string).startsWith("household:"+hash(candidate.id).slice(0,20)+":"+hash(origin.id).slice(0,20)+":"));
    if(!profile?.capabilities.includes("chat")||["paused","offline"].includes(profile.status)||origin.audience==="private"&&origin.ownerProfileId!==profile.id)return false;
    const grant=options.profileGrants[profile.id],selected=job.description==="Household task; audience=personal"?"personal":job.description==="Household task; audience=household"?"household":null;
    if(!selected||!grant?.enabled||!grant.domains.includes("schedule")||!grant.scopes.includes(selected)||
      origin.audience==="household"&&(!grant.scopes.includes("household")||!grant.sharedDomains.includes("schedule")))return false;
    const primary=this.scheduledDelivery(job.delivery,profile.id,grant,selected,rules,options.notificationTargets),notifications=options.notificationTargets?.[profile.id];
    const destinations:NativeDeliveryTarget[]=[...(primary?.mode==="announce"?[primary]:[]),...(notifications&&notifications.audience==="private"?[notifications]:[])];
    const metadata=event.metadata&&typeof event.metadata==="object"?event.metadata as Json:{};
    return destinations.some(target=>{
      if(context.channelId!==target.channel||typeof event.to!=="string")return false;
      const actual=event.to,expected=target.to;
      if(actual!==expected&&!(target.channel==="discord"&&expected.startsWith("channel:")&&actual===expected.slice(8)))return false;
      if(target.accountId!==undefined&&context.accountId!==target.accountId)return false;
      return String(metadata.threadId??context.threadId??"")===String(target.threadId??"");
    });
  }
  private scheduledToolAllowed(name:string,grant:ProfileDomainGrant,shared:boolean):boolean{
    if(!this.options.scheduledToolNames.includes(name))return false;
    if(scheduledSystemTools.has(name))return true;
    const descriptor=domainCatalog.find(tool=>tool.nativeName===name);
    return Boolean(descriptor&&grant.domains.includes(descriptor.domain)&&(!shared||grant.sharedDomains.includes(descriptor.domain)));
  }
  private confirmedMessage(observation:NativeObservation):boolean{
    return observation.exactCurrentMessage===true&&typeof observation.sourceText==="string"&&
      typeof observation.sourceMessageId==="string"&&observation.sourceMessageId.length>0&&observation.sourceMessageId.length<=200&&
      !/[\x00-\x1f\x7f]/.test(observation.sourceMessageId);

  }
  private async currentGoal(conversation:Conversation,sessionId:string,sourceGoalId:string|null|undefined):Promise<string|null>{
    // Read the current native generation before replacing a source projection.
    // Incoming follow-ups often have no receipt goal yet; binding null first
    // would erase same-goal sticky diagnostic mode before runtime scope repair.
    const native=await this.adapter.getContext(conversation);
    if(!native.sessionId||native.sessionId!==sessionId)throw new DomainError("native_session_generation_changed",{httpStatus:409});
    const activeGoal=native.goal?.status==="active"?native.goal.id:null;
    if(sourceGoalId&&activeGoal&&sourceGoalId!==activeGoal)throw new DomainError("native_goal_generation_changed",{httpStatus:409});
    return sourceGoalId??activeGoal;
  }
  private diagnosticAuthority(profile:Pick<FamilyProfile,"id"|"role"|"capabilities">,audience:"private"|"household"):void{
    if(audience!=="private")throw new DomainError("diagnostic_private_conversation_required",{httpStatus:403});
    const grant=this.options.profileGrants[profile.id];
    if(profile.role!=="admin"||!profile.capabilities.includes("viewDiagnostics")||!grant?.enabled||!grant.domains.includes("diagnostics")||!grant.scopes.includes("personal"))
      throw new DomainError("diagnostic_operator_required",{httpStatus:403});
  }
  private diagnosticRequested(text:string):boolean{
    const command=this.diagnosticCommand;
    // An explicit transport command selects mode only. The complete original
    // human prompt remains evidence; no domain phrases or task text are stripped.
    return command!==null&&(text===command||text.startsWith(command+" "));
  }
  private remember(id:string,text:string,exact:boolean){
    for(const [key,value] of this.sources)if(Date.now()-value.at>3_600_000)this.sources.delete(key);
    if(this.sources.size>=256&&!this.sources.has(id))throw new DomainError("native_source_capacity");
    const old=this.sources.get(id);if(old?.exact&&old.text!==text)throw new DomainError("native_source_conflict");
    this.sources.set(id,{text,hash:hash(text),exact:old?.exact||exact,at:Date.now()});
  }
  async captureAppSource(id:string,text:string){
    const source=this.database.submissions.get(id),device=source?.originDeviceId?this.database.getDevice(source.originDeviceId):null;
    if(!source||!device||device.status!=="active"||device.deviceKind!=="personal"||device.profileId!==source.receipt.profileId)throw new DomainError("app_source_not_authorized",{httpStatus:403});
    await this.captureSource(id,text);
  }
  private async captureSource(id:string,text:string){
    const submission=this.database.submissions.get(id);if(!submission||hash(text)!==submission.textHash)throw new DomainError("native_source_conflict");
    const conversation=this.database.getConversation(submission.receipt.conversationId)!;
    const artifact=await this.artifacts.put({ownerProfileId:submission.receipt.profileId,conversationId:conversation.id,taskId:id,audience:conversation.audience},
      {profileId:submission.receipt.profileId,canReadHousehold:true},{bytes:Buffer.from(text),filename:"admitted-source.txt",mimeType:"text/plain",kind:"evidence",idempotencyKey:"admitted-source:"+id});
    const packet=this.authority.packet(id)??{mode:"conversation" as const,artifactIds:[]};
    this.database.domainConnection().prepare("UPDATE submissions SET task_context_json=? WHERE id=?").run(JSON.stringify({...packet,sourceArtifactId:artifact.id}),id);
  }
  async source(id:string,expectedHash:string){
    const value=this.sources.get(id);if(value?.hash===expectedHash)return {id:"user:"+id,text:value.text,sha256:expectedHash};
    const submission=this.database.submissions.get(id),packet=this.authority.packet(id);if(!submission||!packet?.sourceArtifactId)return null;
    const artifact=await this.artifacts.read(packet.sourceArtifactId,{profileId:submission.receipt.profileId,canReadHousehold:true});
    if(artifact.metadata.ownerProfileId!==submission.receipt.profileId||artifact.metadata.conversationId!==submission.receipt.conversationId||artifact.metadata.taskId!==id||artifact.metadata.kind!=="evidence"||artifact.metadata.filename!=="admitted-source.txt"||artifact.metadata.sha256!==expectedHash)throw new DomainError("native_source_integrity_failed");
    return {id:"user:"+id,text:artifact.bytes.toString("utf8"),sha256:expectedHash};
  }
  /** Positive message-hook custody; native turn admission still owns execution authorization. */
  async inbound(event:Json,context:Json):Promise<void>{
    if(context.channelId!=="discord")return;
    const runId=context.runId??event.runId,key=context.sessionKey??event.sessionKey,senderId=context.senderId??event.senderId??event.from;
    const messageId=context.messageId??event.messageId,channelId=context.conversationId;
    if(typeof runId!=="string"||typeof key!=="string"||typeof senderId!=="string"||typeof channelId!=="string"||typeof messageId!=="string"||!messageId||messageId.length>200)return;
    const rule=this.rules.find(value=>value.externalUserId===senderId&&value.channelId===channelId&&normalizedSessionKey(value.agentId,key).startsWith("agent:"+value.agentId+":"));
    if(!rule)return;
    const media=Array.isArray(event.media)?event.media as NativeMediaFact[]:[];
    const original=Array.isArray(event.originalMedia)?event.originalMedia as NativeMediaFact[]:[];
    if(![...media,...original].some(supportsDiscordArtifact))return;
    if(event.mediaStagingPending===true)throw new DomainError("discord_original_media_staging_pending");
    // originalMedia is provider-side identity, not a local read capability.
    // Only the later canonical staged media facts may supply file paths.
    if(!media.length)throw new DomainError("discord_attachment_not_staged");
    const profile=this.database.getProfile(rule.profileId),grant=this.options.profileGrants[rule.profileId];
    if(!profile||profile.role==="child"||!profile.capabilities.includes("chat")||!grant?.enabled||rule.audience==="household"&&!grant.scopes.includes("household"))return;
    const sessionKey=normalizedSessionKey(rule.agentId,key),sourceId="native-turn-"+hash(runId).slice(0,48);
    let conversation=this.database.findConversationBySessionKey(sessionKey);
    if(!conversation){conversation={id:"native-conv-"+hash(sessionKey).slice(0,32),ownerProfileId:profile.id,agentId:rule.agentId,sessionKey,title:rule.audience==="household"?"Household conversation":"Private household conversation",presetId:null,audience:rule.audience,updatedAt:new Date().toISOString()};this.database.insertConversation(conversation);}
    if(conversation.audience!==rule.audience||conversation.agentId!==rule.agentId)throw new DomainError("native_channel_binding_conflict");
    const current=()=>{(context as any).hookInvocation?.assertActive();const actor=this.database.getProfile(rule.profileId);if(!actor?.capabilities.includes("chat")||actor.role==="child")throw new DomainError("domain_authority_revoked");};
    const artifactIds=await importDiscordArtifacts({artifacts:this.artifacts,scope:{ownerProfileId:profile.id,conversationId:conversation.id,taskId:sourceId,audience:rule.audience},media,messageId,mediaRoot:this.options.mediaRoot,assertCurrent:current});
    if(!artifactIds.length)return;
    const packet:MessageTaskContext={mode:rule.brainDump?"brain_dump":"conversation",artifactIds,origin:{kind:"discord",externalUserId:rule.externalUserId,channelId:rule.channelId,sourceId:messageId,shared:rule.audience==="household",confirmedHuman:true}};
    const existing=this.database.submissions.get(sourceId);
    if(existing){
      if(existing.receipt.profileId!==profile.id||existing.receipt.conversationId!==conversation.id||!["running","dispatching"].includes(existing.receipt.status))throw new DomainError("discord_attachment_source_conflict");
      if(existing.taskContext?.artifactIds.length){if(JSON.stringify(existing.taskContext.artifactIds)!==JSON.stringify(artifactIds))throw new DomainError("discord_attachment_source_conflict");return;}
      const previous=existing.taskContext;
      if(previous?.origin?.kind!=="discord"||previous.origin.externalUserId!==rule.externalUserId||previous.origin.channelId!==rule.channelId)throw new DomainError("discord_attachment_source_conflict");
      const result=this.database.domainConnection().prepare("UPDATE submissions SET task_context_json=? WHERE id=? AND task_context_json=? AND status IN ('running','dispatching')").run(JSON.stringify({...previous,artifactIds}),sourceId,JSON.stringify(previous));
      if(result.changes!==1)throw new DomainError("discord_attachment_source_conflict");return;
    }
    const text=typeof event.content==="string"?event.content:"",now=new Date().toISOString();
    this.database.domainConnection().prepare(`INSERT INTO submissions(id,conversation_id,profile_id,agent_id,text_hash,status,run_id,created_at,updated_at,task_context_json) VALUES (?,?,?,?,?,'running',?,?,?,?)`).run(sourceId,conversation.id,profile.id,rule.agentId,hash(text),runId,now,now,JSON.stringify(packet));
  }
  private async awaitCurrentAttachments(observation:NativeObservation,rule:NativeEntryRule):Promise<void>{
    const sourceId="native-turn-"+hash(observation.runId!).slice(0,48),deadline=Date.now()+10_000;
    do{
      observation.assertCurrent?.();const source=this.database.submissions.get(sourceId),packet=source?.taskContext;
      if(source&&packet?.artifactIds.length&&source.receipt.profileId===rule.profileId&&packet.origin?.kind==="discord"&&packet.origin.externalUserId===rule.externalUserId&&packet.origin.channelId===rule.channelId&&packet.origin.sourceId===observation.sourceMessageId)return;
      await new Promise(resolve=>setTimeout(resolve,25));
    }while(Date.now()<deadline);
    throw new DomainError("native_media_custody_pending",{httpStatus:409});
  }
  private async adoptAnalysisWake(observation:NativeObservation,conversation:Conversation,source:StoredSubmission,root:ExecutionGrant|null):Promise<void>{
    const fail=()=>new DomainError("native_analysis_wake_not_authorized",{httpStatus:403});
    const {agentId,sessionId,sessionKey,runId}=observation,previousRunId=source.receipt.runId,sourceId=source.receipt.submissionId;
    const provenance=observation.inputProvenance as Json|null;
    if(provenance?.kind!=="inter_session"||(provenance.sourceTool!=="subagent_settle"&&provenance.sourceTool!=="subagent_announce")||typeof provenance.sourceSessionKey!=="string"||
      !agentId||!sessionId||!sessionKey||!runId||!previousRunId||!source.originDeviceId||!root||root.parentSessionKey||
      root.agentId!==agentId||root.sessionId!==sessionId||root.sessionKey!==conversation.sessionKey||root.rootSessionKey!==conversation.sessionKey||
      root.sourceId!==sourceId||root.runId!==previousRunId||root.goalId!==null||root.mode==="diagnostic")throw fail();
    const childKey=provenance.sourceSessionKey,child=this.authority.get(childKey);
    if(!child||child.agentId!=="household-analysis"||child.parentSessionKey!==root.sessionKey||child.rootSessionKey!==root.rootSessionKey||
      child.sourceId!==sourceId||child.goalId!==null||child.mode!==root.mode||!child.runId||!/^[-_A-Za-z0-9]{1,128}$/.test(child.runId))throw fail();
    const parentKey=sessionKey.startsWith(`agent:${agentId}:`)?sessionKey:`agent:${agentId}:${sessionKey}`;
    // The installed native owner has separate exact identities for a yielded
    // requester and a direct single-child completion.
    if(provenance.sourceTool==="subagent_settle"){
      const prefix=`announce:requester-settle:${agentId}:${parentKey}:${child.runId}:yield-`;
      if(!runId.startsWith(prefix)||!(/^[1-9][0-9]{0,8}$/).test(runId.slice(prefix.length)))throw fail();
    }else if(runId!==`announce:v1:${childKey}:${child.runId}`)throw fail();
    const rootFingerprint=fingerprint(root),childFingerprint=fingerprint(child);
    const current=()=>{
      observation.assertCurrent?.();
      const profile=this.database.getProfile(source.receipt.profileId),grant=this.options.profileGrants[source.receipt.profileId];
      const device=this.database.getDevice(source.originDeviceId!),binding=this.database.getSubmissionDomainBinding(sourceId);
      const latestConversation=this.database.getConversation(conversation.id);
      if(!profile||profile.agentId!==agentId||profile.role==="child"||!profile.capabilities.includes("chat")||["paused","offline"].includes(profile.status)||
        !grant?.enabled||!grant.domains.includes("analysis")||conversation.audience==="household"&&!grant.sharedDomains.includes("analysis")||
        device?.status!=="active"||device.deviceKind!=="personal"||device.profileId!==profile.id||!binding||binding.goalBound||
        binding.controlWatermark!==this.database.getGoalControlIssuedAt(conversation.id)||binding.audience!==conversation.audience||
        !latestConversation||latestConversation.sessionKey!==conversation.sessionKey||latestConversation.agentId!==agentId||latestConversation.audience!==conversation.audience||
        latestConversation.ownerProfileId!==profile.id||fingerprint(this.authority.get(root.sessionKey))!==rootFingerprint||fingerprint(this.authority.get(childKey))!==childFingerprint)throw fail();
    };
    current();
    const terminal=await this.adapter.observeAnalysisChild({childSessionKey:childKey,runId:child.runId,parentSessionKey:parentKey,
      expectedSessionId:child.sessionId,rootTaskId:"conversation:"+conversation.id,assertCurrent:current});
    if(!["complete","failed","cancelled"].includes(terminal.state)||await this.currentGoal(conversation,sessionId,null))throw fail();
    current();
    if(!this.database.submissions.adoptGoalFreeNativeRun(sourceId,previousRunId,runId,()=>{
      current();this.authority.bind({...root,runId});
    }))throw fail();
  }
  async admit(observation:NativeObservation){
    observation.assertCurrent?.();
    const {agentId,runId,sessionId}=observation;if(!agentId||!runId||!sessionId||!observation.sessionKey)return;
    const sessionKey=normalizedSessionKey(agentId,observation.sessionKey),old=this.authority.get(sessionKey);
    if(old?.parentSessionKey)return; // A child cannot invent a new human admission.
    let conversation=this.database.findConversationBySessionKey(sessionKey);
    const provenanceKind=(observation.inputProvenance as Json|null)?.kind;
    const mappedActor=observation.channel==="discord"?this.rules.find(rule=>rule.externalUserId===observation.senderId&&rule.channelId===observation.channelId&&rule.agentId===agentId):null;
    if(observation.channel==="discord"&&observation.senderId&&!["external_user","internal_system","inter_session"].includes(String(provenanceKind)))throw new DomainError("verified_native_human_source_required",{httpStatus:403});
    if(mappedActor&&provenanceKind==="external_user"&&!this.confirmedMessage(observation))
      throw new DomainError("verified_native_discord_message_required",{httpStatus:403});
    if(observation.supportedMediaExpected&&mappedActor&&provenanceKind==="external_user"){await this.awaitCurrentAttachments(observation,mappedActor);conversation=this.database.findConversationBySessionKey(sessionKey);}
    if(conversation){
      const pending=this.database.submissions.listForConversation(conversation.id).filter(s=>["running","dispatching"].includes(s.receipt.status)&&!s.recoveryRequired);
      const source=pending.find(s=>s.receipt.runId===runId||s.receipt.submissionId===runId)??(pending.length===1?pending[0]:undefined);
      const exactAppRun=source?.receipt.runId===runId||source?.receipt.submissionId===runId;
      if(source?.originDeviceId&&(exactAppRun||provenanceKind!=="external_user"||!observation.senderId||mappedActor?.profileId===source.receipt.profileId)){
        const packet=source.taskContext;
        if(packet?.mode==="diagnostic"){
          const actor=this.database.getProfile(source.receipt.profileId);if(!actor)throw new DomainError("diagnostic_operator_required",{httpStatus:403});
          this.diagnosticAuthority(actor,conversation.audience);
        }
        const goalId=await this.currentGoal(conversation,sessionId,source.receipt.goalId);observation.assertCurrent?.();
        if(!goalId&&!exactAppRun){await this.adoptAnalysisWake(observation,conversation,source,old);return;}
        this.authority.bind({sessionKey,rootSessionKey:conversation.sessionKey,sourceId:source.receipt.submissionId,parentSessionKey:null,agentId,sessionId,goalId,runId,mode:packet?.mode==="diagnostic"?"diagnostic":packet?.mode==="brain_dump"?"brain_dump":"normal"});
        const verifiedText=source.payload?.kind==="message"?source.payload.text:observation.exactCurrentMessage&&typeof observation.sourceText==="string"&&hash(observation.sourceText)===source.textHash?observation.sourceText:null;
        if(verifiedText){this.remember(source.receipt.submissionId,verifiedText,true);await this.captureSource(source.receipt.submissionId,verifiedText);}
        return;
      }
    }
    if(old&&["internal_system","inter_session"].includes(String(provenanceKind))){
      const source=this.database.submissions.get(old.sourceId);
      if(!source||!conversation||!["running","dispatching"].includes(source.receipt.status)||source.recoveryRequired)throw new DomainError("native_continuation_source_not_active");
      const goalId=await this.currentGoal(conversation,sessionId,source.receipt.goalId);observation.assertCurrent?.();
      if(!goalId||old.goalId&&old.goalId!==goalId)throw new DomainError("native_continuation_goal_changed");
      this.authority.bind({...old,sessionId,goalId,runId});return;
    }
    if(observation.jobId){await this.admitSchedule(observation);return;}
    const rule=observation.channel==="discord"&&this.rules.find(rule=>rule.externalUserId===observation.senderId&&rule.channelId===observation.channelId&&rule.agentId===agentId);
    if(!rule||typeof observation.sourceText!=="string"||observation.sourceText.length>24_000)return;
    const stagedSource=this.database.submissions.get("native-turn-"+hash(runId).slice(0,48));
    const hasCurrentAttachments=Boolean(stagedSource?.taskContext?.artifactIds.length&&stagedSource.taskContext.origin?.kind==="discord"&&stagedSource.taskContext.origin.externalUserId===rule.externalUserId&&stagedSource.taskContext.origin.channelId===rule.channelId);
    if(!observation.sourceText.trim()&&!hasCurrentAttachments)return;
    // Native automatic continuations retain the existing source; only trusted new user identity changes it.
    const provenance=observation.inputProvenance as Json|null;
    if(provenance?.kind!=="external_user")return;
    const profile=this.database.getProfile(rule.profileId);if(!profile||profile.role==="child"||!profile.capabilities.includes("chat"))return;
    if(!conversation){conversation={id:"native-conv-"+hash(sessionKey).slice(0,32),ownerProfileId:profile.id,agentId,sessionKey,title:rule.audience==="household"?"Household brain dump":"Private household conversation",presetId:null,audience:rule.audience,updatedAt:new Date().toISOString()};this.database.insertConversation(conversation);}
    if(conversation.audience!==rule.audience||conversation.agentId!==agentId)throw new DomainError("native_channel_binding_conflict");
    const diagnostic=this.diagnosticRequested(observation.sourceText);
    if(diagnostic){
      this.diagnosticAuthority(profile,rule.audience);
      const active=await this.currentGoal(conversation,sessionId,null);
      if(active&&old?.mode!=="diagnostic")throw new DomainError("diagnostic_new_conversation_required",{httpStatus:409});
    }
    const sourceId="native-turn-"+hash(runId).slice(0,48),packet:MessageTaskContext={mode:diagnostic?"diagnostic":rule.brainDump?"brain_dump":"conversation",artifactIds:[],expectedSessionId:sessionId,origin:{kind:"discord",externalUserId:rule.externalUserId,channelId:rule.channelId,sourceId:observation.sourceMessageId!,shared:rule.audience==="household",confirmedHuman:true}};
    const existing=this.database.submissions.get(sourceId),text=observation.sourceText;
    if(existing?.taskContext?.artifactIds.length){
      if(existing.taskContext.origin?.kind!=="discord"||existing.taskContext.origin.externalUserId!==rule.externalUserId||existing.taskContext.origin.channelId!==rule.channelId||existing.taskContext.origin.sourceId!==observation.sourceMessageId)throw new DomainError("discord_attachment_source_conflict");
      packet.artifactIds=[...existing.taskContext.artifactIds];
    }
    if(existing&&(existing.receipt.profileId!==profile.id||existing.receipt.agentId!==agentId))throw new DomainError("native_source_actor_conflict",{httpStatus:403});
    if(this.confirmedMessage(observation)){
      const repeated=this.database.domainConnection().prepare(`SELECT id FROM submissions WHERE conversation_id=? AND profile_id=? AND id<>? AND
        json_extract(task_context_json,'$.origin.kind')='discord' AND json_extract(task_context_json,'$.origin.confirmedHuman')=1 AND
        json_extract(task_context_json,'$.origin.sourceId')=? ORDER BY created_at LIMIT 1`).get(conversation.id,profile.id,sourceId,observation.sourceMessageId) as {id:string}|undefined;
      if(repeated){
        const original=this.database.submissions.get(repeated.id);
        if(!original||original.textHash!==hash(text))throw new DomainError("native_human_source_conflict");
        if(existing&&["running","dispatching"].includes(existing.receipt.status))this.database.submissions.reconcile(sourceId,"cancelled",existing.receipt.runId);
        if(!["running","dispatching"].includes(original.receipt.status)||original.recoveryRequired)throw new DomainError("native_human_source_already_settled");
        const goalId=await this.currentGoal(conversation,sessionId,original.receipt.goalId);observation.assertCurrent?.();
        this.authority.bind({sessionKey,rootSessionKey:conversation.sessionKey,sourceId:original.receipt.submissionId,parentSessionKey:null,agentId,sessionId,goalId,runId,mode:original.taskContext?.mode==="brain_dump"?"brain_dump":original.taskContext?.mode==="diagnostic"?"diagnostic":"normal"});
        return;
      }
    }
    if(!existing){
      // Same ledger, a mirror of an already admitted native turn: it never enters the app dispatch queue.
      const now=new Date().toISOString();
      this.database.domainConnection().prepare(`INSERT INTO submissions(id,conversation_id,profile_id,agent_id,text_hash,status,run_id,created_at,updated_at,task_context_json) VALUES (?,?,?,?,?,'running',?,?,?,?)`).run(sourceId,conversation.id,profile.id,agentId,hash(text),runId,now,now,JSON.stringify(packet));
    }else if(observation.exactCurrentMessage&&!this.sources.get(sourceId)?.exact){this.database.domainConnection().prepare("UPDATE submissions SET text_hash=?,task_context_json=? WHERE id=? AND status='running'").run(hash(text),JSON.stringify(packet),sourceId);}
    this.remember(sourceId,text,observation.exactCurrentMessage===true);
    if(packet.origin?.confirmedHuman)await this.captureSource(sourceId,text);
    const goalId=await this.currentGoal(conversation,sessionId,existing?.receipt.goalId);observation.assertCurrent?.();
    this.authority.bind({sessionKey,rootSessionKey:conversation.sessionKey,sourceId,parentSessionKey:null,agentId,sessionId,goalId,runId,mode:diagnostic?"diagnostic":rule.brainDump?"brain_dump":"normal"});
  }
  private async admitSchedule(observation:NativeObservation){
    if(!this.options.schedulingEnabled||!observation.jobId||!observation.sessionKey||!observation.agentId||!observation.sessionId||!observation.runId)return;
    const result=await this.adapter.requestDomainCapability("cron.get",{id:observation.jobId},()=>{});
    if(!result||typeof result!=="object"||Array.isArray(result))return;
    const raw=result as Json,job=(raw.job??raw) as Json,owner=job.owner as Json|undefined,payload=job.payload as Json|undefined;
    if(job.id!==observation.jobId||typeof owner?.sessionKey!=="string"||owner.agentId!==observation.agentId||job.agentId!==observation.agentId||job.enabled!==true||
      typeof job.declarationKey!=="string"||payload?.kind!=="agentTurn"||typeof job.configRevision!=="string"||!job.configRevision||job.configRevision.length>128||
      typeof payload.message!=="string"||!payload.message.trim()||payload.message.length>20_000||payload.toolsAllowIsDefault!==false||
      !Array.isArray(payload.toolsAllow)||payload.toolsAllow.length>200||new Set(payload.toolsAllow).size!==payload.toolsAllow.length||
      payload.toolsAllow.some(name=>typeof name!=="string"||!this.options.scheduledToolNames.includes(name)||!scheduledSystemTools.has(name)&&!taskNativeNames.includes(name)&&!domainCatalog.some(tool=>tool.nativeName===name)))return;
    const origin=this.database.findConversationBySessionKey(owner.sessionKey);if(!origin)return;
    // Shared contributions retain their actual actor. Declaration ownership is
    // the exact profile hash+source conversation hash, never a guessed owner.
    const declarationKey=job.declarationKey as string;
    const profile=this.database.listProfiles().find(candidate=>candidate.role!=="child"&&candidate.agentId===observation.agentId&&
      declarationKey.startsWith("household:"+hash(candidate.id).slice(0,20)+":"+hash(origin.id).slice(0,20)+":"));
    if(!profile||!profile.capabilities.includes("chat")||["paused","offline"].includes(profile.status)||
      origin.audience==="private"&&(origin.ownerProfileId!==profile.id||origin.agentId!==profile.agentId))return;
    const grant=this.options.profileGrants[profile.id],shared=origin.audience==="household";
    if(!grant?.enabled||!grant.domains.includes("schedule")||!grant.scopes.includes(shared?"household":"personal")||shared&&!grant.sharedDomains.includes("schedule"))return;
    const scheduledTools=(payload.toolsAllow as string[]).filter(name=>this.scheduledToolAllowed(name,grant,shared));
    const selected=job.description==="Household task; audience=personal"?"personal":job.description==="Household task; audience=household"?"household":null;
    const delivery=selected?this.scheduledDelivery(job.delivery,profile.id,grant,selected):null;
    if(!selected||!delivery)throw new DomainError("scheduled_delivery_route_not_authorized",{httpStatus:403});
    const key=normalizedSessionKey(observation.agentId,observation.sessionKey),id="native-cron-"+hash(observation.runId).slice(0,48),now=new Date().toISOString();
    let conversation=this.database.findConversationBySessionKey(key);
    if(!conversation){conversation={...origin,id:"native-conv-"+hash(key).slice(0,32),ownerProfileId:profile.id,agentId:observation.agentId,sessionKey:key,title:"Scheduled household task",updatedAt:now};this.database.insertConversation(conversation);}
    if(conversation.ownerProfileId!==profile.id||conversation.agentId!==observation.agentId||conversation.audience!==origin.audience)throw new DomainError("native_schedule_context_conflict");
    const text=payload.message,packet:MessageTaskContext={mode:"task",artifactIds:[],scheduledTools,scheduledRevision:job.configRevision,scheduledScope:selected,scheduledDelivery:delivery,
      origin:{kind:"scheduled",jobId:observation.jobId,sourceId:"native-cron:"+observation.runId,shared}};
    const prior=this.database.submissions.get(id);
    if(!prior)this.database.domainConnection().prepare(`INSERT INTO submissions(id,conversation_id,profile_id,agent_id,text_hash,status,run_id,created_at,updated_at,task_context_json) VALUES (?,?,?,?,?,'running',?,?,?,?)`).run(id,conversation.id,profile.id,observation.agentId,hash(text),observation.runId,now,now,JSON.stringify(packet));
    else if(prior.textHash!==hash(text)||prior.receipt.profileId!==profile.id||prior.taskContext?.scheduledRevision!==packet.scheduledRevision||
      JSON.stringify(prior.taskContext?.scheduledTools)!==JSON.stringify(scheduledTools)||JSON.stringify(prior.taskContext?.scheduledDelivery)!==JSON.stringify(delivery)||prior.taskContext?.scheduledScope!==selected||!["running","dispatching"].includes(prior.receipt.status))throw new DomainError("native_schedule_source_conflict");
    this.remember(id,text,true);await this.captureSource(id,text);
    const goalId=await this.currentGoal(conversation,observation.sessionId,prior?.receipt.goalId);
    this.authority.bind({sessionKey:key,rootSessionKey:key,sourceId:id,parentSessionKey:null,agentId:observation.agentId,sessionId:observation.sessionId,goalId,runId:observation.runId,mode:"normal"});
  }
  async child(event:Json,context:Json){
    if(typeof context.requesterSessionKey!=="string"||typeof event.childSessionKey!=="string"||typeof event.agentId!=="string"||typeof event.runId!=="string")throw new DomainError("native_child_projection_invalid");
    const parentAgent=context.requesterSessionKey.split(":")[1],parentKey=normalizedSessionKey(parentAgent,context.requesterSessionKey),parent=this.authority.get(parentKey);
    if(!parent)throw new DomainError("native_parent_authority_required",{httpStatus:403});
    const source=this.database.submissions.get(parent.sourceId);if(!source||!["running","dispatching"].includes(source.receipt.status))throw new DomainError("native_parent_not_active");
    const key=normalizedSessionKey(event.agentId,event.childSessionKey);
    this.authority.bind({sessionKey:key,rootSessionKey:parent.rootSessionKey,sourceId:parent.sourceId,parentSessionKey:parentKey,agentId:event.agentId,sessionId:null,goalId:parent.goalId,runId:event.runId,mode:parent.mode});
  }
  bootstrap(agentId:string,key:string):"private"|"household"|"unknown" {
    const grant=this.authority.get(normalizedSessionKey(agentId,key)),conversation=this.database.findConversationBySessionKey(grant?.rootSessionKey??key);
    if(!conversation||grant?.parentSessionKey)return "unknown";
    return conversation.audience==="private"&&conversation.agentId===agentId?"private":"household";
  }
  settle(sessionKey:string,agentId:string,status:"complete"|"failed"|"cancelled",waiting:boolean,runId?:string){
    const grant=this.authority.get(normalizedSessionKey(agentId,sessionKey));if(!grant||grant.parentSessionKey)return;
    const source=this.database.submissions.get(grant.sourceId);if(!source?.taskContext?.origin||runId&&source.receipt.runId!==runId)return;
    this.database.submissions.reconcile(grant.sourceId,waiting?"waiting_for_user":status,source.receipt.runId);
  }
}
