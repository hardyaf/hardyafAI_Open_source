import {NativeExecutionPolicies} from "../platform/native-execution.ts";
import path from "node:path";
import { HouseholdDatabase } from "../database.ts";
import { OpenClawAgentAdapter } from "../openclaw-adapter.ts";
import { ArtifactStore } from "../platform/artifacts.ts";
import { loadDomainConfiguration,readProtectedEnvironment } from "./configuration.ts";
import { HouseholdDomainRuntime } from "./runtime.ts";
import { DomainError } from "./common.ts";
import { ConnectedGoogleClient } from "./connected-google.ts";

/** Native plugin composition root. It owns and closes every resource it constructs. */
export async function createOwnedDomainRuntime(options:{controlEnvironmentPath:string;configurationPath:string;nativeSandboxCheck?:(sessionKey:string,agentId:string)=>Promise<void>}){
  const [environment,configuration]=await Promise.all([readProtectedEnvironment(options.controlEnvironmentPath),loadDomainConfiguration(options.configurationPath)]);
  const databasePath=environment.HARDY_HOME_DATABASE;
  if(!databasePath || !path.isAbsolute(databasePath) || !environment.OPENCLAW_GATEWAY_URL || !environment.OPENCLAW_GATEWAY_TOKEN)
    throw new DomainError("domain_runtime_configuration_missing",{httpStatus:503});
  const database=new HouseholdDatabase(databasePath);
  let adapter:OpenClawAgentAdapter|undefined,runtime:HouseholdDomainRuntime|undefined;
  try{
    const artifacts=new ArtifactStore({root:environment.HARDY_HOME_ARTIFACT_ROOT??path.join(path.dirname(databasePath),"artifacts")});
    await artifacts.initialize();
    adapter=new OpenClawAgentAdapter({url:environment.OPENCLAW_GATEWAY_URL,token:environment.OPENCLAW_GATEWAY_TOKEN,restrictedSessionCheck:options.nativeSandboxCheck,restrictedRuntimeCheck:(agentId)=>new NativeExecutionPolicies({configPath:configuration.execution.nativeConfigPath,image:configuration.execution.sandboxImage}).assertReady(agentId)});
    runtime=new HouseholdDomainRuntime({database,adapter,artifacts,configuration,nativeSandboxCheck:options.nativeSandboxCheck,
      connectedGoogle:environment.HARDY_CREDENTIALS_CONSUMER_SOCKET ? new ConnectedGoogleClient(environment.HARDY_CREDENTIALS_CONSUMER_SOCKET) : undefined});
    runtime.configureScheduledDeliveryPolicyReader(()=>loadDomainConfiguration(options.configurationPath));
    // Connecting here could deadlock Gateway startup; the existing bounded client connects on first admitted call.
    return {runtime,async close(){await runtime!.close();await adapter!.close();database.close();}};
  }catch(error){await runtime?.close();await adapter?.close();database.close();throw error;}
}
