import {resolveSandboxRuntimeStatus} from "openclaw/plugin-sdk/sandbox";
import {definePluginEntry} from "openclaw/plugin-sdk/plugin-entry";
import {domainCatalog} from "../../services/household-control/src/domain-runtime/catalog.ts";
import {taskToolDescriptors} from "../../services/household-control/src/task-flow/catalog.ts";
import {analysisToolDescriptors} from "../../services/household-control/src/analysis-flow/catalog.ts";
import {createOwnedDomainRuntime} from "../../services/household-control/src/domain-runtime/owned-runtime.ts";
import {nativeToolName} from "../../services/household-control/src/domain-runtime/common.ts";
import {registerHouseholdRuntime} from "./native-runtime.mjs";
import {spawnNativeAnalysis} from "./native-analysis.mjs";

const descriptors=[...domainCatalog,...[...taskToolDescriptors,...analysisToolDescriptors].map(tool=>({...tool,nativeName:nativeToolName(tool.name),domain:tool.name.split(".")[0]}))];
export default definePluginEntry({id:"hardy-household",name:"Hardy household capabilities",description:"Scoped household reasoning, native continuation and owned data authorities.",
  register(api){registerHouseholdRuntime(api,{descriptors,createOwned:createOwnedDomainRuntime,spawnNativeAnalysis,resolveSandboxRuntimeStatus});}});
