import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DisplayService } from "../src/display/service.ts";
import type { DisplayPorts,DisplayPublisher,DisplayPublishAuthorization,DisplaySourceArtifact } from "../src/display/contracts.ts";

const now=new Date("2026-11-05T02:00:00Z"),bytes=Buffer.from("Household chart summary"),artifactId="artifact-"+"a".repeat(64);
function fixture(){
  let metadata:DisplaySourceArtifact={id:artifactId,ownerProfileId:"alex",conversationId:"previous-chat",taskId:"completed-goal",audience:"household",kind:"output",mimeType:"text/plain",byteLength:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")};
  const principal:DisplayPublisher={profileId:"alex",role:"admin",conversationId:"current-chat",taskId:"current-task",sourcePromptId:"fresh-prompt",sourcePromptCreatedAt:"2026-11-05T01:59:59Z",taskMode:"standard",canPublishHousehold:true,assertCurrent(){}};
  const authorization:DisplayPublishAuthorization={purpose:"display_publish",sourcePromptId:principal.sourcePromptId,artifactId,artifactSha256:metadata.sha256,contentClass:"household_output",artifactConversationId:metadata.conversationId,artifactTaskId:metadata.taskId,issuedAt:now.toISOString(),expiresAt:"2026-11-05T02:01:00Z",publicationExpiresAt:"2026-11-06T02:00:00Z"};
  let commits=0;
  const ports:DisplayPorts={clock:()=>now,lists:{readHousehold:async()=>({shopping:[],tasks:[],waiting:[]})},calendar:{upcomingHousehold:async()=>[]},
    artifacts:{readForPublication:async()=>({metadata,bytes})},publications:{commit:async(draft,_bytes,current)=>{current();commits++;return {...draft,publishedAt:now.toISOString()};},listActive:async()=>[],getActive:async()=>null,readContent:async()=>bytes}};
  return {service:new DisplayService(ports),principal,authorization,commits:()=>commits,source:(patch:Partial<DisplaySourceArtifact>)=>{metadata={...metadata,...patch};},input:{operationId:"display-operation-001",artifactId,title:"Household summary"}};
}
test("fresh adult publication can reuse an exact owned household output from a completed task",async()=>{
  const f=fixture(),result=await f.service.publish(f.principal,f.input,f.authorization);
  assert.equal(result.state,"committed");assert.equal(result.audience,"household");assert.equal(f.commits(),1);
});
test("completed-task reuse preserves private, ownership, exact origin and child boundaries",async()=>{
  for(const patch of [{audience:"private"},{ownerProfileId:"natasha"},{taskId:"different-completed-goal"}] as Array<Partial<DisplaySourceArtifact>>){
    const f=fixture();f.source(patch);await assert.rejects(()=>f.service.publish(f.principal,f.input,f.authorization),/display_source_scope_not_authorized/);assert.equal(f.commits(),0);
  }
  const f=fixture();await assert.rejects(()=>f.service.publish({...f.principal,role:"child"},f.input,f.authorization),/display_publication_not_authorized/);
  await assert.rejects(()=>f.service.publish({...f.principal,taskMode:"diagnostic"},f.input,f.authorization),/display_publication_not_authorized/);
  await assert.rejects(()=>f.service.publish(f.principal,f.input,{...f.authorization,sourcePromptId:"old-prompt"}),/fresh_display_publication_authorization_required/);
  assert.equal(f.commits(),0);
});
