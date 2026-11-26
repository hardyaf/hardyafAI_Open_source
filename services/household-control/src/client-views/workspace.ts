import type { Conversation, HouseholdCheckpoint, HouseholdConversationContext } from "../domain.ts";
import type { ArtifactMetadata, ArtifactPrincipal } from "../platform/artifacts.ts";
import { ClientViewError } from "./contracts.ts";
import type { ClientRouteContext, ClientViewDependencies } from "./contracts.ts";
import { object, rows, text } from "./projections.ts";

type Json = Record<string, unknown>;
function sameNative(a: HouseholdConversationContext, b: HouseholdConversationContext): boolean {
  return a.sessionKey === b.sessionKey && a.sessionId === b.sessionId && a.goal?.id === b.goal?.id && a.goal?.status === b.goal?.status;
}
function artifactCard(value: ArtifactMetadata) {
  return {id:value.id,filename:value.filename,mimeType:value.mimeType,kind:value.kind,audience:value.audience,byteLength:value.byteLength,createdAt:value.createdAt};
}
async function boundArtifact(deps: ClientViewDependencies, conversation: Conversation, native: HouseholdConversationContext, checkpoint: HouseholdCheckpoint,
  id: string, kind: string, principal: ArtifactPrincipal, assertCurrent: () => void): Promise<Json> {
  assertCurrent();
  const artifact = await deps.artifacts.read(id, principal), metadata = artifact.metadata;
  if(metadata.ownerProfileId !== conversation.ownerProfileId || metadata.conversationId !== conversation.id || metadata.audience !== conversation.audience ||
    metadata.taskId !== (native.goal?.id ?? "conversation:"+conversation.id) || metadata.kind !== "evidence" ||
    metadata.mimeType !== "application/json" || artifact.bytes.length > 128*1024) throw new ClientViewError("task_artifact_binding_invalid",409);
  let parsed: unknown;
  try { parsed = JSON.parse(artifact.bytes.toString("utf8")); } catch { throw new ClientViewError("task_artifact_binding_invalid",409); }
  const value = object(parsed);
  if(value.schemaVersion !== 1 || value.kind !== kind || value.nativeSessionId !== native.sessionId || value.nativeGoalId !== (native.goal?.id ?? null) ||
    checkpoint.nativeSessionId !== native.sessionId || checkpoint.nativeGoalId !== (native.goal?.id ?? null)) throw new ClientViewError("task_artifact_binding_invalid",409);
  assertCurrent(); return value;
}

/** Read-only task card assembled from native state and its bound immutable artifacts. */
export async function projectWorkspace(deps: ClientViewDependencies, context: ClientRouteContext, conversationId: string, assertCurrent: () => void) {
  assertCurrent();
  const conversation = deps.store.getConversation(context.profile,conversationId);
  if(!conversation) throw new ClientViewError("conversation_not_found",404);
  const owns = conversation.ownerProfileId === context.profile.id && conversation.agentId === context.profile.agentId;
  const principal = {profileId:context.profile.id,canReadHousehold:context.profile.capabilities.includes("viewHouseholdStatus")};
  if(conversation.audience === "household" && !principal.canReadHousehold) throw new ClientViewError("conversation_not_found",404);
  const native = owns && deps.store.getContext ? await deps.store.getContext(context.profile,conversationId) : undefined;
  const checkpoint = native?.sessionId && deps.store.getCheckpoint ? await deps.store.getCheckpoint(context.profile,conversationId) : null;
  let handoff: Json | null = null, question: Json | null = null;
  if(checkpoint && native) {
    if(checkpoint.nativeSessionId !== native.sessionId || checkpoint.nativeGoalId !== (native.goal?.id ?? null)) throw new ClientViewError("task_workspace_changed",409);
    if(checkpoint.checkpointArtifactId) {
      handoff = await boundArtifact(deps,conversation,native,checkpoint,checkpoint.checkpointArtifactId,"task_handoff",principal,assertCurrent);
      if(handoff.taskId !== (native.goal?.id ?? "conversation:"+conversationId) || handoff.phase !== checkpoint.phase || handoff.questionArtifactId !== checkpoint.questionArtifactId)
        throw new ClientViewError("task_checkpoint_binding_invalid",409);
    }
    if(checkpoint.questionArtifactId) {
      const value = await boundArtifact(deps,conversation,native,checkpoint,checkpoint.questionArtifactId,"task_question",principal,assertCurrent);
      if(typeof value.text !== "string" || !value.text.trim() || value.text.length > 4000) throw new ClientViewError("task_question_invalid",409);
      const approval = object(value.approval);
      question = {id:checkpoint.questionArtifactId,text:value.text,kind:text(value.questionType,40) || "clarification",
        ...(typeof approval.toolName === "string" && typeof approval.operationId === "string" && typeof approval.resourceId === "string" ? {
          approval:{toolName:text(approval.toolName,128),operationId:text(approval.operationId,128),resourceId:text(approval.resourceId,200),
            ...(Array.isArray(approval.waivedReasons) ? {waivedReasons:approval.waivedReasons.filter(item => typeof item === "string").slice(0,40).map(item => text(item,200))} : {})},
        } : {})};
    }
  }
  const progress = owns && deps.progress ? await deps.progress(context.profile,conversation,assertCurrent) : null;
  if(progress && progress.sessionKey !== conversation.sessionKey && progress.sessionKey !== `agent:${conversation.agentId}:${conversation.sessionKey}`)
    throw new ClientViewError("native_progress_invalid",503);
  const listed = await deps.artifacts.list(principal,{conversationId,limit:100});
  const artifacts = listed.items.filter(item => (conversation.audience !== "household" || item.audience === "household") && ["input","output"].includes(item.kind)).map(artifactCard);
  const available = context.profile.role === "child" ? [] : await deps.reads.availableViews(context.profile.id,assertCurrent);
  assertCurrent();
  const currentConversation = deps.store.getConversation(context.profile,conversationId);
  if(!currentConversation || currentConversation.audience !== conversation.audience || currentConversation.ownerProfileId !== conversation.ownerProfileId || currentConversation.agentId !== conversation.agentId)
    throw new ClientViewError("task_workspace_changed",409);
  if(native && deps.store.getContext) {
    const current = await deps.store.getContext(context.profile,conversationId);
    if(!current || !sameNative(native,current)) throw new ClientViewError("task_workspace_changed",409);
  }
  assertCurrent();
  const status = !owns ? "shared" : question ? "waiting_for_user" : native?.goal?.status ?? (context.profile.status === "working" ? "running" : "idle");
  const mode = handoff?.mode === "brain_dump" || handoff?.mode === "diagnostic" ? handoff.mode : native?.goal ? "task" : "conversation";
  const activity = owns ? deps.store.getConversationActivity?.(context.profile,conversationId) ?? "idle" : "idle";
  return {task:{mode,status,activity,phase:text(checkpoint?.phase,80),goalId:native?.goal?.id ?? null,runId:native?.runId ?? null,
    objective:text(native?.goal?.objective ?? handoff?.objective,10000),progress:{summary:text(progress?.markdown ?? handoff?.summary,8192),steps:progress?.steps ?? []},
    question,checkpointRevision:checkpoint?.revision ?? null},artifacts,artifactsTruncated:listed.truncated,
    availableViews:[...new Set(available)].filter(view => ["contacts","lists","wiki","receipts"].includes(view))};
}
