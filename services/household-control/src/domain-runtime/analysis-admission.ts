import { createHash } from "node:crypto";
import type { ExecutionAuthorityRepository } from "../request-context.ts";
import type { AnalysisChildIdentity,AnalysisFlowContext,NativeAnalysisRequest,NativeAnalysisAdmission,NativeAnalysisChild,NativeAnalysisObservation } from "../analysis-flow/types.ts";
import { DomainError,fingerprint } from "./common.ts";
import { normalizedSessionKey } from "./native-scope.ts";

function identity(context:AnalysisFlowContext,requestArtifactId:string){
  if(!/^artifact-[a-f0-9]{64}$/.test(requestArtifactId))throw new DomainError("analysis_request_invalid");
  const request={kind:"analysis_child_admission",requestArtifactId,sourcePromptId:context.source.id,sourceSha256:context.source.sha256,
    scope:context.scope,nativeSessionId:context.native.sessionId,nativeGoalId:context.native.goalId};
  return {request,key:"analysis:"+createHash("sha256").update(JSON.stringify(request)).digest("hex")};
}

/** Exact request/child linkage in the existing native-control receipt authority. */
export class AnalysisAdmissionBindings {
  private readonly authority:ExecutionAuthorityRepository;
  constructor(authority:ExecutionAuthorityRepository){this.authority=authority;}
  async spawn(context:AnalysisFlowContext,request:NativeAnalysisRequest,spawn:()=>Promise<NativeAnalysisAdmission>):Promise<NativeAnalysisAdmission>{
    context.assertCurrent();const binding=identity(context,request.requestArtifactId);
    const prior=this.authority.control(binding.key,context.scope.conversationId,binding.request) as any;
    if(prior){
      if(prior.phase==="admitted")return prior.admission;
      throw new DomainError("analysis_admission_outcome_unknown",{outcome:"unknown"});
    }
    const prepared=this.authority.prepareControl(binding.key,context.scope.conversationId,binding.request);
    const admission=await spawn();context.assertCurrent();
    this.authority.finishControl(binding.key,context.scope.conversationId,binding.request,{...prepared,phase:admission.state==="accepted"?"admitted":admission.state,admission});
    context.assertCurrent();return admission;
  }
  observe(context: AnalysisFlowContext, identity: AnalysisChildIdentity,
    read: (request: NativeAnalysisObservation) => Promise<NativeAnalysisChild>): Promise<NativeAnalysisChild> {
    context.assertCurrent();
    const { childSessionKey, runId, parentSessionKey, parentAgentId, expectedSessionId } = identity;
    const parentKey = normalizedSessionKey(parentAgentId, parentSessionKey);
    const parent = this.authority.get(parentKey);
    const child = this.authority.get(childSessionKey);
    const refuse = () => new DomainError("analysis_child_binding_invalid", { httpStatus: 403 });
    if (!parent || parent.agentId !== parentAgentId || !child?.sessionId || child.agentId !== "household-analysis" ||
      child.parentSessionKey !== parentKey || child.rootSessionKey !== parent.rootSessionKey ||
      child.sourceId !== parent.sourceId || child.runId !== runId || child.goalId !== context.native.goalId ||
      child.mode !== parent.mode || expectedSessionId && child.sessionId !== expectedSessionId) throw refuse();
    const parentFence = fingerprint(parent), childFence = fingerprint(child);
    const assertCurrent = () => {
      context.assertCurrent();
      if (fingerprint(this.authority.get(parentKey)) !== parentFence ||
        fingerprint(this.authority.get(childSessionKey)) !== childFence) throw refuse();
    };
    return read({ childSessionKey, runId, parentSessionKey, expectedSessionId: child.sessionId, rootTaskId: context.scope.taskId, assertCurrent });
  }
  matches(context:AnalysisFlowContext,requestArtifactId:string,childSessionKey:string,runId:string):boolean{
    context.assertCurrent();const binding=identity(context,requestArtifactId);
    const value=this.authority.control(binding.key,context.scope.conversationId,binding.request) as any;
    context.assertCurrent();return Boolean(value?.phase==="admitted"&&value.admission?.state==="accepted"&&value.admission.childSessionKey===childSessionKey&&value.admission.runId===runId);
  }
}
