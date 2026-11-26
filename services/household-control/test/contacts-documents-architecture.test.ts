import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync,readdirSync} from "node:fs";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";

const sourceRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../src/domains');
test('Contacts/Documents keep composition, provider and cross-domain imports behind their boundaries',()=>{
  for(const domain of ['contacts','documents'])for(const name of readdirSync(join(sourceRoot,domain))){
    if(!name.endsWith('.ts'))continue;
    const text=readFileSync(join(sourceRoot,domain,name),'utf8');
    assert.ok(text.split('\n').length<800,domain+'/'+name+' must remain cohesive and bounded');
    assert.doesNotMatch(text,/from\s+["'][^"']*(?:server|runtime|database)\.ts["']/);
    assert.doesNotMatch(text,/from\s+["']\.\.\/(?:contacts|documents|receipts|calendar|email)\//);
    assert.doesNotMatch(text,/from\s+["'](?:@google|googleapis|docling|paddleocr|ollama|node:child_process)/);
    assert.doesNotMatch(text,/constructor\s*\(\s*(?:private|protected|public|readonly)\s/);
  }
});
