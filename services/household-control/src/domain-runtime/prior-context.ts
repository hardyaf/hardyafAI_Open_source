import type {HouseholdDatabase} from "../database.ts";
import type {ArtifactStore} from "../platform/artifacts.ts";
import type {AuthorizedScope} from "./native-scope.ts";
import type {TaskEffectRequirement} from "../task-flow/types.ts";

/** Content-free recent topic references, projected from existing completed handoffs.
 * No transcript, diary, memory fact, financial row or diagnostic text is restored.
 */
export async function priorOutcomeContext(database:HouseholdDatabase,artifacts:ArtifactStore,scope:AuthorizedScope,sessionId:string,currentSourceId:string){
  const principal={profileId:scope.principal.profileId,canReadHousehold:scope.principal.canReadHousehold};
  const rows=database.domainConnection().prepare("SELECT checkpoint_artifact_id,native_goal_id FROM conversation_checkpoints WHERE conversation_id=? AND native_session_id=? AND checkpoint_artifact_id IS NOT NULL ORDER BY updated_at DESC LIMIT 8").all(scope.conversation.id,sessionId) as Array<Record<string,unknown>>;
  const effects:TaskEffectRequirement[]=[],artifactIds:string[]=[];
  for(const row of rows){
    scope.principal.assertCurrent();
    try{
      const file=await artifacts.read(String(row.checkpoint_artifact_id),principal),meta=file.metadata;
      if(meta.conversationId!==scope.conversation.id||meta.ownerProfileId!==scope.conversation.ownerProfileId||meta.audience!==scope.principal.audience||meta.kind!=="evidence"||meta.filename!=="task-handoff.json"||file.bytes.length>128*1024)continue;
      const body=JSON.parse(file.bytes.toString("utf8"));
      if(body.kind!=="task_handoff"||body.schemaVersion!==1||body.nativeSessionId!==sessionId||body.nativeGoalId!==(row.native_goal_id||null)||body.taskId!==meta.taskId||body.terminal!=="complete"||body.originalSourcePromptId===currentSourceId)continue;
      for(const values of Object.values(body.verifications??{}))for(const value of Array.isArray(values)?values:[]){
        if(value?.verified!==true)continue;
        const effect=value.effect,tool=effect?.toolName;
        if(value.kind==="operation"&&typeof tool==="string"&&/^household_(calendar|contacts|lists|schedule|display)_/.test(tool)&&typeof effect.resourceId==="string"&&effect.resourceId.length<=256&&["committed","accepted","provisional","excluded"].includes(effect.state)){
          const domain=tool.split("_")[1];
          if(scope.grant.domains.includes(domain)&&(scope.principal.audience!=="household"||scope.grant.sharedDomains.includes(domain)))effects.push({toolName:tool,state:effect.state,resourceId:effect.resourceId});
        }
        if(value.kind==="artifact"&&typeof value.id==="string"&&artifactIds.length<4){
          const output=await artifacts.get(value.id,principal);
          if(output.ownerProfileId===scope.conversation.ownerProfileId&&output.conversationId===scope.conversation.id&&output.audience===scope.principal.audience&&output.kind==="output"&&
            ["text/plain","text/csv","application/json","text/x-python"].includes(output.mimeType)&&!/^uplift-report\.|^diagnostic-report\./.test(output.filename))artifactIds.push(output.id);
        }
      }
      if(effects.length||artifactIds.length)break;
    }catch{/* A removed/inaccessible historical reference never blocks the current turn. */}
  }
  scope.principal.assertCurrent();return {effects:effects.slice(0,20),artifactIds:[...new Set(artifactIds)].slice(0,4)};
}
