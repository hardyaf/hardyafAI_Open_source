import assert from "node:assert/strict";
import test from "node:test";
import {MemoryDomain} from "../src/domains/memory/index.ts";
import {wikiPageProjection,wikiSearchProjection} from "../src/client-views/projections.ts";
import type {NativeDomainContext,NativeJson,NativeRpcPort} from "../src/domains/native-contracts.ts";

const lookup = "syntheses/household-recipe-spice-mix.md";
const noteId = "HN-20261018-0001";
const note = "- 1 teaspoon turmeric\n- 2 teaspoons ground coriander\n\nMix and store dry.";
const context: NativeDomainContext = {
  profileId:"adult",agentId:"main",sessionKey:"session",conversationId:"chat",
  audience:"household",allowedScopes:["household","personal"],authorizedAttendees:[],
  confirmedSourceIds:["user:recipe-save"],assertCurrent() {},
};
const input = {scope:"household",title:"Spice mix",aliases:["Yellow blend"],operationId:"save-recipe-01"};

function fixture() {
  const calls: {method:string;params:NativeJson}[] = [];
  const noteReads: string[] = [];
  let page: NativeJson | null = null;
  const rpc: NativeRpcPort = {async request(method,params) {
    calls.push({method,params});
    assert.equal(params.agentId,"family-knowledge");
    if (method === "wiki.apply") {
      page = {path:lookup,content:`<!-- openclaw:wiki:generated:start -->\n${params.body}\n<!-- openclaw:wiki:generated:end -->`};
    } else if (method === "wiki.get") return page;
    else if (method === "wiki.search") return [
      {path:"syntheses/household-topic-garden.md",title:"Garden"},
      {path:lookup,title:"Household recipe Spice mix"},
      {path:"reports/unmanaged.md",title:"Unmanaged"},
    ];
    else assert.equal(method,"wiki.compile");
    return {};
  }};
  const sources = {async save(){throw Error("unexpected fact source write");},async read(){throw Error("unexpected fact source read");}};
  const domain = new MemoryDomain({enabled:true,sharedAgentId:"family-knowledge"},rpc,sources,undefined,undefined,
    async (scope,id) => {assert.equal(scope,"household"); noteReads.push(id); return note;});
  return {calls,noteReads,domain};
}

test("a scoped legacy note is filed verbatim with source provenance and indexed recipe terms",async () => {
  const {calls,noteReads,domain} = fixture();
  const args = {...input,referenceNoteId:noteId};
  const saved = await domain.execute("household_memory_save_recipe",args,context) as NativeJson;
  assert.equal(saved.lookup,lookup);
  assert.deepEqual(noteReads,[noteId]);
  const write = calls.find(call => call.method === "wiki.apply")!.params;
  assert.ok(String(write.body).endsWith(note));
  assert.match(String(write.body),new RegExp(`reference note ${noteId} \\(SHA-256 [a-f0-9]{64}\\)`));
  assert.deepEqual(write.sourceIds,[`capture-note.${noteId}`]);
  const claims = write.claims as NativeJson[];
  assert.ok(claims.some(claim => claim.text === "Yellow blend"));
  assert.ok(claims.some(claim => String(claim.text).includes("ground coriander")));
  assert.ok(claims.every(claim => claim.status === "candidate"));
  assert.equal((await domain.execute("household_memory_save_recipe",args,context) as NativeJson).existing,true);
  await assert.rejects(() => domain.execute("household_memory_save_recipe",{...args,aliases:["Different"]},context),{code:"recipe_title_already_saved"});
  assert.equal(calls.filter(call => call.method === "wiki.apply").length,1);
});

test("a new recipe stays separate from grounded facts and is visible to the Knowledge client",async () => {
  const {calls,domain} = fixture();
  await domain.execute("household_memory_save_recipe",{...input,ingredients:["1 teaspoon turmeric"],steps:["Stir together."]},context);
  const write = calls.find(call => call.method === "wiki.apply")!.params;
  assert.deepEqual(write.sourceIds,["user:recipe-save"]);
  assert.match(String(write.body),/1\. Stir together\./);
  const result = await domain.execute("household_memory_search",{scope:"household",kind:"recipe",query:"turmeric"},context);
  assert.deepEqual(wikiSearchProjection(result,"household").pages.map(item => item.id),[lookup]);
  const page = await domain.execute("household_memory_get",{scope:"household",lookup},context);
  assert.match(wikiPageProjection(page,"household",lookup).page.body,/1 teaspoon turmeric/);
});

test("recipe import rejects audience changes, absent human binding and mixed content before writes",async () => {
  const {calls,noteReads,domain} = fixture();
  const args = {...input,referenceNoteId:noteId};
  await assert.rejects(() => domain.execute("household_memory_save_recipe",args,{...context,audience:"private"}),{code:"memory_shared_write_requires_shared_conversation"});
  await assert.rejects(() => domain.execute("household_memory_save_recipe",{...args,scope:"personal"},context),{code:"scope_not_authorized"});
  await assert.rejects(() => domain.execute("household_memory_save_recipe",args,{...context,confirmedSourceIds:[]}),{code:"fresh_human_response_required"});
  await assert.rejects(() => domain.execute("household_memory_save_recipe",{...args,ingredients:["Private ingredient"]},context),{code:"recipe_reference_or_content_required"});
  assert.deepEqual(calls,[]);
  assert.deepEqual(noteReads,[]);
});
