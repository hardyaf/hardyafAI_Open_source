// Deferred to the consolidated Slice 3 functionality campaign.
import test from "node:test";
import assert from "node:assert/strict";
import {MemoryDomain} from "../src/domains/memory/index.ts";
import type {MemorySource,NativeMemorySources} from "../src/domains/memory/source-files.ts";
import type {NativeDomainContext,NativeJson,NativeRpcPort} from "../src/domains/native-contracts.ts";

const context:NativeDomainContext={profileId:"adult",agentId:"main",sessionKey:"session",conversationId:"conversation",audience:"private",allowedScopes:["personal"],authorizedAttendees:[],assertCurrent(){}};
function fixture(sourceText:string,secondCandidate=false){
  const id="source-"+"a".repeat(64),otherId="source-"+"b".repeat(64);
  const source:MemorySource={id,title:"Verified human quote",text:sourceText,scope:"personal",recordedAt:"2026-11-03T12:00:00Z",originClass:"user-stated",certainty:"confirmed",sourceIds:["user:source"],fingerprint:"c".repeat(64),nativePath:"memory/household-sources/"+id+".md"};
  const sources:NativeMemorySources={async save(){throw Error("unused");},async read(_agent,_scope,sourceId){assert.ok(sourceId===id||sourceId===otherId);return sourceId===id?source:{...source,id:otherId,certainty:"candidate"};}};
  const mutations:NativeJson[]=[];let current:NativeJson|null=null;
  const rpc:NativeRpcPort={async request(method,params){
    if(method==="wiki.get")return current;
    assert.equal(method,"wiki.apply");mutations.push(structuredClone(params));
    current={path:"syntheses/household-topic-fred.md",content:params.body,updatedAt:String(mutations.length),fromLine:1,truncated:false};return {committed:true};
  }};
  const domain=new MemoryDomain({enabled:true},rpc,sources);
  const input=(claimText:string,body=claimText)=>({operationId:"capture-fred-01",scope:"personal",title:"Fred",body,sourceIds:secondCandidate?[id,otherId]:[id],claims:[{text:claimText,sourceIds:secondCandidate?[id,otherId]:[id],certainty:"fact"}],expectedContentHash:null});
  return {domain,mutations,input};
}

test("confirmed unrelated text cannot support a model-invented fact",async()=>{
  const f=fixture("Fred likes blue");
  const saved=await f.domain.execute("household_memory_synthesize",f.input("Fred is 10"),context) as {state:string;contentHash:string};
  assert.equal(saved.state,"committed");assert.match(saved.contentHash,/^[a-f0-9]{64}$/);
  assert.equal((f.mutations[0].claims as NativeJson[])[0].status,"candidate");assert.equal(f.mutations[0].status,"review");
  assert.match(f.mutations[0].body as string,/> Review needed:/);assert.match(f.mutations[0].body as string,/Candidate claims are not confirmed facts/);
});

test("a literal quote with normalized whitespace remains supported",async()=>{
  const f=fixture("Fred\n likes   blue");
  await f.domain.execute("household_memory_synthesize",f.input("Fred likes blue"),context);
  assert.equal((f.mutations[0].claims as NativeJson[])[0].status,"supported");assert.equal(f.mutations[0].status,"supported");
  assert.doesNotMatch(f.mutations[0].body as string,/Review needed:/);
});

for(const [sourceText,claimText] of [["Fred likes blue","Fred's favorite color is blue"],["Fred is 100","Fred is 10"],["Fred likes blueberry","Fred likes blue"]]){
  test("paraphrases and partial values cannot be promoted: "+claimText,async()=>{
    const f=fixture(sourceText);await f.domain.execute("household_memory_synthesize",f.input(claimText),context);
    assert.equal((f.mutations[0].claims as NativeJson[])[0].status,"candidate");assert.equal(f.mutations[0].status,"review");
  });
}

test("every bound source must remain confirmed even when one contains the quote",async()=>{
  const f=fixture("Fred likes blue",true);await f.domain.execute("household_memory_synthesize",f.input("Fred likes blue"),context);
  assert.equal((f.mutations[0].claims as NativeJson[])[0].status,"candidate");assert.equal(f.mutations[0].status,"review");
});

test("review notices follow the current claims and updates retain the hash fence",async()=>{
  const f=fixture("Fred likes blue");
  let saved=await f.domain.execute("household_memory_synthesize",f.input("Fred is 10","Fred's preferences are discussed here."),context) as {contentHash:string};
  const reviewBody=f.mutations[0].body as string;
  saved=await f.domain.execute("household_memory_synthesize",{...f.input("Fred is 10",reviewBody),operationId:"capture-fred-02",expectedContentHash:saved.contentHash},context) as {contentHash:string};
  assert.equal((f.mutations[1].body as string).split("<!-- household-memory-review:start -->").length,2);
  await assert.rejects(()=>f.domain.execute("household_memory_synthesize",{...f.input("Fred likes blue",reviewBody),operationId:"capture-fred-03",expectedContentHash:"0".repeat(64)},context),{code:"memory_revision_conflict"});
  assert.equal(f.mutations.length,2);
  await f.domain.execute("household_memory_synthesize",{...f.input("Fred likes blue",reviewBody),operationId:"capture-fred-04",expectedContentHash:saved.contentHash},context);
  assert.equal(f.mutations[2].body,"Fred's preferences are discussed here.");assert.equal(f.mutations[2].status,"supported");
});

test("review notice cannot push a managed page beyond the complete-read bound",async()=>{
  const f=fixture("Fred likes blue");
  await assert.rejects(()=>f.domain.execute("household_memory_synthesize",f.input("Fred is 10","x".repeat(20_000)),context),{code:"managed_topic_exceeds_read_bound"});
  assert.equal(f.mutations.length,0);
});


test("a normalized fact uses an exact source quote without copying claim wording",async()=>{
  const f=fixture("Sam's position this season is goalkeeper.");
  const input=f.input("Sam plays goalkeeper");
  input.claims[0]={...input.claims[0],evidenceQuote:"Sam's position this season is goalkeeper."} as typeof input.claims[0];
  const result=await f.domain.execute("household_memory_synthesize",input,context) as {supportedClaimCount:number;result?:unknown;supportCheck:string};
  assert.equal((f.mutations[0].claims as NativeJson[])[0].status,"supported");
  assert.equal(result.supportedClaimCount,1);assert.equal("result" in result,false);
  assert.equal(result.supportCheck,"verified_source_quote_with_model_interpretation");
});

test("a forged evidence quote cannot support a normalized fact",async()=>{
  const f=fixture("Sam likes blue"),input=f.input("Sam plays goalkeeper");
  input.claims[0]={...input.claims[0],evidenceQuote:"Sam's position is goalkeeper"} as typeof input.claims[0];
  await f.domain.execute("household_memory_synthesize",input,context);
  assert.equal((f.mutations[0].claims as NativeJson[])[0].status,"candidate");
});

test("a quoted inference stays a candidate",async()=>{
  const f=fixture("Sam's position is goalkeeper"),input=f.input("Sam enjoys goalkeeping");
  input.claims[0]={...input.claims[0],evidenceQuote:"Sam's position is goalkeeper",certainty:"inference"} as typeof input.claims[0];
  await f.domain.execute("household_memory_synthesize",input,context);
  assert.equal((f.mutations[0].claims as NativeJson[])[0].status,"candidate");
});
