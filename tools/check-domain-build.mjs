import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve,dirname } from "node:path";
import { fileURLToPath,pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { domainCatalog } from "../services/household-control/src/domain-runtime/catalog.ts";
import { taskToolDescriptors } from "../services/household-control/src/task-flow/catalog.ts";
import { analysisToolDescriptors } from "../services/household-control/src/analysis-flow/catalog.ts";
import { nativeToolName } from "../services/household-control/src/domain-runtime/common.ts";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const require=createRequire(resolve(root,"services/household-control/package.json"));
const Ajv=require("ajv").default??require("ajv");
const ajv=new Ajv({strict:true,allErrors:false,coerceTypes:false,useDefaults:false,removeAdditional:false,validateFormats:false,ownProperties:true});
const descriptors=[...domainCatalog,...[...taskToolDescriptors,...analysisToolDescriptors].map(tool=>({...tool,nativeName:nativeToolName(tool.name),domain:tool.name.split(".")[0]}))];
if(new Set(descriptors.map(tool=>tool.nativeName)).size!==descriptors.length)throw Error("duplicate_native_tool_contract");
for(const tool of descriptors)ajv.compile(tool.inputSchema);
const pluginRoot=resolve(root,"plugins/household-domains");
const manifest=JSON.parse(readFileSync(resolve(pluginRoot,"openclaw.plugin.json"),"utf8"));
if(JSON.stringify([...manifest.contracts.tools].sort())!==JSON.stringify(descriptors.map(tool=>tool.nativeName).sort()))throw Error("plugin_tool_contract_mismatch");
if(descriptors.some(tool=>manifest.toolMetadata[tool.nativeName]?.optional!==true))throw Error("plugin_optional_tool_metadata_mismatch");
for(const file of ["plugins/household-domains/index.mjs","plugins/household-domains/native-task-hooks.mjs","plugins/household-domains/native-analysis.mjs","tools/check-domain-build.mjs"]){
  const checked=spawnSync(process.execPath,["--check",resolve(root,file)],{encoding:"utf8",timeout:30_000});
  if(checked.status!==0)throw Error("domain_build_syntax_failed");
}
const plugin=(await import(pathToFileURL(resolve(pluginRoot,"index.mjs")))).default;
if(plugin.id!=="hardy-household" || typeof plugin.register!=="function")throw Error("native_plugin_export_invalid");
const contract=JSON.parse(readFileSync(resolve(root,"contracts/household-api/openapi.json"),"utf8"));
// HTTP contract version changes with its public schema, independently of the service implementation version.
if(!contract.paths["/v1/admin/domains"]?.get || !contract.paths["/v1/conversations/{conversationId}/workspace"]?.get ||
  !contract.paths["/v1/display/snapshot"]?.get)throw Error("domain_http_contract_missing");
process.stdout.write(JSON.stringify({status:"domain_build_ready",toolCount:descriptors.length,domains:[...new Set(descriptors.map(tool=>tool.domain))],
  pluginImport:true,schemaCompilation:true,functionalTestsRun:false})+"\n");
