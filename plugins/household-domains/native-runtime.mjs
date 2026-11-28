import {registerNativeDiagnosticHooks} from "./native-diagnostic-hooks.mjs";
import { HOUSEHOLD_VERSION } from "../../services/household-control/src/version.ts";
import {registerNativeTaskBridge} from './native-task-hooks.mjs';

const managedAgents=new Set(['main','natasha','fred','belle','household-analysis','household-diagnostics']);
const contextCodes=new Set(['household_runtime_unavailable','domain_runtime_stopping','trusted_native_context_required','native_conversation_not_authorized',
  'native_run_authority_changed','admitted_household_request_required','domain_profile_not_authorized','verified_native_human_source_required',
  'native_principal_mismatch','native_child_not_authorized','native_session_not_authorized','household_request_context_changed','source_goal_not_active',
  'native_request_lineage_not_authorized','native_session_generation_changed','domain_authority_revoked','source_reference_not_authorized',
  'current_user_source_unavailable','native_source_context_unavailable','native_source_integrity_failed','diagnostic_lineage_mismatch',
  'protected_configuration_required','protected_configuration_unavailable','domain_configuration_invalid','domain_configuration_version_unsupported',
  'domain_runtime_configuration_missing','artifact_storage_unavailable','artifact_storage_permissions']);
const contextPhases=new Set(['before_model_resolve','agent_turn_prepare','before_prompt_build','before_agent_finalize','before_tool_call','owned-init']);
const unavailable=code=>Object.assign(Error(code),{code});

