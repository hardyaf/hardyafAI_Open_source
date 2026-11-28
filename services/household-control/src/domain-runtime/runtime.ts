import { createReceiptCaptureRoutes } from "../client-views/receipt-capture.ts";
import type { RequestContext } from "../server.ts";
import {scheduleDeliveryIdentity} from "../domains/scheduling/delivery-session.ts";
import { readSourceQuestionSettlement,settleResolvedWaitingSources } from "../task-flow/source-settlement.ts";
import type { SourceSettlementInput } from "../task-flow/source-settlement.ts";
import { nativeOperationId } from "./operation-id.ts";
import { AnalysisAdmissionBindings } from "./analysis-admission.ts";
import { NativeApprovalBridge,nativeApprovalRouteAuthorized } from "./native-approval.ts";
import { captureNativeDiagnosticEvent } from "./native-diagnostic-events.ts";
import { projectNativeProgressPlan } from "../task-flow/native-progress-policy.ts";
import { HOUSEHOLD_VERSION } from "../version.ts";
import { composeContactExtraction } from "./contact-extraction.ts";
import {priorOutcomeContext} from "./prior-context.ts";
import {taskToolDescriptors} from "../task-flow/catalog.ts";
import {nativeToolName} from "./common.ts";
import {composeHouseholdDisplay} from "./display-composition.ts";
import {displayToolDescriptors} from "../display/tools.ts";
import type {DisplayReader} from "../display/contracts.ts";
import {NativeAdmission} from "./native-admission.ts";
import type {NativeObservation} from "./native-admission.ts";
import {HouseholdTaskApplication,type TaskApplicationBinding} from "./task-application.ts";
import {SelectedDomainContextLoader,taskContractDigest} from "../task-flow/context-loader.ts";
import type {LoadedTaskContract} from "../task-flow/context-loader.ts";
import type {ExecutionGrant} from "../request-context.ts";
import type {TaskFlowContext,TaskQuestion,TaskReply,TaskEvidenceRef,VerifiedTaskEvidence} from "../task-flow/types.ts";
import type {AnalysisFlowContext,NativeAnalysisRequest} from "../analysis-flow/types.ts";
const isAnalysisAgent = (agent: unknown) => agent === "household-analysis";
import { workshopAuthorized } from "./workshop-authorization.ts";
import { emailAttachments } from "./email-attachments.ts";
import { captureWorkshopDeliverables } from "./workshop-deliveries.ts";
import { deliverEmailResult } from "./email-delivery.ts";
import {NativeExecutionPolicies} from "../platform/native-execution.ts";
import {HouseholdClientQueries} from "./client-queries.ts";
import type {ClientReadQuery} from "../client-views/contracts.ts";
import {fingerprint} from "./common.ts";
import Ajv from "ajv";
import { createHash } from "node:crypto";
const fingerprintText=(text:string)=>createHash("sha256").update(text).digest("hex");
import { access,lstat } from "node:fs/promises";
import { constants } from "node:fs";
import type { HouseholdDatabase } from "../database.ts";
import type { OpenClawAgentAdapter } from "../openclaw-adapter.ts";
import type { ArtifactStore } from "../platform/artifacts.ts";
import { readTaskDiagnosticEvidence } from "./diagnostics.ts";
import {LocalSystemStatusReader,readSystemStatus,systemStatusAuthorized,assertSystemStatusAuthority} from "./system-status.ts";
import type {SystemStatusReader} from "./system-status.ts";
import { ContactsService,ArtifactContactsSourceAccess,createContactsTools } from "../domains/contacts/index.ts";
import type { ContactPrincipal } from "../domains/contacts/index.ts";
import { DocumentsService,ArtifactDocumentAccess,LocalDocumentExtractor,createDocumentsTools } from "../domains/documents/index.ts";
import type { DocumentPrincipal } from "../domains/documents/index.ts";
import { LocalManagedWikiPages,ListDomain,GoogleDomain,MemoryDomain,WorkspaceMemorySources,ScheduleDomain } from "../domains/native-domains.ts";
import type { NativeDomainContext,NativeRpcPort } from "../domains/native-domains.ts";
import { domainCatalog } from "./catalog.ts";
import type { CatalogTool } from "./catalog.ts";
import { BoundedProcessRunner } from "./bounded-process.ts";
import type { ConnectedGooglePort } from "../domains/google/connections-port.ts";
import { DomainEffectStore } from "./effect-store.ts";
import { NativeDomainAuthorization,normalizedSessionKey } from "./native-scope.ts";
import type { NativeToolContext,AuthorizedScope } from "./native-scope.ts";
import type { DomainConfiguration } from "./configuration.ts";
import { DomainError,domainErrorCode } from "./common.ts";
import { ReceiptsBridge } from "./receipts-bridge.ts";

export type BoundNativeToolContext=NativeToolContext & {toolCallId?:string;toolBindings?:Readonly<Record<string,unknown>>};
type RuntimeAuthorizedScope=AuthorizedScope & {credentialAuthority:Readonly<NonNullable<NativeDomainContext["credentialAuthority"]>>};
type Json=Record<string,unknown>;
const scheduledCapabilities=[...domainCatalog.filter(t=>!["analysis","display","diagnostics","effects"].includes(t.domain)).map(t=>t.nativeName),
  ...taskToolDescriptors.filter(t=>!["task.stop","task.bind_reply"].includes(t.name)).map(t=>nativeToolName(t.name)),
  "get_goal","create_goal","update_goal","progress_card","sessions_spawn","sessions_yield","session_status","subagents","sessions_send","tool_search","tool_describe","tool_call"];
type Validator=((value:unknown)=>boolean);
function object(value:unknown):Json{return value&&typeof value==="object"&&!Array.isArray(value)?value as Json:{};}
function errorOutcome(error:unknown):"not_sent"|"unknown"{
  const value=error as {outcome?:string;deliveryOutcome?:string};
  return value?.outcome==="not_sent" || value?.deliveryOutcome==="not_sent" ? "not_sent":"unknown";
}
async function readable(filename:string):Promise<boolean>{try{const stat=await lstat(filename);await access(filename,constants.R_OK);return stat.isFile()&&!stat.isSymbolicLink();}catch{return false;}}

