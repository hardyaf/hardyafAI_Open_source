import test from "node:test";
import assert from "node:assert/strict";
import {diagnosticToolAllowed,diagnosticToolsAllow} from "../src/task-flow/hooks.ts";
import {readFile} from "node:fs/promises";

test("diagnosis permits only empty read-only system status arguments",()=>{
  assert.ok(diagnosticToolsAllow().includes("household_diagnostics_system_status"));
  assert.equal(diagnosticToolAllowed("household_diagnostics_system_status",{}),true);
  for(const args of [null,[],{command:"change-settings"},{url:"http://private.invalid"},{repair:true}])
    assert.equal(diagnosticToolAllowed("household_diagnostics_system_status",args),false);
  for(const tool of ["exec","gateway","process","household_calendar_create"])
    assert.equal(diagnosticToolAllowed(tool,{}),false);
});
test("system status is discoverable as an optional native capability with an owning skill",async()=>{
  const manifest=JSON.parse(await readFile(new URL("../../../plugins/household-domains/openclaw.plugin.json",import.meta.url),"utf8"));
  assert.ok(manifest.contracts.tools.includes("household_diagnostics_system_status"));
  assert.deepEqual(manifest.toolMetadata.household_diagnostics_system_status,{optional:true});
  const domains=JSON.parse(await readFile(new URL("../../../skills/household-domains.json",import.meta.url),"utf8"));
  const skill=await readFile(new URL("../../../skills/"+domains.domains.diagnostics.path,import.meta.url),"utf8");
  assert.match(skill,/household_diagnostics_system_status/);
  assert.match(skill,/unavailable/);
});