/** One owning graph per plugin process, backed by the existing stores/native authorities. */
export function registerHouseholdRuntime(api,{descriptors,createOwned,spawnNativeAnalysis,resolveSandboxRuntimeStatus}){
  let owned,initializing,disposing,serviceOwned=false,stopped=false,generation=0;
  const activeRuns=new Set();
  let activeCalls=0;
  let bridge;
  const assertHook=context=>{context?.hookInvocation?.assertActive();context?.toolAuthority?.assertActive();};
  const logContext=(phase,error)=>api.logger?.error?.('Household context refused: '+JSON.stringify({
    phase:contextPhases.has(phase)?phase:'native',code:contextCodes.has(error?.code)?error.code:'household_runtime_unavailable'}));
  async function ensureOwned(context){
    assertHook(context);
    if(stopped)throw unavailable('domain_runtime_stopping');
    if(disposing)await disposing;
    assertHook(context);
    if(stopped)throw unavailable('domain_runtime_stopping');
    if(typeof context?.runId==='string'&&context.runId)activeRuns.add(context.runId);
    if(owned)return owned;
    if(!initializing){
      const currentGeneration=generation;
      const promise=Promise.resolve().then(async()=>{
        const config=api.pluginConfig??{};
        const current=await createOwned({controlEnvironmentPath:config.controlEnvironmentPath,configurationPath:config.domainConfigurationPath,
          nativeSandboxCheck:async(sessionKey,agentId)=>{
            const status=resolveSandboxRuntimeStatus({cfg:api.runtime.config.current(),sessionKey,agentId});
            if(!['main','household-analysis'].includes(agentId)||status.sandboxed!==true||status.mode!=='all'||status.classificationAgentId!==agentId||status.classificationSessionKey!==sessionKey)
              throw unavailable('analysis_native_sandbox_required');
          }});
        if(stopped||generation!==currentGeneration){await current.close();throw unavailable('domain_runtime_stopping');}
        try{current.runtime.configureNativePolicyReader?.(()=>api.runtime.config.current());current.runtime.configureNativeTransport((context,request)=>spawnNativeAnalysis(context,request,{config:api.config,
          workspaceDir:context.execution.workspaceDir,toolCallId:context.execution.toolCallId}));}
        catch(error){await current.close();throw error;}
        owned=current;return current;
      }).catch(error=>{logContext('owned-init',error);throw unavailable(contextCodes.has(error?.code)?error.code:'household_runtime_unavailable');})
        .finally(()=>{if(initializing===promise)initializing=undefined;});
      initializing=promise;
    }
    const current=await initializing;
    assertHook(context);
    if(stopped)throw unavailable('domain_runtime_stopping');
    return current;
  }
  async function dispose(){
    if(disposing)return disposing;
    generation++;
    const current=owned,pending=initializing;owned=undefined;
    const promise=(async()=>{if(pending)await pending.catch(()=>{});await current?.close();bridge?.clear();})()
      .finally(()=>{if(disposing===promise)disposing=undefined;});
    disposing=promise;return promise;
  }
  function staticCatalog(context){
    if(['household-analysis'].includes(context?.agentId))return descriptors.filter(tool=>tool.name==='analysis.publish_output');
    if(context?.agentId==='household-diagnostics')return [];
    return descriptors.filter(tool=>!["task.verify_outcome","task.finish"].includes(tool.name));
  }
  bridge=registerNativeTaskBridge(api,{
    isManagedAgent:(agentId,sessionKey)=>owned?.runtime.isManagedAgent(agentId,sessionKey)??managedAgents.has(agentId),
    // Discovery is metadata-only. Actual worker invocations resolve the owner lazily.
    catalog:context=>owned?.runtime.catalog(context)??staticCatalog(context),
    execute:async(name,args,context,signal)=>{
      // Discovery registry factories may not receive the run owner's agent_end.
      // Their graphs therefore retain only an explicit bounded call lease.
      activeCalls++;
      try{return await (await ensureOwned()).runtime.executeNativeInvocation(name,args,context,signal);}
      finally{activeCalls--;if(!serviceOwned&&activeRuns.size===0&&activeCalls===0)await dispose();}
    },
    bindInvocation:async(binding,event,context)=>(await ensureOwned(context)).runtime.bindNativeInvocation(binding,event,context),
    admitNativeTurn:async(event,context,observation)=>{const current=await ensureOwned(context);return current.runtime.admitNativeTurn(event,context,observation);},
    guardScheduledDelivery:async(event,context)=>{
      activeCalls++;
      try{return await (await ensureOwned(context)).runtime.guardScheduledDelivery(event,context);}
      finally{activeCalls--;if(!serviceOwned&&activeRuns.size===0&&activeCalls===0)await dispose();}
    },
    approvalRequest:async(binding,event,context)=>(await ensureOwned(context)).runtime.nativeApprovalRequest?.(binding,event,context),
    approvalResolved:async(binding,event,context,decision)=>(await ensureOwned(context)).runtime.nativeApprovalResolved?.(binding,event,context,decision),
    observeInbound:async(event,context)=>(await ensureOwned(context)).runtime.observeNativeInbound(event,context),
    registerNativeChild:async(event,context)=>(await ensureOwned()).runtime.registerNativeChild(event,context),
    getTaskContext:async(hook,event,context)=>{
      const completionCall=event.toolName==="household_task_complete"||event.toolName==="tool_call"&&
        ["household_task_complete","openclaw:hardy-household:household_task_complete"].includes(event.params?.id);
      const bound={...context,runId:context.runId??event.runId,
        completionRecovery:hook==="before_agent_finalize"||hook==="before_tool_call"&&completionCall};
      try{return await (await ensureOwned(bound)).runtime.getTaskContext(bound);}
      catch(error){logContext(hook,error);return null;}
    },
    prompt:async(binding,event,context)=>(await ensureOwned(context)).runtime.taskPrompt(binding,event,context),
    finalize:async(binding,event,context)=>(await ensureOwned(context)).runtime.taskFinalize(binding,event,context),
    guard:async(binding,event,context)=>(await ensureOwned(context)).runtime.taskGuard(binding,event,context),
    bootstrapAccess:event=>owned?.runtime.bootstrapAccess(event)??'unknown',
    end:async(event,context)=>{if(owned)await owned.runtime.nativeEnd(event,context);},
    release:async(event,context)=>{
      const runId=context.runId??event.runId;if(typeof runId==='string')activeRuns.delete(runId);
      // Agent workers do not start gateway services. agent_end is the supported
      // worker lifetime boundary; a rejected turn releases resources as well.
      if(!serviceOwned&&activeRuns.size===0&&activeCalls===0)await dispose();
    },
  });
  registerNativeDiagnosticHooks(api,{isManagedAgent:(agentId,key)=>owned?.runtime.isManagedAgent(agentId,key)??managedAgents.has(agentId),
    observe:async(observation,context)=>(await ensureOwned(context)).runtime.observeNativeDiagnostic?.(observation,context)});
  api.registerService({id:'hardy-household-domain-resources',reload:{configPrefixes:['plugins.entries.hardy-household.config']},
    async start(){serviceOwned=true;stopped=false;try{await ensureOwned();}catch(error){serviceOwned=false;throw error;}},
    async stop(){serviceOwned=false;stopped=true;activeRuns.clear();await dispose();}});
  api.registerGatewayMethod('hardy_household.status',({respond})=>respond(true,{initialized:Boolean(owned),version:HOUSEHOLD_VERSION,registeredToolCount:descriptors.length,
    taskBoundaryRegistered:true,functionalAcceptance:'campaign_pending'}),{scope:'operator.read',profileAccess:'independent'});
  return {ensureOwned,close:async()=>{serviceOwned=false;stopped=true;activeRuns.clear();await dispose();}};
}
