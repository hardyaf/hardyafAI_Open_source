import test from "node:test";
import type {TestContext} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {HouseholdDatabase} from "../src/database.ts";

function persistentFixture(t: TestContext) {
  const directory=mkdtempSync(join(tmpdir(),"hardy-home-profile-privacy-"));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  return join(directory,"fixture.sqlite");
}

test("new databases use neutral display labels without changing stable identity or policy",()=>{
  const database=new HouseholdDatabase(":memory:");
  try {
    assert.deepEqual(database.listProfiles().map(({id,displayName,initials,agentId,role})=>({id,displayName,initials,agentId,role})),[
      {id:"alex",displayName:"Owner",initials:"OW",agentId:"main",role:"admin"},
      {id:"natasha",displayName:"Adult",initials:"AD",agentId:"natasha",role:"adult"},
      {id:"fred",displayName:"Child One",initials:"C1",agentId:"fred",role:"child"},
      {id:"belle",displayName:"Child Two",initials:"C2",agentId:"belle",role:"child"},
    ]);
  } finally {database.close();}
});

test("reopening preserves stored display names and initials for every existing profile",t=>{
  const filename=persistentFixture(t);let database=new HouseholdDatabase(filename);
  const expected=database.listProfiles().map((profile,index)=>({id:profile.id,displayName:`Retained fixture ${index+1}`,initials:`R${index+1}`}));
  for(const row of expected)database.domainConnection().prepare("UPDATE profiles SET display_name=?,initials=? WHERE id=?").run(row.displayName,row.initials,row.id);
  database.close();database=new HouseholdDatabase(filename);
  try {assert.deepEqual(database.listProfiles().map(({id,displayName,initials})=>({id,displayName,initials})),expected);}
  finally {database.close();}
});

test("preserving display metadata keeps existing policy refresh and held status behavior",t=>{
  const filename=persistentFixture(t);let database=new HouseholdDatabase(filename);
  database.domainConnection().prepare("UPDATE profiles SET display_name=?,initials=?,agent_id=?,role=?,color=?,capabilities_json=?,status=?,status_detail=? WHERE id=?")
    .run("Retained owner fixture","RF","obsolete-fixture","child","#000000",JSON.stringify(["chat"]),"offline","Fixture hold","alex");
  database.close();database=new HouseholdDatabase(filename);
  try {
    const owner=database.getProfile("alex")!;
    assert.equal(owner.displayName,"Retained owner fixture");assert.equal(owner.initials,"RF");
    assert.equal(owner.agentId,"main");assert.equal(owner.role,"admin");assert.equal(owner.color,"#3559E0");
    assert.deepEqual(owner.capabilities,["chat","voiceInput","attachImages","viewHouseholdStatus","viewDiagnostics","manageAccess"]);
    assert.equal(owner.status,"offline");assert.equal(owner.statusDetail,"Fixture hold");
  } finally {database.close();}
});