/** Composition/application service. Domain modules receive owned protocols, not this graph. */
export class HouseholdDomainRuntime {
  private readonly database:HouseholdDatabase;
  private readonly adapter:OpenClawAgentAdapter;
  private readonly artifacts:ArtifactStore;
  private readonly config:DomainConfiguration;
  private readonly authorization:NativeDomainAuthorization;
  readonly admission:NativeAdmission;
  readonly tasks:HouseholdTaskApplication;
  readonly clientQueries:HouseholdClientQueries;
  readonly display:ReturnType<typeof composeHouseholdDisplay>;
  private readonly taskScopes=new WeakMap<TaskFlowContext,AuthorizedScope>();
  private readonly contextLoader:SelectedDomainContextLoader;
  private readonly analysisBindings:AnalysisAdmissionBindings;
  private readonly nativeApprovals:NativeApprovalBridge;
  private nativePolicyReader?:()=>unknown;
  private scheduledDeliveryPolicyReader?:()=>Promise<DomainConfiguration>;
  private nativeSpawn?: (context:AnalysisFlowContext,request:NativeAnalysisRequest)=>Promise<any>;
  private readonly effects:DomainEffectStore;
  private readonly runner:BoundedProcessRunner;
  private readonly systemStatus:SystemStatusReader;
  private readonly contacts:ContactsService;
  private readonly contactTools:ReturnType<typeof createContactsTools>;
  private readonly documents:DocumentsService;
  private readonly documentAccess:ArtifactDocumentAccess;
  private readonly documentTools:ReturnType<typeof createDocumentsTools>;
  private readonly lists:ListDomain;
  private readonly google:GoogleDomain;
  private readonly memory:MemoryDomain;
  private readonly schedule:ScheduleDomain;
  private readonly receipts:ReceiptsBridge;
  private readonly validators=new Map<string,Validator>();
  private readonly inFlight=new Set<Promise<unknown>>();
  private closed=false;
  constructor(options:{database:HouseholdDatabase;adapter:OpenClawAgentAdapter;artifacts:ArtifactStore;configuration:DomainConfiguration;
    nativeSandboxCheck?:(sessionKey:string,agentId:string)=>Promise<void>;connectedGoogle?:ConnectedGooglePort;systemStatus?:SystemStatusReader}){
    this.database=options.database;this.adapter=options.adapter;this.artifacts=options.artifacts;this.config=options.configuration;
    this.admission=new NativeAdmission(this.database,this.adapter,this.config.execution.nativeEntries,this.artifacts,{workshopOwnerProfileId:this.config.execution.workshop?.dataRoot?this.config.execution.workshop.ownerProfileId:undefined,schedulingEnabled:this.config.execution.schedulingEnabled,scheduledToolNames:scheduledCapabilities,profileGrants:this.config.profiles,notificationTargets:this.config.execution.notificationTargets,queuedNoticePolicy:this.config.execution.queuedNoticePolicy??"finish_accepted"});
    this.analysisBindings=new AnalysisAdmissionBindings(this.admission.authority);
    this.authorization=new NativeDomainAuthorization(this.database,this.config.profiles,(packet,id)=>this.admission.externalCurrent(packet,id));
    this.effects=new DomainEffectStore(this.database.domainConnection());this.runner=new BoundedProcessRunner();
    this.systemStatus=options.systemStatus??new LocalSystemStatusReader(this.runner);
    this.documentAccess=new ArtifactDocumentAccess(this.artifacts);
    this.documents=new DocumentsService(this.documentAccess,new LocalDocumentExtractor({pythonPath:this.config.documents.python,
      readerScriptPath:this.config.documents.script,cacheRoot:this.config.documents.cacheRoot},this.runner));
    this.documentTools=createDocumentsTools(this.documents);
    this.contacts=new ContactsService(this.database.domainConnection(),new ArtifactContactsSourceAccess(this.artifacts),composeContactExtraction({
      documents:this.documents,access:this.documentAccess,allowed:principal=>{const grant=this.config.profiles[principal.profileId];return Boolean(grant?.enabled&&grant.domains.includes("documents")&&(principal.audience!=="household"||grant.sharedDomains.includes("documents")));}}));
    this.contactTools=createContactsTools(this.contacts);
    this.lists=new ListDomain(this.config.capture,this.runner);
    this.google=new GoogleDomain({...this.config.google,timeZone:this.config.google.timezone},this.runner,options.connectedGoogle);
    const rpc:NativeRpcPort={request:async(method,params,context)=>{
      if(!context || typeof context.assertCurrent!=="function")throw new DomainError("native_domain_authority_required",{httpStatus:403});
      return this.adapter.requestDomainCapability(method as Parameters<OpenClawAgentAdapter["requestDomainCapability"]>[0],params,context.assertCurrent);
    }};
    this.memory=new MemoryDomain({enabled:true,sharedAgentId:this.config.memory.sharedAgentId,timeZone:this.config.google.timezone},rpc,new WorkspaceMemorySources(this.config.memory.workspaces),
      new LocalManagedWikiPages({vaults:this.config.memory.wikiVaults}),async(agentId,context)=>{await this.runner.runJson(this.config.execution.openclawBinary,["memory","index","--agent",agentId,"--force"],{timeoutMs:360_000,maxBytes:2*1024*1024,env:{OPENCLAW_CONFIG_PATH:this.config.execution.nativeConfigPath},assertCurrent:context.assertCurrent,signal:context.signal,completionOnly:true});},
      (selected,id,context)=>{
        const grant=this.config.profiles[context.profileId];
        if(!grant?.enabled||!grant.domains.includes("lists")||selected==="household"&&!grant.sharedDomains.includes("lists"))
          throw new DomainError("reference_note_read_not_authorized",{httpStatus:403});
        return this.lists.readReferenceNote(selected,id,context);
      });
    this.schedule=new ScheduleDomain({allowActivation:this.config.execution.schedulingEnabled,scheduledTools:scheduledCapabilities,queuedNoticePolicy:this.config.execution.queuedNoticePolicy??"finish_accepted",deliveryScopeReady:()=>Boolean(this.nativePolicyReader)&&object(object(this.nativePolicyReader?.()).session).scope!=="global"},rpc);
    this.receipts=new ReceiptsBridge(this.config.uplift,this.runner,this.artifacts,this.documentAccess);
    this.display=composeHouseholdDisplay({database:this.database,artifacts:this.artifacts,lists:this.lists,google:this.google});
    this.clientQueries=new HouseholdClientQueries({authority:{read:(id)=>{const profile=this.database.getProfile(id),grant=this.config.profiles[id];return profile&&grant?{profile,grant}:null;}},
      contacts:this.contacts,lists:this.lists,memory:this.memory,receipts:{reviewList:(principal,limit)=>this.receipts.reviewList(principal,limit)}});
    this.contextLoader=new SelectedDomainContextLoader(this.config.execution.skillsRoot);
    const policies=new NativeExecutionPolicies({configPath:this.config.execution.nativeConfigPath,image:this.config.execution.sandboxImage,workshop:this.config.execution.workshop});
    const sandboxCheck=options.nativeSandboxCheck;
    this.tasks=new HouseholdTaskApplication({database:this.database,artifacts:this.artifacts,resolveContext:(context)=>this.getTaskContext(context),
      loadCatalog:task=>this.loadTaskCatalog(task),
      contractsLoaded:(binding,contracts)=>this.recordLoadedContracts(binding,contracts),
      nativeProgress:async(binding)=>{const scope=this.taskScopes.get(binding.task);if(!scope)throw new DomainError("task_authority_invalid");scope.principal.assertCurrent();
        const card=await this.adapter.getProgress(scope.conversation);scope.principal.assertCurrent();return {card,sourceCreatedAtMs:Date.parse(scope.principal.sourcePromptCreatedAt)};},
      effectsEvidence:(task,refs)=>this.effectEvidence(task,refs),policies,
      workshopAllowed:binding=>{
        const scope=this.taskScopes.get(binding.task),profile=scope&&this.database.getProfile(scope.principal.profileId);
        return binding.execution.agentId === "main" && !!this.config.execution.workshop?.dataRoot && workshopAuthorized(this.config.execution.workshop?.ownerProfileId,profile,scope);
      },
      workshopToolPolicy:sandboxCheck?binding=>this.verifyWorkshopToolPolicy(binding,policies,sandboxCheck):undefined,
      analysisToolPolicy:sandboxCheck?binding=>this.verifyAnalysisToolPolicy(binding,policies,sandboxCheck):undefined,
      publicWebAllowed:binding=>{
        const scope=this.taskScopes.get(binding.task);
        if(!scope?.grant.enabled||!scope.grant.domains.includes("web")||binding.execution.agentId!==scope.conversation.agentId||
          normalizedSessionKey(binding.execution.agentId,binding.execution.sessionKey)!==scope.conversation.sessionKey)return false;
        return scope.principal.audience==="household"?scope.grant.scopes.includes("household")&&scope.grant.sharedDomains.includes("web"):scope.grant.scopes.includes("personal");
      },
      spawn:(context,request)=>{if(!this.nativeSpawn)throw new DomainError("native_analysis_transport_unavailable");return this.analysisBindings.spawn(context,request,()=>this.nativeSpawn!(context,request));},
      childRequestMatches:async(context,requestArtifactId,key,runId)=>this.analysisBindings.matches(context,requestArtifactId,key,runId),
      child:(context,identity)=>this.analysisBindings.observe(context,identity,request=>this.adapter.observeAnalysisChild(request)),
      sandboxRoots:this.config.execution.sandboxRoots,domainToolNames:domainCatalog.map(t=>t.nativeName),domainTools:domainCatalog,completeNative:(binding,summary)=>this.completeTask(binding,summary),completionEvidence:binding=>this.completionCandidates(binding),completionCanSettle:binding=>this.completionCanSettle(binding),stop:(binding,input)=>this.stopTask(binding,input),
      allowGoalCreation:(binding)=>{const scope=this.taskScopes.get(binding.task);return Boolean(scope&&(scope.packet?.origin?.kind==='scheduled'&&scope.packet.scheduledTools?.includes('create_goal')||binding.execution.agentId==='main'&&workshopAuthorized(this.config.execution.workshop?.ownerProfileId,this.database.getProfile(scope.principal.profileId),scope)));},validateQuestion:(task,question)=>this.validateQuestion(task,question),validateReply:(task,question,reply)=>this.validateReply(task,question,reply)});
    this.nativeApprovals=new NativeApprovalBridge({database:this.database,authority:this.admission.authority,
      snapshot:binding=>this.tasks.snapshot(binding),validateQuestion:async(binding,question)=>{await this.validateQuestion(binding.task,structuredClone(question));},
      routeAuthorized:binding=>{const scope=this.taskScopes.get(binding.task);if(!scope)return false;
        try{return nativeApprovalRouteAuthorized(this.nativePolicyReader?.(),binding,this.config.execution.nativeEntries,this.config.execution.notificationTargets?.[scope.principal.profileId]);}catch{return false;}}});
    const ajv=new Ajv({strict:true,allErrors:false,coerceTypes:false,useDefaults:false,removeAdditional:false,validateFormats:false,ownProperties:true});
    for(const descriptor of [...domainCatalog,...this.tasks.catalog()])this.validators.set(descriptor.nativeName,ajv.compile(descriptor.inputSchema));
  }
  catalog(context?:BoundNativeToolContext):CatalogTool[]{
    if(!context)return [...domainCatalog,...this.tasks.catalog().filter(tool=>!["task.verify_outcome","task.finish"].includes(tool.name))];
    if(["household-analysis","household-workshop","household-diagnostics"].includes(context.agentId??""))return this.tasks.catalog(context);
    const grant=this.authorization.catalogGrant(context),conversation=this.authorization.root(context);
    const statusAllowed=systemStatusAuthorized({profile:conversation&&this.database.getProfile(conversation.ownerProfileId),audience:conversation?.audience,grant:grant??undefined});
    return grant?[...domainCatalog.filter(tool=>(tool.domain==="effects"||grant.domains.includes(tool.domain))&&(tool.name!=="diagnostics.system_status"||statusAllowed)),...this.tasks.catalog(context).filter(tool=>tool.domain==="task"||grant.domains.includes(tool.domain)||tool.name==="analysis.publish_report"&&grant.domains.includes("diagnostics"))]:[];
  }
  private async scope(context:BoundNativeToolContext,signal?:AbortSignal):Promise<RuntimeAuthorizedScope>{
    if(this.closed)throw new DomainError("domain_runtime_stopping",{httpStatus:503});
    const conversation=this.authorization.root(context);
    if(!conversation || !context.agentId)
      throw new DomainError("native_conversation_not_authorized",{httpStatus:403});
    context.assertInvocationCurrent?.();
    const native=await this.adapter.getContext(conversation);
    const source=this.database.submissions.listForConversation(conversation.id).find(s=>["running","dispatching"].includes(s.receipt.status));
    if(source&&!source.receipt.goalId&&native.goal?.status==="active"&&native.runId===context.runId){
      this.database.domainConnection().prepare("UPDATE submissions SET goal_id=?,domain_goal_bound=1 WHERE id=? AND goal_id IS NULL").run(native.goal.id,source.receipt.submissionId);
      const key=context.sessionKey?.replace(`agent:${context.agentId}:hardy-home:`,`hardy-home:`),projection=key&&this.admission.authority.get(key);
      if(projection)this.admission.authority.bind({...projection,goalId:native.goal.id});
    }
    // Local authorization and the isolated consumer must see the same observed
    // generation. Never reconstruct this authority from the SDK discovery context.
    const invocation=Object.freeze({...context,nativeRunId:native.runId,nativeGoalId:native.goal?.id??null,nativeGoalStatus:native.goal?.status??null,nativeSessionId:native.sessionId});
    const scope=this.authorization.resolve(invocation,signal);
    const credentialAuthority=Object.freeze({agentId:invocation.agentId,sessionKey:invocation.sessionKey,sessionId:invocation.sessionId,runId:invocation.runId,
      nativeRunId:invocation.nativeRunId,nativeGoalId:invocation.nativeGoalId,nativeGoalStatus:invocation.nativeGoalStatus,nativeSessionId:invocation.nativeSessionId});
    const current=scope.principal.assertCurrent;
    scope.principal.assertCurrent=()=>{if(this.closed)throw new DomainError("domain_runtime_stopping",{httpStatus:503});current();};
    return {...scope,credentialAuthority};
  }
  private async artifactGrants(scope:AuthorizedScope,args:Json):Promise<string[]>{
    const ids=new Set<string>();
    for(const key of ["artifactId","extractionArtifactId"]){if(typeof args[key]==="string" && /^artifact-[a-f0-9]{64}$/.test(args[key] as string))ids.add(args[key] as string);}
    for(const key of ["sourceArtifactIds","extractionArtifactIds"])if(Array.isArray(args[key]))for(const id of args[key] as unknown[])if(typeof id==="string")ids.add(id);
    const allowed:string[]=[];
    for(const id of ids){
      scope.principal.assertCurrent();
      if(this.contacts.authorizeSource(scope.principal,id))allowed.push(id);
      const metadata=await this.artifacts.get(id,{profileId:scope.principal.profileId,canReadHousehold:scope.principal.canReadHousehold});
      if(metadata.kind==='output'&&metadata.ownerProfileId===scope.principal.profileId&&metadata.conversationId===scope.conversation.id&&
        metadata.audience===scope.principal.audience&&[scope.principal.taskId,'conversation:'+scope.conversation.id].includes(metadata.taskId))allowed.push(id);
    }
    // Resolve an extraction's implicit original through the document owner, then recheck
    // the current contact/source ACL. Nested model claims never supply artifact grants.
    const extractionIds=[args.extractionArtifactId,args.artifactId,...(Array.isArray(args.extractionArtifactIds)?args.extractionArtifactIds:[])].filter((id):id is string=>typeof id==="string"&&/^artifact-[a-f0-9]{64}$/.test(id));
    for(const extractionId of new Set(extractionIds)){
      const metadata=await this.artifacts.get(extractionId,{profileId:scope.principal.profileId,canReadHousehold:scope.principal.canReadHousehold});
      if(metadata.kind==="evidence"&&metadata.filename==="document-extraction.json"){
        const parsed=await this.documentAccess.result({...scope.principal,canProcessDocuments:true,allowedArtifactIds:[extractionId]},extractionId);
        const source=await this.artifacts.get(parsed.sourceArtifactId,{profileId:scope.principal.profileId,canReadHousehold:scope.principal.canReadHousehold});
        const bound=source.ownerProfileId===scope.principal.profileId&&source.conversationId===scope.principal.conversationId&&[scope.principal.taskId,"conversation:"+scope.principal.conversationId].includes(source.taskId);
        if(bound||this.contacts.authorizeSource(scope.principal,parsed.sourceArtifactId))allowed.push(extractionId,parsed.sourceArtifactId);
      }
    }
    return allowed;
  }
  async bindNativeInvocation(binding:any,event:Json,context:BoundNativeToolContext):Promise<void>{
    const scope=this.taskScopes.get(binding.task);
    if(!scope||binding.conversationOnly||typeof event.toolName!=="string"||![...domainCatalog,...this.tasks.catalog()].some(tool=>tool.nativeName===event.toolName))throw new DomainError("trusted_native_invocation_required");
    const runId=event.runId??context.runId,toolCallId=event.toolCallId??context.toolCallId;
    if(typeof runId!=="string"||!runId||typeof toolCallId!=="string"||!toolCallId||event.runId&&context.runId&&event.runId!==context.runId||event.toolCallId&&context.toolCallId&&event.toolCallId!==context.toolCallId||
      !context.agentId||!context.sessionKey||!context.sessionId||!event.params||typeof event.params!=="object"||Array.isArray(event.params))throw new DomainError("trusted_native_invocation_required");
    scope.principal.assertCurrent();
    const key=context.sessionKey.startsWith(`agent:${context.agentId}:hardy-home:`)?context.sessionKey.slice(`agent:${context.agentId}:`.length):context.sessionKey;
    this.admission.authority.bindChildSessionId(key,context.agentId,context.sessionId,runId,scope.principal.assertCurrent);
    this.admission.authority.invocations.bind({agentId:context.agentId,sessionKey:context.sessionKey,sessionId:context.sessionId,toolCallId,toolName:event.toolName,argumentHash:fingerprint(event.params)},runId,scope.principal.assertCurrent);
  }
  async executeNativeInvocation(nativeName:string,args:unknown,context:BoundNativeToolContext,signal?:AbortSignal):Promise<unknown>{
    if(!context.agentId||!context.sessionKey||!context.sessionId||!context.toolCallId||typeof context.assertInvocationCurrent!=="function")throw new DomainError("trusted_native_invocation_required");
    const nativeCurrent=context.assertInvocationCurrent;nativeCurrent();
    const identity={agentId:context.agentId,sessionKey:context.sessionKey,sessionId:context.sessionId,toolCallId:context.toolCallId,toolName:nativeName,argumentHash:fingerprint(args)};
    const pending=this.admission.authority.invocations.inspect(identity,nativeCurrent),bound={...context,runId:pending.runId,completionRecovery:nativeName==="household_task_complete"};
    const binding=await this.getTaskContext(bound);
    if(binding.conversationOnly)throw new DomainError("trusted_native_invocation_required");
    const current=()=>{nativeCurrent();binding.task.assertCurrent();};
    current();this.admission.authority.invocations.claim(identity,pending,current);current();
    return this.execute(nativeName,args,{...bound,assertInvocationCurrent:current},signal);
  }
  execute(nativeName:string,args:unknown,context:BoundNativeToolContext,signal?:AbortSignal):Promise<unknown>{
    const work=this.executeOwned(nativeName,args,{...context,completionRecovery:nativeName==="household_task_complete"},signal);this.inFlight.add(work);
    void work.then(()=>this.inFlight.delete(work),()=>this.inFlight.delete(work));return work;
  }
  private async executeOwned(nativeName:string,args:unknown,context:BoundNativeToolContext,signal?:AbortSignal):Promise<unknown>{
    const applicationTool=this.tasks.catalog().find(tool=>tool.nativeName===nativeName);
    if(applicationTool){
      if(!args||typeof args!=="object"||Array.isArray(args)||Buffer.byteLength(JSON.stringify(args))>512*1024||!this.validators.get(nativeName)!(args))throw new DomainError("task_tool_arguments_invalid");
      if(applicationTool.domain==="task"){
        const scope=await this.scope(context,signal);this.assertScheduledTool(scope,nativeName);
        if(applicationTool.name==="task.bind_reply"&&object(args).decision==="approve"){
          const binding=await this.getTaskContext(context);
          if(await this.nativeApprovals.isPending(binding,{toolName:nativeName,params:object(args),toolCallId:context.toolCallId},context))throw new DomainError("approval_resolution_pending",{httpStatus:409});
        }
        const result=await this.tasks.execute(nativeName,args,context,signal);
        if(["task.bind_reply","task.ask_question"].includes(applicationTool.name)){
          const binding=await this.getTaskContext(context),snapshot=await this.tasks.snapshot(binding),reply=snapshot.currentReply as any;
          if(reply?.relation==="new_topic"||reply?.independentTopicOf){
            scope.principal.assertCurrent();
            this.database.domainConnection().prepare("UPDATE submissions SET task_context_json=json_set(COALESCE(task_context_json,'{}'),'$.independentTopicOf',?,'$.independentSourcePromptId',?) WHERE id=? AND profile_id=? AND status IN('running','dispatching')")
              .run(reply.independentTopicOf??binding.task.native.goalId??binding.task.scope.taskId,String(reply.independentSourcePromptId??binding.task.source.id).replace(/^user:/,""),scope.principal.sourcePromptId,scope.principal.profileId);
          }
        }
        return result;
      }
      if(applicationTool.effect==="read"){
        const scope=await this.scope(context,signal);this.assertScheduledTool(scope,nativeName);if(scope.mode==="diagnostic"||!scope.grant.domains.includes("analysis")||scope.principal.audience==="household"&&!scope.grant.sharedDomains.includes("analysis"))throw new DomainError("analysis_not_authorized",{httpStatus:403});
        await this.assertBusinessReady(await this.getTaskContext(context),applicationTool);
        return this.tasks.execute(nativeName,args,context,signal);
      }
      const scope=await this.scope(context,signal),input={...object(args),operationId:nativeOperationId(scope.principal.sourcePromptId,applicationTool,object(args))};this.assertScheduledTool(scope,nativeName);
      const diagnosticReport=applicationTool.name==="analysis.publish_report"&&scope.mode==="diagnostic"&&this.database.getProfile(scope.principal.profileId)?.capabilities.includes("viewDiagnostics");
      if(!diagnosticReport&&(!scope.grant.domains.includes("analysis")||scope.principal.audience==="household"&&!scope.grant.sharedDomains.includes("analysis")))throw new DomainError("analysis_not_authorized",{httpStatus:403});
      await this.assertBusinessReady(await this.getTaskContext(context),applicationTool);
      const admission=this.effects.begin(scope.principal,nativeName,String(input.operationId),input);
      if("replayed" in admission)return {operation:{operationId:input.operationId,resultRecorded:true,replayed:true},result:{state:"previous_result_recorded",refresh:"read_scoped_artifacts_or_exact_native_child"}};
      try{const result=await this.tasks.execute(nativeName,input,context,signal);this.effects.commit(admission.id,admission.token,result);return {operation:{operationId:input.operationId,resultRecorded:true,replayed:false},result};}
      catch(error){this.effects.fail(admission.id,admission.token,domainErrorCode(error),errorOutcome(error));throw error;}
    }
    const descriptor=domainCatalog.find(tool=>tool.nativeName===nativeName);
    if(!descriptor)throw new DomainError("domain_tool_unavailable",{httpStatus:404});
    if(!args || typeof args!=="object" || Array.isArray(args) || Buffer.byteLength(JSON.stringify(args))>512*1024 || !this.validators.get(nativeName)!(args))
      throw new DomainError("domain_tool_arguments_invalid");
    const rawInput=args as Json,{outcomeId,...businessInput}=rawInput;
    const scope=await this.scope(context,signal);
    const input=descriptor.effect==="write"?{...businessInput,operationId:nativeOperationId(scope.principal.sourcePromptId,descriptor,businessInput)}:rawInput;this.assertScheduledTool(scope,nativeName);
    if(scope.mode==="diagnostic"&&! ["diagnostics","effects"].includes(descriptor.domain))throw new DomainError("diagnostic_read_only_boundary",{httpStatus:403});
    if(descriptor.domain!=="effects"&&!scope.grant.domains.includes(descriptor.domain))throw new DomainError("domain_not_authorized",{httpStatus:403});
    if(scope.principal.audience==="household"&&descriptor.domain!=="effects"&&!scope.grant.sharedDomains.includes(descriptor.domain))throw new DomainError("domain_private_conversation_required",{httpStatus:403});
    if(descriptor.effect==="write"&&!["memory","documents"].includes(descriptor.domain)&&!(scope.packet as any)?.independentTopicOf&&(!scope.rootGoalId||scope.principal.taskId!==scope.rootGoalId)){
      const binding=await this.getTaskContext(context),native=await this.adapter.getContext(scope.conversation);scope.principal.assertCurrent();
      if(binding.task.source.human!==true||context.sessionId!==binding.task.native.sessionId||native.goal&&native.goal.status!=="complete")throw new DomainError("active_native_goal_required",{httpStatus:409});
    }
    if(descriptor.domain==="diagnostics"&&!this.database.getProfile(scope.principal.profileId)?.capabilities.includes("viewDiagnostics"))
      throw new DomainError("diagnostic_operator_required",{httpStatus:403});
    if(descriptor.name==="diagnostics.system_status")this.assertSystemStatusCurrent(scope);
    await this.assertBusinessReady(await this.getTaskContext(context),descriptor);
    if(descriptor.effect==="read")return this.dispatch(descriptor,input,scope,context);
    const admission=this.effects.begin(scope.principal,descriptor.nativeName,String(input.operationId),input,{resumable:["household_memory_source_forget","household_memory_source_supersede","household_memory_remember"].includes(nativeName)});
    if("replayed" in admission)return {operation:{operationId:input.operationId,resultRecorded:true,replayed:true},
      taskEvidence:await this.associateCommitted(context,String(input.operationId),typeof outcomeId==="string"?outcomeId:undefined),
      result:{state:"previous_result_recorded",refresh:"read_current_domain_state_or_domain_operation_status"}};
    try{
      const result=await this.dispatch(descriptor,input,scope,context);
      this.effects.commit(admission.id,admission.token,result);
      const taskEvidence=await this.associateCommitted(context,String(input.operationId),typeof outcomeId==="string"?outcomeId:undefined);
      return {operation:{operationId:input.operationId,resultRecorded:true,replayed:false},taskEvidence,result};
    }catch(error){
      const code=domainErrorCode(error);this.effects.fail(admission.id,admission.token,code,errorOutcome(error));throw error;
    }
  }
  private async dispatch(tool:CatalogTool,args:Json,scope:RuntimeAuthorizedScope,context:BoundNativeToolContext):Promise<unknown>{
    const principal=scope.principal;
    const allowedArtifactIds=await this.artifactGrants(scope,args);
    const contactPrincipal:ContactPrincipal={...principal,allowedArtifactIds};
    const documentPrincipal:DocumentPrincipal={...principal,allowedArtifactIds,canProcessDocuments:scope.grant.domains.includes("documents")||scope.grant.domains.includes("receipts")};
    let user:Promise<{id:string;text:string;sha256:string}>|undefined;
    const userInput=()=>user??=this.userInput(scope);
    if(tool.domain==="contacts"){
      if(["contacts.revise","contacts.change_audience"].includes(tool.name)){
        if(scope.packet?.origin?.kind === "scheduled")throw new DomainError("fresh_human_response_required",{httpStatus:403});
        await userInput();
        const contact=this.contacts.get(contactPrincipal,String(args.contactId));
        if(Date.parse(contact.createdAt)>=Date.parse(principal.sourcePromptCreatedAt))throw new DomainError("later_human_response_required",{httpStatus:403});
        const effectiveRevision=Number(args.expectedRevision??contact.currentRevision);
        await this.assertFocus(scope,"contact",String(args.contactId),effectiveRevision);
        contactPrincipal.userPromptBinding={promptId:principal.sourcePromptId,conversationId:principal.conversationId,taskId:principal.taskId,
          targetContactId:String(args.contactId),expectedRevision:effectiveRevision,allowedActions:[tool.name==="contacts.change_audience"?"change_audience":args.reason==="ocr_redo"?"ocr_redo":"revise"]};
      }
      return this.contactTools.execute(tool.name,args,contactPrincipal);
    }
    if(tool.domain==="display"){
      const binding=await this.getTaskContext(context);
      if(scope.mode==="diagnostic"||scope.packet?.origin?.kind==="scheduled"||binding.task.source.human!==true)throw new DomainError("fresh_display_publication_authorization_required",{httpStatus:403});
      await userInput();
      await this.assertFocus(scope,"artifact",String(args.artifactId));
      const artifact=await this.artifacts.get(String(args.artifactId),{profileId:principal.profileId,canReadHousehold:principal.canReadHousehold}),now=Date.now();
      principal.assertCurrent();
      return this.display.publish({profileId:principal.profileId,role:this.database.getProfile(principal.profileId)!.role,conversationId:principal.conversationId,taskId:principal.taskId,sourcePromptId:principal.sourcePromptId,sourcePromptCreatedAt:principal.sourcePromptCreatedAt,taskMode:"standard",canPublishHousehold:principal.canWriteHousehold,assertCurrent:principal.assertCurrent},args as any,
        {purpose:"display_publish",sourcePromptId:principal.sourcePromptId,artifactId:artifact.id,artifactSha256:artifact.sha256,contentClass:"household_output",artifactConversationId:artifact.conversationId,artifactTaskId:artifact.taskId,issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+60_000).toISOString(),publicationExpiresAt:new Date(now+24*60*60*1000).toISOString()});
    }
    if(tool.domain==="documents")return this.documentTools.execute(tool.name,args,documentPrincipal);
    if(tool.domain==="receipts"){
      const binding=await this.reviewBinding(scope,context,args);
      if(["receipts.record_user_statement","receipts.review_respond"].includes(tool.name)&&scope.packet?.origin?.kind==="scheduled")throw new DomainError("fresh_human_response_required",{httpStatus:403});
      return this.receipts.execute(tool.name,args,scope,documentPrincipal,userInput,binding);
    }
    if(tool.domain==="effects")return {operation:this.effects.inspect(principal,String(args.operationId))};
    if(tool.domain==="diagnostics"){
      if(tool.name==="diagnostics.system_status")return readSystemStatus(this.systemStatus,{signal:principal.signal,assertCurrent:()=>this.assertSystemStatusCurrent(scope)});
      if(scope.mode!=="diagnostic")throw new DomainError("explicit_diagnostic_task_required",{httpStatus:403});
      return readTaskDiagnosticEvidence({database:this.database,artifacts:this.artifacts,native:this.adapter,profileId:principal.profileId,
        currentConversationId:principal.conversationId,currentSubmissionId:principal.sourcePromptId,currentSessionId:context.sessionId??null,currentGoalId:scope.rootGoalId??null,
        targetSubmissionId:typeof args.targetSubmissionId==="string"?args.targetSubmissionId:undefined,targetRunId:typeof args.targetRunId==="string"?args.targetRunId:undefined,
        assertCurrent:principal.assertCurrent,versions:{household:HOUSEHOLD_VERSION,openclaw:"2026.9.8"}});
    }
    const ownerAutonomy=context.agentId==='main'&&workshopAuthorized(this.config.execution.workshop?.ownerProfileId,this.database.getProfile(principal.profileId),scope);
    const native:NativeDomainContext={profileId:principal.profileId,agentId:principal.agentId,sessionKey:principal.sessionKey,conversationId:principal.conversationId,
      credentialAuthority:scope.credentialAuthority,ownerAutonomy,
      audience:principal.audience,allowedScopes:scope.grant.scopes,authorizedAttendees:[...scope.grant.allowedAttendees],signal:principal.signal,assertCurrent:principal.assertCurrent};
    const notification=this.config.execution.notificationTargets?.[principal.profileId];
    if(notification)native.notificationTarget=notification;
    if(scope.packet?.origin?.kind==="discord"){
      const origin=scope.packet.origin,route=this.config.execution.nativeEntries.find(rule=>rule.profileId===principal.profileId&&rule.externalUserId===origin.externalUserId&&rule.channelId===origin.channelId&&rule.audience===(origin.shared?"household":"private"));
      if(route)native.deliveryTarget={channel:"discord",to:"channel:"+route.channelId,audience:route.audience};
    }else if(notification)native.deliveryTarget=notification;
    const taskBinding=await this.getTaskContext(context),snapshot=await this.tasks.snapshot(taskBinding);
    const approval=snapshot.replyQuestion?.approval;
    native.destructiveApproved=ownerAutonomy || snapshot.currentReply?.decision==="approve" && snapshot.currentReply.sourcePromptId===taskBinding.task.source.id &&
      approval?.toolName===tool.nativeName&&approval?.operationId===args.operationId&&approval?.resourceId===(args.eventId??args.jobId??args.id??args.sourceId??args.contactId);
    if(tool.domain==="calendar" && (Array.isArray(args.attendees)||args.notifyAttendees===true)){
      const source=await userInput();
      const namedEmails=source.text.match(/[^\s@,;<>"'()]+@[^\s@,;<>"'()]+\.[A-Za-z]{2,}/g)??[];
      native.authorizedAttendees=[...new Set([...native.authorizedAttendees,...namedEmails.map(email=>email.toLowerCase())])];
    }
    if(["household_memory_source_save","household_memory_source_supersede","household_memory_remember","household_memory_save_recipe"].includes(tool.name) && scope.packet?.origin?.kind!=="scheduled"){
      const source=await userInput();native.confirmedSourceIds=[source.id];native.confirmedSourceText={[source.id]:source.text};
    }
    switch(tool.domain){
      case "lists":return this.lists.execute(tool.name,args,native);
      case "calendar":return this.google.execute(tool.name,args,native);
      case "email":{
        const workshop=context.agentId==='main'&&workshopAuthorized(this.config.execution.workshop?.ownerProfileId,this.database.getProfile(scope.principal.profileId),scope)?this.config.execution.workshop:undefined;
        const prepared=await emailAttachments({args,artifacts:this.artifacts,scope:{ownerProfileId:principal.profileId,conversationId:principal.conversationId,taskId:principal.taskId,audience:principal.audience},principal,workshop,allowedArtifactIds,assertCurrent:principal.assertCurrent});
        const value=await this.google.execute(tool.name,prepared,native);
        return deliverEmailResult({value,input:args,artifacts:this.artifacts,
          scope:{ownerProfileId:scope.principal.profileId,conversationId:scope.conversation.id,taskId:'conversation:'+scope.conversation.id,audience:scope.principal.audience},
          principal:{profileId:scope.principal.profileId,canReadHousehold:scope.principal.canReadHousehold},workshop,assertCurrent:scope.principal.assertCurrent});
      }
      case "memory":return this.memory.execute(tool.name,args,native);
      case "schedule":return this.schedule.execute(tool.name,args,native);
      default:throw new DomainError("domain_tool_unavailable",{httpStatus:404});
    }
  }
  private async associateCommitted(context:BoundNativeToolContext,operationId:string,outcomeId?:string){
    try{return await this.tasks.associateEffect(context,operationId,outcomeId);}
    catch(error){return {state:"association_required",operationCommitted:true,operationId,errorCode:domainErrorCode(error)};}
  }
  private async completionCanSettle(binding:any):Promise<boolean>{
    const task=binding.task as TaskFlowContext,scope=this.taskScopes.get(task);if(!scope||!task.native.goalId)throw new DomainError("task_authority_invalid");
    scope.principal.assertCurrent();const observed=await this.adapter.getContext(scope.conversation);scope.principal.assertCurrent();
    if(observed.sessionId!==task.native.sessionId||observed.goal?.id!==task.native.goalId)throw new DomainError("task_completion_binding_changed");
    return observed.continuationPending!==true;
  }
  private async completionCandidates(binding:any):Promise<TaskEvidenceRef[]>{
    const task=binding.task as TaskFlowContext,scope=this.taskScopes.get(task);if(!scope||!task.native.goalId||scope.principal.taskId!==task.native.goalId)throw new DomainError("task_authority_invalid");
    scope.principal.assertCurrent();
    const sources=this.database.domainConnection().prepare("SELECT id FROM submissions WHERE conversation_id=? AND goal_id=? AND json_extract(task_context_json,'$.independentTopicOf') IS NULL").all(scope.conversation.id,task.native.goalId) as Json[];
    const rows=this.database.domainConnection().prepare("SELECT operation_id,tool_name FROM domain_effects WHERE profile_id=? AND conversation_id=? AND state='committed' AND source_prompt_id IN (SELECT value FROM json_each(?)) ORDER BY created_at LIMIT 80")
      .all(scope.principal.profileId,scope.conversation.id,JSON.stringify(sources.map(row=>String(row.id)))) as Json[];
    const result:TaskEvidenceRef[]=rows.filter(row=>domainCatalog.some(tool=>tool.nativeName===row.tool_name)).map(row=>({kind:"operation",id:String(row.operation_id)}));
    const artifacts=await this.artifacts.list({profileId:scope.principal.profileId,canReadHousehold:scope.principal.canReadHousehold},{conversationId:scope.conversation.id,taskId:task.native.goalId,limit:20});
    scope.principal.assertCurrent();for(const item of artifacts.items)if(item.kind==="output"&&item.audience===task.scope.audience)result.push({kind:"artifact",id:item.id});
    return result;
  }
  private async completeTask(binding:any,summary:string):Promise<{goalId:string;status:"complete";operationId:string}>{
    const task=binding.task as TaskFlowContext,scope=this.taskScopes.get(task);
    if(!scope||(scope.packet as any)?.independentTopicOf||binding.execution.sessionId!==task.native.sessionId||!task.native.goalId||!await this.tasks.flow.canComplete(task))throw new DomainError("task_completion_unverified");
    scope.principal.assertCurrent();const observed=await this.adapter.getContext(scope.conversation);scope.principal.assertCurrent();
    if(observed.sessionId!==task.native.sessionId||observed.goal?.id!==task.native.goalId||observed.continuationPending===true||!["active","complete"].includes(observed.goal.status)||observed.goal.status==="active"&&observed.runId&&observed.runId!==binding.execution.runId)throw new DomainError("task_completion_binding_changed");
    const operationId="task-complete:"+fingerprint([scope.principal.sourcePromptId,task.native.sessionId,task.native.goalId]).slice(0,64);
    const request={kind:"verified_task_completion",sourceId:scope.principal.sourcePromptId,goalId:task.native.goalId,sessionId:task.native.sessionId};
    if(observed.goal.status==="complete"){
      const prior=this.admission.authority.control(operationId,scope.conversation.id,request);
      if(!prior)throw new DomainError("task_completion_binding_changed");
      this.admission.authority.finishControl(operationId,scope.conversation.id,request,{...(prior as object),phase:"complete",reconciled:true});
      return {goalId:task.native.goalId,status:"complete",operationId};
    }
    const control=this.admission.authority.prepareControl(operationId,scope.conversation.id,request);
    const snapshot=await this.tasks.flow.snapshot(task);scope.principal.assertCurrent();
    if(snapshot.handoff&&typeof this.adapter.putProgress==="function")await this.adapter.putProgress(scope.conversation,projectNativeProgressPlan(snapshot.handoff),scope.principal.assertCurrent);
    if(!await this.tasks.flow.canComplete(task))throw new DomainError("task_completion_unverified");
    const result=await this.adapter.mutateGoal(scope.conversation,{goalId:task.native.goalId,operationId,issuedAtMs:control.issuedAtMs,action:"complete",note:summary.slice(0,2000)},scope.principal.assertCurrent,task.native.sessionId);
    if(result.status!=="complete"||result.goalId!==task.native.goalId)throw new DomainError("task_completion_outcome_unknown",{outcome:"unknown"});
    this.admission.authority.finishControl(operationId,scope.conversation.id,request,{...control,phase:"complete",native:result});
    return {goalId:task.native.goalId,status:"complete",operationId};
  }
  private async stopTask(binding:any,input:{operationId:string;note?:string}){
    const task=binding.task as TaskFlowContext,scope=this.taskScopes.get(task),profile=scope&&this.database.getProfile(scope.principal.profileId);
    if(!scope||!profile||task.source.human!==true||scope.packet?.sourceReferenceId||scope.packet?.origin?.kind==="scheduled"||!task.native.goalId||
      (scope.conversation.ownerProfileId!==profile.id&&profile.role!=="admin"))throw new DomainError("task_stop_not_authorized",{httpStatus:403});
    scope.principal.assertCurrent();const request={kind:"task_stop",goalId:task.native.goalId,sourceId:scope.principal.sourcePromptId,note:input.note??null};
    const previous=this.admission.authority.control(input.operationId,scope.conversation.id,request);if(previous)return previous as any;
    const issuedAtMs=Date.now(),native=await this.adapter.getContext(scope.conversation);scope.principal.assertCurrent();
    if(native.sessionId!==task.native.sessionId||native.goal?.id!==task.native.goalId||native.goal.status!=="active")throw new DomainError("control_target_conflict",{httpStatus:409});
    const result=await this.adapter.mutateGoal(scope.conversation,{goalId:task.native.goalId,operationId:input.operationId,issuedAtMs,action:"pause",note:input.note??"Stopped by the household user"},scope.principal.assertCurrent);
    if(result.status!=="paused")throw new DomainError("task_stop_outcome_unknown",{outcome:"unknown"});
    this.database.recordGoalControl(scope.conversation.id,issuedAtMs);
    const sourceId=this.admission.authority.get(binding.execution.sessionKey)?.sourceId??scope.principal.sourcePromptId;
    this.database.submissions.reconcile(sourceId,"cancelled",binding.execution.runId);
    const receipt={state:"paused" as const,goalId:task.native.goalId,operationId:input.operationId,taskComplete:false,effectsRolledBack:false};
    this.admission.authority.recordControl(input.operationId,scope.conversation.id,request,receipt);return receipt;
  }
  configureNativePolicyReader(reader:()=>unknown){this.nativePolicyReader=reader;}
  configureScheduledDeliveryPolicyReader(reader:()=>Promise<DomainConfiguration>){this.scheduledDeliveryPolicyReader=reader;}
  /** Initial preparation only. Native accepted/frozen queue batches retain their prior authorization. */
  async guardScheduledDelivery(event:Json,context:Json){
    const cancel=()=>({cancel:true,cancelReason:"household_notice_not_authorized"});
    const identity=scheduleDeliveryIdentity(context.sessionKey??event.sessionKey);if(!identity)return cancel();
    const current=()=>{if(this.closed)throw new DomainError("domain_runtime_stopping");(context as any).hookInvocation?.assertActive();};
    try{
      current();
      const result=object(await this.adapter.requestDomainCapability("cron.list",{agentId:identity.agentId,sessionKey:identity.sessionKey,sessionAgentId:identity.agentId,includeDisabled:true,limit:2,offset:0,includeDeliveryPreviews:false},current));
      const jobs=(Array.isArray(result.jobs)?result.jobs:[]).map(object).filter(job=>job.sessionKey===identity.sessionKey);
      if(jobs.length!==1)return cancel();
      const policy=this.scheduledDeliveryPolicyReader?await this.scheduledDeliveryPolicyReader():this.config;current();
      const native=object(this.nativePolicyReader?.());
      if(!this.nativePolicyReader||object(native.session).scope==="global")return cancel();
      const allowed=this.admission.authorizeScheduledNotice(jobs[0],event,context,{schedulingEnabled:policy.execution.schedulingEnabled,scheduledToolNames:scheduledCapabilities,profileGrants:policy.profiles,notificationTargets:policy.execution.notificationTargets,queuedNoticePolicy:policy.execution.queuedNoticePolicy},policy.execution.nativeEntries);
      current();return allowed?undefined:cancel();
    }catch{return cancel();}
  }

  nativeApprovalRequest(binding:any,event:Json,context:Json){return this.nativeApprovals.request(binding,event,context);}
  async nativeApprovalResolved(_binding:any,event:Json,context:BoundNativeToolContext,decision:string){
    const binding=await this.getTaskContext({...context,runId:context.runId??String(event.runId??"")});
    if(binding.conversationOnly)throw new DomainError("native_approval_route_not_authorized");
    return this.nativeApprovals.resolved(binding,event,context,decision);
  }
  configureNativeTransport(spawn:(context:AnalysisFlowContext,request:NativeAnalysisRequest)=>Promise<any>){this.nativeSpawn=spawn;}
  runAdmission(context:BoundNativeToolContext){
    if(!context.agentId||!context.sessionKey)throw new DomainError("trusted_native_context_required");
    const conversation=this.authorization.root(context);if(!conversation)throw new DomainError("native_conversation_not_authorized");
    const key=context.sessionKey.replace(`agent:${context.agentId}:hardy-home:`,"hardy-home:"),grant=this.admission.authority.get(key);
    const active=this.database.submissions.listForConversation(conversation.id).filter(s=>["dispatching","running"].includes(s.receipt.status)&&!s.recoveryRequired);
    const source=grant?this.database.submissions.get(grant.sourceId):active.length===1?active[0]:null;
    if(!source)throw new DomainError("admitted_household_request_required");
    const current=()=>{
      if(this.closed)throw new DomainError("domain_runtime_stopping");
      const profile=this.database.getProfile(source.receipt.profileId),latest=this.database.submissions.get(source.receipt.submissionId),device=source.originDeviceId?this.database.getDevice(source.originDeviceId):null;
      if(!profile?.capabilities.includes("chat")||!latest||!["running","dispatching"].includes(latest.receipt.status)||latest.recoveryRequired||
        (source.originDeviceId?(!device||device.status!=="active"||device.deviceKind!=="personal"||device.profileId!==profile.id):(!source.taskContext||!this.admission.externalCurrent(source.taskContext,profile.id))))throw new DomainError("domain_authority_revoked");
    };current();return {assertCurrent:current};
  }
  isManagedAgent(agentId:unknown){return this.admission.isManagedAgent(agentId);}
  admitNativeTurn(_event:Json,context:Json,observation:NativeObservation){
    const current=()=>{if(this.closed)throw new DomainError("domain_runtime_stopping");(context as any).hookInvocation?.assertActive();(context as any).toolAuthority?.assertActive();};
    current();return this.admission.admit({...observation,assertCurrent:current});
  }
  async observeNativeDiagnostic(observation:any,_context:Json){
    if(!observation||typeof observation.sessionKey!=="string"||typeof observation.agentId!=="string")return;
    const key=normalizedSessionKey(observation.agentId,observation.sessionKey),grant=this.admission.authority.get(key);
    const source=grant&&this.database.submissions.get(grant.sourceId);
    const sameSession=grant&&(grant.sessionId===observation.sessionId||grant.parentSessionKey&&grant.sessionId===null||observation.kind==="after_compaction"&&observation.previousSessionId===grant.sessionId);
    if(!grant||!source||!sameSession||grant.agentId!==observation.agentId||grant.runId!==observation.runId||!this.config.profiles[source.receipt.profileId]?.enabled)return;
    const expected=fingerprint(grant),current=()=>{
      if(this.closed||fingerprint(this.admission.authority.get(key))!==expected)throw new DomainError("diagnostic_native_observation_stale");
      const latest=this.database.submissions.get(grant.sourceId),profile=this.database.getProfile(source.receipt.profileId);
      if(!latest||!["running","dispatching"].includes(latest.receipt.status)||latest.recoveryRequired||!profile?.capabilities.includes("chat")||["paused","offline"].includes(profile.status))throw new DomainError("diagnostic_native_observation_stale");
      const device=latest.originDeviceId&&this.database.getDevice(latest.originDeviceId);
      if(latest.originDeviceId?(!device||device.status!=="active"):(!latest.taskContext||!this.admission.externalCurrent(latest.taskContext,profile.id)))throw new DomainError("diagnostic_native_observation_stale");
      if(this.database.getSubmissionDomainBinding(grant.sourceId)?.controlWatermark!==this.database.getGoalControlIssuedAt(source.receipt.conversationId))throw new DomainError("diagnostic_native_observation_stale");
    };
    current();return captureNativeDiagnosticEvent({artifacts:this.artifacts,scope:{ownerProfileId:source.receipt.profileId,conversationId:source.receipt.conversationId},sourceId:grant.sourceId,observation,assertCurrent:current});
  }
  observeNativeInbound(event:Json,context:Json){return this.admission.inbound(event,context);}
  registerNativeChild(event:Json,context:Json){return this.admission.child(event,context);}
  bootstrapAccess(event:Json){const ctx=object(event.context);return this.admission.bootstrap(String(ctx.agentId??""),String(ctx.sessionKey??event.sessionKey??""));}
  private assertScheduledTool(scope:AuthorizedScope,name:string){if(scope.packet?.origin?.kind==="scheduled"&&!scope.packet.scheduledTools?.includes(name))throw new DomainError("scheduled_tool_not_authorized",{httpStatus:403});}
  private assertSystemStatusCurrent(scope:AuthorizedScope){scope.principal.assertCurrent();assertSystemStatusAuthority({profile:this.database.getProfile(scope.principal.profileId),audience:scope.principal.audience,grant:this.config.profiles[scope.principal.profileId]});}
  private catalogForScope(scope:AuthorizedScope){return domainCatalog.filter(tool=>(tool.name!=="diagnostics.system_status"||systemStatusAuthorized({profile:this.database.getProfile(scope.principal.profileId),audience:scope.principal.audience,grant:this.config.profiles[scope.principal.profileId]}))&&(scope.packet?.origin?.kind!=="scheduled"||scope.packet.scheduledTools?.includes(tool.nativeName))&&(tool.domain==="effects"||scope.grant.domains.includes(tool.domain))&&
    (scope.principal.audience!=="household"||tool.domain==="effects"||scope.grant.sharedDomains.includes(tool.domain)));}
  private async loadTaskCatalog(task:TaskFlowContext){
    const scope=this.taskScopes.get(task);if(!scope)throw new DomainError("task_authority_invalid");scope.principal.assertCurrent();
    const application=this.tasks.catalog().filter(tool=>tool.domain!=="task"&&tool.name!=="analysis.publish_output"&&
      (scope.packet?.origin?.kind!=="scheduled"||scope.packet.scheduledTools?.includes(tool.nativeName))&&
      (scope.grant.domains.includes(tool.domain)&&(scope.principal.audience!=="household"||scope.grant.sharedDomains.includes(tool.domain))||
        tool.name==="analysis.publish_report"&&scope.mode==="diagnostic"&&this.database.getProfile(scope.principal.profileId)?.capabilities.includes("viewDiagnostics")));
    const tools=[...this.catalogForScope(scope),...application];
    const result=await this.contextLoader.load([...new Set(tools.map(tool=>tool.domain))].map(id=>({id,description:id+" household capability",tools:tools.filter(tool=>tool.domain===id).map(tool=>tool.nativeName)})));
    scope.principal.assertCurrent();return result;
  }
  private contractIdentity(binding:any):ExecutionGrant {
    const scope=this.taskScopes.get(binding.task);if(!scope)throw new DomainError("task_authority_invalid");scope.principal.assertCurrent();
    const execution=binding.execution,key=normalizedSessionKey(execution.agentId,execution.sessionKey),grant=this.admission.authority.get(key);
    const firstChild=grant?.parentSessionKey&&grant.sessionId===null&&typeof execution.sessionId==="string"&&execution.sessionId.length>0;
    if(!grant||grant.rootSessionKey!==scope.conversation.sessionKey||grant.agentId!==execution.agentId||grant.sessionId!==execution.sessionId&&!firstChild||
      grant.runId!==execution.runId||grant.goalId!==binding.task.native.goalId||grant.mode!==binding.task.mode)
      throw new DomainError("loaded_contract_required",{httpStatus:403});
    scope.principal.assertCurrent();return grant;
  }
  private async recordLoadedContracts(binding:any,contracts:readonly LoadedTaskContract[]){
    const identity=this.contractIdentity(binding),catalog=await this.loadTaskCatalog(binding.task);
    for(const contract of contracts){
      const domain=catalog.find(value=>value.id===contract.domainId);
      if(!domain||taskContractDigest(domain.instructions)!==contract.contractDigest)throw new DomainError("loaded_contract_required",{httpStatus:403});
      this.admission.authority.contracts.record(identity,contract,binding.task.assertCurrent);
    }
    binding.task.assertCurrent();
  }
  private async assertBusinessReady(binding:any,tool:CatalogTool){
    if(tool.domain==="task"||tool.domain==="effects"||tool.name==="analysis.publish_output")return;
    // Execution identity and current scope authorize the call. Guide text and
    // optional coordination metadata cannot grant or veto that authority.
    this.contractIdentity(binding);
    binding.task.assertCurrent();
  }

  private async userInput(scope:AuthorizedScope){
    const projected=await this.admission.source(scope.principal.sourcePromptId,scope.sourceHash);
    return projected?Promise.resolve(projected):this.authorization.userInput(scope,conversation=>this.adapter.listMessages(conversation));
  }
  async getTaskContext(context:BoundNativeToolContext):Promise<any>{
    const invocation=context.assertInvocationCurrent??(()=>{const value=context as any;value.hookInvocation?.assertActive();value.toolAuthority?.assertActive();if(this.closed)throw new DomainError("domain_runtime_stopping");});
    const bound={...context,assertInvocationCurrent:invocation};
    const candidate=this.authorization.root(bound),projection=context.agentId&&context.sessionKey?this.admission.authority.get(context.sessionKey.replace(`agent:${context.agentId}:hardy-home:`,"hardy-home:")):null;
    const actorSource=projection&&this.database.submissions.get(projection.sourceId);
    const candidateProfile=candidate&&this.database.getProfile(actorSource?.receipt.profileId??candidate.ownerProfileId);
    if(candidate&&candidateProfile&&(candidateProfile.role==="child"||!this.config.profiles[candidateProfile.id]?.enabled)){
      const pending=this.database.submissions.listForConversation(candidate.id).filter(s=>["running","dispatching"].includes(s.receipt.status)&&s.receipt.profileId===candidateProfile.id);
      const source=pending.length===1?pending[0]:null,device=source?.originDeviceId?this.database.getDevice(source.originDeviceId):null;
      if(!source||(source.originDeviceId?(!device||device.status!=="active"||device.deviceKind!=="personal"||device.profileId!==candidateProfile.id):(!source.taskContext||!this.admission.externalCurrent(source.taskContext,candidateProfile.id)))||!context.runId||!context.sessionId||!context.sessionKey||!context.agentId)throw new DomainError("admitted_household_request_required");
      const current=()=>{invocation();const latest=device?this.database.getDevice(device.id):null,profile=this.database.getProfile(candidateProfile.id);if((device&&(!latest||latest.status!=="active"))||profile?.agentId!==candidateProfile.agentId||!profile.capabilities.includes("chat"))throw new DomainError("domain_authority_revoked");};
      current();return {conversationOnly:true,assertCurrent:current,task:{assertCurrent:current},execution:{agentId:context.agentId,sessionId:context.sessionId,sessionKey:context.sessionKey,runId:context.runId}};
    }
    const scope=await this.scope(bound);
    const native=await this.adapter.getContext(scope.conversation),source=await this.userInput(scope);
    if(scope.principal.originDeviceId&&!scope.packet?.sourceArtifactId){scope.principal.assertCurrent();await this.admission.captureAppSource(scope.principal.sourcePromptId,source.text);scope.principal.assertCurrent();}
    if(!native.sessionId||!context.runId||!context.sessionKey||!context.agentId||!context.sessionId)throw new DomainError("trusted_native_context_required");
    const grant=this.admission.authority.get(context.sessionKey)??this.admission.authority.get(context.sessionKey.replace(`agent:${context.agentId}:`,""));
    const activeGoal=scope.rootGoalId&&(scope.principal.taskId===scope.rootGoalId||(scope.packet as any)?.independentTopicOf&&native.goal?.status==="active")&&native.goal?.id===scope.rootGoalId?native.goal:null;
    const previousOutcomes=await priorOutcomeContext(this.database,this.artifacts,scope,native.sessionId,source.id);
    const independentTopic=Boolean(scope.packet?.independentTopicOf),originalInputs:string[]=[];
    if(activeGoal&&!independentTopic){
      const rows=this.database.domainConnection().prepare("SELECT task_context_json FROM submissions WHERE conversation_id=? AND goal_id=? AND task_context_json IS NOT NULL AND json_extract(task_context_json,'$.independentTopicOf') IS NULL ORDER BY created_at LIMIT 100").all(scope.conversation.id,activeGoal.id) as Json[];
      for(const row of rows){const packet=object(JSON.parse(String(row.task_context_json)));
        for(const id of Array.isArray(packet.artifactIds)?packet.artifactIds:[]){
          if(typeof id!=="string"||originalInputs.includes(id)||originalInputs.length>=24)continue;
          try{const meta=await this.artifacts.get(id,{profileId:scope.principal.profileId,canReadHousehold:scope.principal.canReadHousehold});
            if(meta.conversationId===scope.conversation.id&&meta.audience===scope.principal.audience&&["input","output"].includes(meta.kind))originalInputs.push(id);
          }catch{/* Removed or currently inaccessible inputs grant nothing. */}
        }
      }
    }
    let independentSource:TaskFlowContext["independentSource"];
    const independentId=(scope.packet as any)?.independentSourcePromptId;
    if((scope.packet as any)?.independentTopicOf&&typeof independentId==="string"){
      const id=independentId.replace(/^user:/,""),original=this.database.submissions.get(id);
      if(!original||original.receipt.conversationId!==scope.conversation.id||original.receipt.profileId!==scope.principal.profileId&&scope.principal.audience!=="household")throw new DomainError("independent_source_not_authorized");
      const projected=await this.admission.source(id,original.textHash);
      const text=projected?.text??(original.payload?.kind==="message"?original.payload.text:null);
      if(typeof text!=="string"||fingerprintText(text)!==original.textHash)throw new DomainError("independent_source_unavailable");
      const ids:string[]=[];
      for(const artifactId of original.taskContext?.artifactIds??[]){
        const metadata=await this.artifacts.get(artifactId,{profileId:scope.principal.profileId,canReadHousehold:scope.principal.canReadHousehold});
        if(metadata.conversationId!==scope.conversation.id||metadata.audience!==scope.principal.audience)throw new DomainError("independent_source_not_authorized");
        ids.push(artifactId);
      }
      scope.principal.assertCurrent();independentSource={id:"user:"+id,text,sha256:original.textHash,artifactIds:ids};
    }
    const task:TaskFlowContext={...(independentSource?{independentSource}:{}),principal:{profileId:scope.principal.profileId,canReadHousehold:scope.principal.canReadHousehold},
      scope:{ownerProfileId:scope.conversation.ownerProfileId,conversationId:scope.conversation.id,taskId:activeGoal?.id??((scope.packet as any)?.independentTopicOf?String((scope.packet as any).independentTopicOf):scope.principal.taskId),audience:scope.principal.audience},
      native:{sessionId:native.sessionId,sessionKey:scope.conversation.sessionKey,goalId:activeGoal?.id??null,goalStatus:activeGoal?.status??null,objective:activeGoal?.objective??null,runId:context.runId},
      source:{...source,human:!scope.packet?.sourceReferenceId&&scope.packet?.origin?.kind!=="scheduled"&&(scope.packet?.origin?.kind!=="discord"||scope.packet.origin.confirmedHuman===true)},mode:scope.mode,previousOutcomes,artifactIds:[...new Set([...(scope.packet?.artifactIds??[]),...(independentSource?.artifactIds??[]),...originalInputs,...(!independentTopic&&!scope.packet?.sourceReferenceId&&scope.packet?.origin?.kind!=="scheduled"?previousOutcomes.artifactIds:[])])],assertCurrent:scope.principal.assertCurrent,
      ...(scope.conversation.ownerProfileId!==scope.principal.profileId?{contribution:{actorProfileId:scope.principal.profileId,canWrite:true as const}}:{})};
    if(grant?.parentSessionKey&&grant.mode==="diagnostic"&&task.mode!=="diagnostic")throw new DomainError("diagnostic_lineage_mismatch");
    if(grant?.parentSessionKey&&context.agentId==="main"&&workshopAuthorized(this.config.execution.workshop?.ownerProfileId,this.database.getProfile(scope.principal.profileId),scope))
      this.admission.authority.bindChildSessionId(normalizedSessionKey(context.agentId,context.sessionKey),context.agentId,context.sessionId,context.runId,scope.principal.assertCurrent);
    this.taskScopes.set(task,scope);
    return {task,execution:{agentId:context.agentId,sessionKey:context.sessionKey,sessionId:context.sessionId,runId:context.runId,
      workspaceDir:context.workspaceDir,sandboxed:context.sandboxed===true,toolCallId:(context as any).toolCallId}};
  }
  async taskPrompt(binding:any){if(binding.conversationOnly)return {toolsAllow:[],prependSystemContext:"You are the family conversation assistant for this authenticated person. This profile is conversation-only. Answer directly and ask follow-up questions naturally; do not claim to read private stores, execute tools, make changes or promise later actions."};return this.tasks.prompt(binding);}
  async taskFinalize(binding:any,event?:Json){
    if(binding.conversationOnly)return undefined;
    const scope=this.taskScopes.get(binding.task),configuration=this.config.execution.workshop;
    if(configuration&&binding.execution.agentId==="main"&&workshopAuthorized(configuration.ownerProfileId,scope&&this.database.getProfile(scope.principal.profileId),scope)){
      await captureWorkshopDeliverables({configuration,artifacts:this.artifacts,scope:binding.task.scope,principal:binding.task.principal,
        sourceId:binding.task.source.id,message:event?.lastAssistantMessage,assertCurrent:binding.task.assertCurrent});
    }
    return this.tasks.finalize(binding);
  }
  private async verifyWorkshopToolPolicy(binding:TaskApplicationBinding,policies:NativeExecutionPolicies,
    checkSandbox:(sessionKey:string,agentId:string)=>Promise<void>):Promise<boolean>{
    const scope=this.taskScopes.get(binding.task),{agentId,sessionKey,sessionId,runId}=binding.execution;
    const profile=scope&&this.database.getProfile(scope.principal.profileId);
    if(agentId!=="main"||!this.config.execution.workshop?.dataRoot||!workshopAuthorized(this.config.execution.workshop.ownerProfileId,profile,scope))return false;
    const authority=this.admission.authority,key=normalizedSessionKey(agentId,sessionKey),grant=authority.get(key);
    if(!grant||grant.rootSessionKey!==scope!.conversation.sessionKey||grant.sourceId!==scope!.principal.sourcePromptId||grant.agentId!==agentId||
      grant.runId!==runId||grant.sessionId!==null&&grant.sessionId!==sessionId)return false;
    const before=fingerprint(grant);
    try{await policies.assertReady(agentId);policies.assertProfile(agentId,this.nativePolicyReader?.());await checkSandbox(sessionKey,agentId);}catch{return false;}
    scope!.principal.assertCurrent();
    return before===fingerprint(authority.get(key));
  }
  private async verifyAnalysisToolPolicy(binding:TaskApplicationBinding,policies:NativeExecutionPolicies,
    checkSandbox:(sessionKey:string,agentId:string)=>Promise<void>):Promise<boolean>{
    const scope=this.taskScopes.get(binding.task),{agentId,sessionKey,sessionId,runId}=binding.execution;
    if(!scope||!isAnalysisAgent(agentId)||scope.mode==="diagnostic"||!scope.grant.domains.includes("analysis")||
      scope.principal.audience==="household"&&!scope.grant.sharedDomains.includes("analysis"))return false;
    const authority=this.admission.authority,key=normalizedSessionKey(agentId,sessionKey),grant=authority.get(key);
    const parent=grant?.parentSessionKey?authority.get(grant.parentSessionKey):null;
    if(!grant||!parent||grant.rootSessionKey!==scope.conversation.sessionKey||grant.agentId!==agentId||grant.runId!==runId||
      grant.sessionId!==null&&grant.sessionId!==sessionId||parent.rootSessionKey!==grant.rootSessionKey||
      parent.sourceId!==grant.sourceId||parent.goalId!==grant.goalId||parent.mode!==grant.mode)return false;
    const originalGrant=fingerprint(grant),pinnedGrant=fingerprint({...grant,sessionId}),originalParent=fingerprint(parent);
    const current=()=>{
      scope.principal.assertCurrent();
      const child=fingerprint(authority.get(key));
      return (child===originalGrant||child===pinnedGrant)&&fingerprint(authority.get(parent.sessionKey))===originalParent;
    };
    if(!current())return false;
    try{
      // OpenClaw builds these primitives from the sandbox backend for this
      // session. The hook itself carries no factory sandbox or workspace facts.
      await policies.assertReady(agentId);
      policies.assertProfile(agentId,this.nativePolicyReader?.());
      await checkSandbox(sessionKey,agentId);
    }catch{return false;}
    if(!current())return false;
    authority.bindChildSessionId(key,agentId,sessionId,runId,scope.principal.assertCurrent);
    return true;
  }
  async taskGuard(binding:any,event:Json,context:Json){
    const scope=this.taskScopes.get(binding.task);if(scope)this.assertScheduledTool(scope,String(event.toolName));
    if(binding.conversationOnly)return {allow:false,reason:"This profile is conversation-only."};
    if(event.toolName==="sessions_spawn"&&!workshopAuthorized(this.config.execution.workshop?.dataRoot?this.config.execution.workshop.ownerProfileId:undefined,scope&&this.database.getProfile(scope.principal.profileId),scope)&&(!binding.task.native.goalId||binding.task.native.goalStatus!=="active"))return {allow:false,reason:"Generic phase children require an already-bound formal goal. For this ordinary source use household_analysis_start and household_analysis_result; inspect a rejected helper or uncertain effect rather than replacing it with raw sessions_spawn or create_goal."};
    const decision=await this.tasks.guard(binding,event as any,context);
    if(decision.allow){
      const tool=[...domainCatalog,...this.tasks.catalog()].find(value=>value.nativeName===event.toolName);
      if(tool)try{await this.assertBusinessReady(binding,tool);}catch(error){
        if(domainErrorCode(error)==="domain_not_authorized")return {allow:false,reason:"This business capability is unavailable under the current source and audience grants."};
        throw error;
      }
    }
    if(decision.allow&&event.toolName==="create_goal")await this.retireCompletedGoal(binding);
    return decision;
  }
  private async retireCompletedGoal(binding:any){
    const scope=this.taskScopes.get(binding.task);if(!scope)throw new DomainError("task_authority_invalid");
    const native=await this.adapter.getContext(scope.conversation);scope.principal.assertCurrent();
    if(native.sessionId!==binding.task.native.sessionId)throw new DomainError("checkpoint_native_binding_changed");
    if(!native.goal)return;
    if(native.goal.status!=="complete")throw new DomainError("new_task_requires_new_conversation",{httpStatus:409});
    const operationId="completed-goal-clear:"+fingerprint([scope.principal.sourcePromptId,native.goal.id]).slice(0,64),request={kind:"completed_goal_retirement",goalId:native.goal.id,sourceId:scope.principal.sourcePromptId};
    const control=this.admission.authority.prepareControl(operationId,scope.conversation.id,request);
    await this.adapter.mutateGoal(scope.conversation,{goalId:native.goal.id,operationId,issuedAtMs:control.issuedAtMs,action:"clear"},scope.principal.assertCurrent);
    const current=await this.adapter.getContext(scope.conversation);scope.principal.assertCurrent();
    if(current.sessionId!==native.sessionId||current.goal)throw new DomainError("completed_goal_retirement_unknown",{outcome:"unknown"});
    this.admission.authority.finishControl(operationId,scope.conversation.id,request,{...control,phase:"complete",retainedCheckpointHistory:true});
  }
  async resolveSourceSettlement(input:SourceSettlementInput){
    const current=()=>{input.assertCurrent();if(this.closed)throw new DomainError("domain_runtime_stopping");};current();
    const source=this.database.submissions.get(input.sourceId),conversation=this.database.getConversation(input.conversationId);
    const profile=source&&this.database.getProfile(source.receipt.profileId);
    if(!source||!conversation||!profile?.capabilities.includes("chat")||source.receipt.conversationId!==conversation.id||
      conversation.audience==="private"&&source.receipt.profileId!==conversation.ownerProfileId)throw new DomainError("source_question_binding_invalid");
    const grant=this.config?.profiles?.[profile.id],canReadHousehold=Boolean(grant?.enabled&&grant.scopes.includes("household"));
    return readSourceQuestionSettlement({database:this.database,artifacts:this.artifacts,input:{...input,assertCurrent:current},canReadHousehold,
      childPending:async(sourceId)=>{
        const rows=this.database.domainConnection().prepare("SELECT native_session_key,agent_id,native_run_id FROM native_execution_grants WHERE root_submission_id=? AND parent_session_key IS NOT NULL").all(sourceId) as Json[];
        for(const row of rows){
          current();if(typeof row.native_run_id!=="string")return true;
          const child={...conversation,sessionKey:String(row.native_session_key),agentId:String(row.agent_id)};
          const state=this.adapter.getExactRunState?await this.adapter.getExactRunState(child,row.native_run_id):await this.adapter.getRunState(child,row.native_run_id);
          current();if(state.runId&&state.runId!==row.native_run_id||!["complete","failed","cancelled"].includes(state.status)||state.continuationPending)return true;
        }
        return false;
      }});
  }
  async nativeEnd(event:Json,context:BoundNativeToolContext){
    const conversation=this.authorization.root(context);if(!conversation||!context.agentId||!context.sessionKey)return;
    const native=await this.adapter.getContext(conversation);
    const projection=this.admission.authority.get(normalizedSessionKey(context.agentId,context.sessionKey));
    const source=projection&&this.database.submissions.get(projection.sourceId);
    if(!projection||projection.parentSessionKey||projection.agentId!==context.agentId||projection.rootSessionKey!==conversation.sessionKey||
      projection.runId!==context.runId||projection.sessionId!==context.sessionId||!source||!["running","dispatching"].includes(source.receipt.status))return;
    const independent=Boolean(source.taskContext?.independentTopicOf);
    if(!independent&&(native.continuationPending||source.receipt.goalId))return;
    let scope:AuthorizedScope;
    try{scope=this.authorization.resolve({...context,nativeRunId:native.runId,nativeGoalId:native.goal?.id??null,nativeGoalStatus:native.goal?.status??null,nativeSessionId:native.sessionId,
      assertInvocationCurrent:()=>{if(this.closed)throw new DomainError("domain_runtime_stopping");context.assertInvocationCurrent?.();}});scope.principal.assertCurrent();}
    catch{return;} // A stale terminal callback cannot mutate another current source.
    if(!independent&&native.goal&&native.goal.status!=="complete"){
      if(native.goal.status==="active"&&native.runId===context.runId&&native.sessionId===context.sessionId&&projection.goalId===native.goal.id){
        scope.principal.assertCurrent();
        this.database.domainConnection().prepare("UPDATE submissions SET goal_id=?,domain_goal_bound=1 WHERE id=? AND goal_id IS NULL AND status IN('running','dispatching')")
          .run(native.goal.id,source.receipt.submissionId);
      }else{
        scope.principal.assertCurrent();
        this.database.submissions.failWithCode(source.receipt.submissionId,source.receipt.runId,"native_goal_binding_missing");
      }
      return;
    }
    if(independent&&native.runId&&native.runId!==context.runId)return;
    if(!source.taskContext?.origin){
      // Signed app receipts belong to the delivery owner, which publishes their
      // receipt/profile projections. This native call remains a harmless no-op.
      this.admission.settle(context.sessionKey,context.agentId,event.error?"failed":"complete",false,context.runId);return;
    }
    try{
      const settlement=await this.resolveSourceSettlement({sourceId:source.receipt.submissionId,conversationId:conversation.id,sessionId:context.sessionId!,goalId:null,assertCurrent:scope.principal.assertCurrent});
      scope.principal.assertCurrent();if(settlement.continuationPending)return;
      const sql=this.database.domainConnection();sql.exec("BEGIN IMMEDIATE");
      try{
        scope.principal.assertCurrent();
        if(!event.error)settleResolvedWaitingSources(this.database,settlement);
        this.admission.settle(context.sessionKey,context.agentId,event.error?"failed":"complete",!event.error&&settlement.waiting,context.runId);
        sql.exec("COMMIT");
      }catch(error){sql.exec("ROLLBACK");throw error;}
    }catch{/* Missing/stale question evidence cannot claim completion; maintenance may reconcile later. */}
  }
  private async validateQuestion(task:TaskFlowContext,question:TaskQuestion):Promise<TaskQuestion>{
    const scope=this.taskScopes.get(task);if(!scope)throw new DomainError("task_authority_invalid");scope.principal.assertCurrent();
    if(question.focus){await this.assertFocus(scope,question.focus.kind,question.focus.id,question.focus.revision);}
    if(question.questionType==="approval"){
      const approval=question.approval,allowed=new Set(["household_calendar_delete","household_schedule_remove","household_lists_remove","household_memory_source_forget","household_contacts_change_audience","household_display_publish","household_receipts_record_user_statement"]);
      if(!approval||!allowed.has(approval.toolName)||!question.focus||question.focus.id!==approval.resourceId)throw new DomainError("approval_target_invalid");
      if(approval.waivedReasons?.length&&(question.focus.kind!=="receipt"||!scope.grant.canReviewReceipts))throw new DomainError("receipt_exception_not_authorized");
    }
    if(question.questionType==="receipt_review"&&question.focus?.kind!=="receipt")throw new DomainError("receipt_review_target_required");
    if(question.questionType==="approval"){
      const tool=question.approval!.toolName,focus=question.focus!;let target=focus.id;
      if(focus.kind==="contact"){const value=this.contacts.get({...scope.principal,allowedArtifactIds:[]},focus.id);target=value.fields.full_name?.[0]??"selected contact";}
      if(focus.kind==="artifact"){const value=await this.artifacts.get(focus.id,{profileId:scope.principal.profileId,canReadHousehold:scope.principal.canReadHousehold});target=value.filename+" ("+value.mimeType+")";}
      if(focus.kind==="receipt")target="receipt revision "+String(focus.revision??"current")+" - "+focus.id.slice(-12);
      const labels:Record<string,string>={household_calendar_delete:"Delete household calendar event",household_schedule_remove:"Delete scheduled task",household_lists_remove:"Remove list item",household_memory_source_forget:"Forget captured memory source and dependent managed topics",household_contacts_change_audience:"Change contact visibility",household_display_publish:"Publish on the shared kitchen display",household_receipts_record_user_statement:"Approve receipt exceptions"};
      const waivers=question.approval!.waivedReasons?.length?" Exceptions: "+question.approval!.waivedReasons.map(v=>v.replaceAll("_"," ")).join(", ")+".":"";
      question={...question,text:(labels[tool]??"Approve exact operation")+": "+target+"."+waivers+"\n\n"+question.text};
      if(question.text.length>4000)question.text=question.text.slice(0,4000);
    }
    return question;
  }
  private async validateReply(task:TaskFlowContext,question:TaskQuestion,reply:TaskReply){
    const scope=this.taskScopes.get(task);if(!scope||scope.packet?.origin?.kind==="scheduled"||question.sourcePromptId===task.source.id)throw new DomainError("fresh_human_response_required");
    if(scope.packet?.replyToQuestionId&&scope.packet.replyToQuestionId!==reply.questionArtifactId){
      const snapshot=await this.tasks.flow.snapshot(task);
      const returning=reply.relation==="steer"&&!reply.decision&&task.source.human===true&&snapshot.suspendedQuestions?.some(item=>item.artifactId===reply.questionArtifactId);
      if(!returning)throw new DomainError("reply_question_conflict");
    }
    if(question.focus)await this.assertFocus(scope,question.focus.kind,question.focus.id,question.focus.revision);
    if(reply.decision){
      if(scope.packet?.approval?.questionId!==reply.questionArtifactId||scope.packet.approval.decision!==reply.decision)throw new DomainError("explicit_signed_approval_required",{httpStatus:403});
    }
    scope.principal.assertCurrent();
  }
  private async assertFocus(scope:AuthorizedScope,kind:string,id:string,revision?:number){
    scope.principal.assertCurrent();
    if(kind==="contact"){
      const record=this.contacts.get({...scope.principal,allowedArtifactIds:[]},id);
      if(revision!==undefined&&record.currentRevision!==revision)throw new DomainError("contact_revision_conflict",{httpStatus:409});return;
    }
    if(kind==="receipt"){
      if(scope.principal.audience!=="private"||!scope.grant.domains.includes("receipts"))throw new DomainError("receipt_scope_not_authorized",{httpStatus:403});
      const value=await this.receipts.readReceipt({profileId:scope.principal.profileId,projectCodes:scope.grant.projectCodes,canReviewReceipts:scope.grant.canReviewReceipts,assertCurrent:scope.principal.assertCurrent},id);
      const record=object(value.receipt??value);
      if(revision!==undefined&&record.latestRevision!==revision&&!(record.disputed===true&&record.acceptedRevision===revision))throw new DomainError("receipt_review_revision_conflict",{httpStatus:409});return;
    }
    if(kind==="artifact"){
      const value=await this.artifacts.get(id,{profileId:scope.principal.profileId,canReadHousehold:scope.principal.canReadHousehold});
      if(value.ownerProfileId!==scope.principal.profileId||value.audience!=="household"||value.kind!=="output"||!["image/png","image/jpeg","image/webp","text/plain"].includes(value.mimeType)||["diagnostic-report.txt","uplift-report.csv"].includes(value.filename))throw new DomainError("display_source_scope_not_authorized",{httpStatus:403});return;
    }
    if(kind==="wiki"){
      if(!scope.grant.domains.includes("memory"))throw new DomainError("domain_not_authorized",{httpStatus:403});return;
    }
    if(kind==="list_item"||kind==="calendar_event")return;
    throw new DomainError("focus_not_authorized",{httpStatus:403});
  }
  async validateClientFocus(profileId:string,focus:NonNullable<import("../request-context.ts").MessageTaskContext["focus"]>,current:()=>void){
    if(focus.kind==="contact"){const value=await this.clientQueries.query(profileId,{kind:"contacts.get",contactId:focus.id},current);if(focus.revision!==undefined&&object(value).currentRevision!==focus.revision)throw new DomainError("contact_revision_conflict",{httpStatus:409});return;}
    if(focus.kind==="receipt"){const grant=this.config.profiles[profileId];if(!grant?.enabled||!grant.domains.includes("receipts"))throw new DomainError("domain_not_authorized",{httpStatus:403});const value=await this.receipts.readReceipt({profileId,projectCodes:grant.projectCodes,canReviewReceipts:grant.canReviewReceipts,assertCurrent:current},focus.id);const record=object(value.receipt??value);if(focus.revision!==undefined&&focus.revision!==record.latestRevision&&focus.revision!==record.acceptedRevision)throw new DomainError("receipt_review_revision_conflict",{httpStatus:409});return;}
    if(focus.kind==="wiki"){await this.clientQueries.query(profileId,{kind:"wiki.get",scope:focus.scope??"household",lookup:focus.id},current);return;}
    if(focus.kind==="list_item"){const value=await this.clientQueries.query(profileId,{kind:"lists.read",scope:focus.scope??"household"},current);if(!JSON.stringify(value).includes(JSON.stringify(focus.id)))throw new DomainError("list_item_not_found",{httpStatus:404});return;}
    throw new DomainError("focus_not_authorized",{httpStatus:403});
  }
  private async reviewBinding(scope:AuthorizedScope,context:BoundNativeToolContext,args:Json){
    if(scope.packet?.origin?.kind==="scheduled")return;
    const binding=await this.getTaskContext(context),snapshot=await this.tasks.snapshot(binding),question=snapshot.replyQuestion;
    const focus=scope.packet?.focus??(snapshot.currentReply?.relation==="answer"?question?.focus:undefined);
    if(focus?.kind!=="receipt"||typeof focus.revision!=="number")return;
    await this.assertFocus(scope,"receipt",focus.id,focus.revision);
    const source=await this.userInput(scope),quote=String(args.quote??args.text??"");if(!quote||!source.text.includes(quote))return;
    const approved=snapshot.currentReply?.decision==="approve"&&question?.approval?.toolName==="household_receipts_record_user_statement"&&question.approval.resourceId===focus.id&&question.approval.operationId===args.operationId;
    return {receiptId:focus.id,revision:focus.revision,sourcePromptId:scope.principal.sourcePromptId,quote,...(approved?{approvedException:{waivedReasons:question!.approval!.waivedReasons??[],reason:quote}}:{})};
  }
  private async effectEvidence(task:TaskFlowContext,refs:TaskEvidenceRef[]):Promise<VerifiedTaskEvidence[]>{
    const scope=this.taskScopes.get(task);if(!scope)throw new DomainError("task_authority_invalid");
    const result:VerifiedTaskEvidence[]=[];
    for(const ref of refs){
      scope.principal.assertCurrent();
      const row=this.database.domainConnection().prepare("SELECT tool_name,state,result_json,request_hash,source_prompt_id FROM domain_effects WHERE profile_id=? AND conversation_id=? AND operation_id=?").get(scope.principal.profileId,scope.principal.conversationId,ref.id) as Json|undefined;
      if(ref.kind!=="operation"||!row||row.state!=="committed"||typeof row.result_json!=="string")throw new DomainError("task_evidence_unverified");
      const sourceSubmission=this.database.submissions.get(String(row.source_prompt_id));
      if(!sourceSubmission||(sourceSubmission.taskContext as any)?.independentTopicOf||(task.native.goalId?sourceSubmission.receipt.goalId!==task.native.goalId:String(row.source_prompt_id)!==scope.principal.sourcePromptId))throw new DomainError("task_evidence_source_mismatch");
      const receipt=object(JSON.parse(row.result_json)),tool=String(row.tool_name),domain=domainCatalog.find(t=>t.nativeName===tool)?.domain;
      if(!domain||!this.catalogForScope(scope).some(t=>t.nativeName===tool)||!Object.keys(receipt).length||receipt.ok===false||receipt.status==="failed"||receipt.processingState==="failed"||receipt.state==="unknown")throw new DomainError("task_evidence_unverified");
      // The model supplies only the reference. This digest comes from the owning tool's committed receipt.
      if(domain==="contacts"){
        const ack=object(receipt.receipt);if(ack.saved!==true||typeof ack.contactId!=="string")throw new DomainError("task_evidence_unverified");
        const contact=this.contacts.get({...scope.principal,allowedArtifactIds:[]},ack.contactId);
        if(contact.currentRevision<Number(ack.revision))throw new DomainError("task_evidence_unverified");
      }else if(domain==="calendar"&&! ["committed","provider_acknowledged"].includes(String(receipt.state)))throw new DomainError("task_evidence_unverified");
      else if(domain==="lists"&&receipt.source!=="canonical_household_capture")throw new DomainError("task_evidence_unverified");
      else if(domain==="documents"){
        if(typeof receipt.extractionArtifactId!=="string")throw new DomainError("task_evidence_unverified");
        const allowedArtifactIds=await this.artifactGrants(scope,{artifactId:receipt.extractionArtifactId});
        const principal={...scope.principal,canProcessDocuments:true,allowedArtifactIds};
        const extraction=await this.documentAccess.result(principal,receipt.extractionArtifactId),original=await this.documentAccess.source(principal,extraction.sourceArtifactId);
        if(extraction.sourceSha256!==receipt.sourceSha256||original.sha256!==receipt.sourceSha256)throw new DomainError("task_evidence_unverified");
      }else if(["diagnostics","effects","email"].includes(domain))throw new DomainError("task_evidence_unverified");
      if(domain==="calendar"&&receipt.verified===false&&tool!=="household_calendar_delete")throw new DomainError("task_evidence_unverified");
      if(domain==="receipts"&&receipt.accepted===true){
        const value=await this.receipts.readReceipt({profileId:scope.principal.profileId,projectCodes:scope.grant.projectCodes,canReviewReceipts:scope.grant.canReviewReceipts,assertCurrent:scope.principal.assertCurrent},String(receipt.receiptId));
        const current=object(value.receipt??value);if(current.acceptedRevision!==receipt.revision||current.latestRevision!==receipt.revision||current.disputed===true)throw new DomainError("task_evidence_unverified");
      }
      const effectState=receipt.accepted===true?"accepted":receipt.state==="provisional"||receipt.accepted===false&&typeof receipt.reviewId==="string"||domain==="calendar"&&receipt.verified===false?"provisional":receipt.excluded===true||receipt.state==="excluded"||receipt.disposition==="excluded"?"excluded":"committed";
      if(receipt.accepted===false&&effectState!=="provisional")throw new DomainError("task_evidence_unverified");
      const resource=object(receipt.receipt),candidate=object(receipt.candidate),source=object(receipt.source),event=object(receipt.event),job=object(receipt.job),publication=object(receipt.publication);
      const rawList=object(receipt.result),listIds=domain==="lists"?[rawList.id,...(Array.isArray(rawList.saved)?rawList.saved:[]).map(v=>object(v).id),...(Array.isArray(rawList.existing)?rawList.existing:[]).map(v=>object(v).id)].filter(v=>typeof v==="string"&&/^[A-Z]+-\d{8}-\d{4}$/.test(v as string)):[];
      const resourceIds=[...new Set(listIds as string[])].slice(0,100);
      const resourceId=resource.contactId??resource.receiptId??receipt.receiptId??candidate.receiptId??source.id??event.id??receipt.eventId??job.id??receipt.jobId??publication.id??receipt.extractionArtifactId??receipt.lookup??(resourceIds.length===1?resourceIds[0]:undefined);
      const labels=domain==="lists"?[...(Array.isArray(rawList.saved)?rawList.saved:[]),...(Array.isArray(rawList.existing)?rawList.existing:[])].map(value=>object(value).text).filter((value):value is string=>typeof value==="string").slice(0,3).map(value=>value.slice(0,240)):[];
      const summary=tool+" "+effectState+(labels.length?" Ã‚Â· "+labels.map(value=>JSON.stringify(value)).join("; "):" by its owning domain");
      result.push({...ref,verified:true,digest:fingerprint({tool,receipt,requestHash:row.request_hash}),summary,provenance:"current_authorized_domain_receipt",effect:{toolName:tool,state:effectState,...(typeof resourceId==="string"?{resourceId}:{}),...(resourceIds.length?{resourceIds}:{})}});
    }
    scope.principal.assertCurrent();return result;
  }

  createReceiptCapture(databasePath: string, assertCurrent: (context: RequestContext) => void) {
    return createReceiptCaptureRoutes({
      databasePath, assertCurrent, artifacts: this.artifacts, documents: this.documents, uplift: this.receipts,
    });
  }

  async readiness():Promise<unknown>{
    const [documents,receipts,capture,gog]=await Promise.all([this.documents.readiness(),this.receipts.readiness(),readable(this.config.capture.script),readable(this.config.google.gogBinary)]);
    return {version:HOUSEHOLD_VERSION,toolCount:domainCatalog.length,domains:[...new Set(domainCatalog.map(tool=>tool.domain))],applicationSchema:this.database.schemaVersion,
      contacts:{status:"initialized",authority:"application_contacts"},documents,lists:{status:capture?"configured":"unavailable",authority:"existing_capture_store"},
      google:{status:gog?"configured_authorization_unverified":"unavailable",oauthRepair:"deferred",gmailSending:false},
      memory:{status:"configured",authority:"native_memory_core_and_wiki",sharedScopeSeparated:true},
      scheduling:{status:"configured",authority:"native_scheduler",activationEnabled:this.config.execution.schedulingEnabled},receipts,
      diagnostics:{evidenceTool:"registered",taskMode:"slice3_integration"},functionalAcceptance:"incomplete"};
  }
  async close():Promise<void>{this.closed=true;await this.runner.close();await Promise.allSettled([...this.inFlight]);}
}
