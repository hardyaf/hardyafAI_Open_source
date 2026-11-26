import { spawnSync } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { resolveRequest, validateAutomationConfig } from "./bitwarden-secret-resolver.mjs";

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const alias=/^[a-z][a-z0-9._-]{0,63}$/;
const failure=(code,outcome="not_sent")=>Object.assign(new Error(code),{code,outcome});
function secret(value){return typeof value==="string"&&value.length>0&&Buffer.byteLength(value)<=64*1024;}
function exactOrigin(value){
  try{
    const url=new URL(value);
    if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname))throw Error();
    return url.origin;
  }catch{throw failure("CREDENTIAL_ORIGIN_INVALID");}
}
function trustedFile(filename,{executableAlias=false}={}){
  if(!filename||!path.isAbsolute(filename))throw failure("CREDENTIAL_PROVIDER_UNAVAILABLE");
  const requested=path.resolve(filename),entry=lstatSync(requested),resolved=realpathSync(requested),target=lstatSync(resolved);
  const trusted=stat=>process.platform==="win32"||((stat.mode&0o022)===0&&[0,process.getuid()].includes(stat.uid));
  if(!target.isFile()||target.isSymbolicLink()||target.nlink!==1||!trusted(target)||
    executableAlias&&process.platform!=="win32"&&(target.mode&0o111)===0)throw failure("CREDENTIAL_PROVIDER_UNAVAILABLE");
  if(entry.isSymbolicLink()){
    // Standard virtualenv interpreters are aliases. Keep their invocation path
    // so Python finds pyvenv.cfg instead of silently using system site-packages.
    if(!executableAlias||process.platform!=="win32"&&![0,process.getuid()].includes(entry.uid))throw failure("CREDENTIAL_PROVIDER_UNAVAILABLE");
    for(const parent of [path.dirname(requested),path.dirname(resolved)]){
      const directory=lstatSync(realpathSync(parent));
      if(!directory.isDirectory()||!trusted(directory))throw failure("CREDENTIAL_PROVIDER_UNAVAILABLE");
    }
  }else if(!entry.isFile()||entry.nlink!==1||!trusted(entry))throw failure("CREDENTIAL_PROVIDER_UNAVAILABLE");
  return executableAlias?requested:resolved;
}
/** Trusted host connector only. Never register these methods as plaintext model tools. */
export class BitwardenCredentialConnector {
  #bindings; #environment; #invoke; #sdkInvoke; #refreshing=new Set();
  constructor({bindings,environment=process.env,invoke=spawnSync,sdkInvoke=spawnSync}){
    if(!Array.isArray(bindings))throw failure("CREDENTIAL_BINDING_INVALID");
    this.#bindings=new Map();this.#environment={...environment};this.#invoke=invoke;this.#sdkInvoke=sdkInvoke;
    for(const value of bindings){
      if(!value||!alias.test(value.id)||!uuid.test(value.secretId)||!Array.isArray(value.profileIds)||!value.profileIds.length||
        value.profileIds.some(id=>!alias.test(id))||!Array.isArray(value.uses)||value.uses.some(use=>!["provider_refresh","browser_login"].includes(use))||
        this.#bindings.has(value.id))throw failure("CREDENTIAL_BINDING_INVALID");
      const origins=(value.origins??[]).map(exactOrigin);
      if(value.uses.includes("browser_login")&&!origins.length)throw failure("CREDENTIAL_BINDING_INVALID");
      this.#bindings.set(value.id,Object.freeze({...value,profileIds:[...value.profileIds],uses:[...value.uses],origins}));
    }
  }
  #binding(id,context,use){
    context.assertCurrent();
    const binding=this.#bindings.get(id);
    if(!binding||!binding.profileIds.includes(context.profileId)||!binding.uses.includes(use))throw failure("CREDENTIAL_USE_NOT_AUTHORIZED");
    return binding;
  }
  #read(binding,context){
    context.assertCurrent();
    const result=resolveRequest({protocolVersion:1,provider:"bws",ids:[binding.secretId]},this.#environment,this.#invoke);
    context.assertCurrent();
    const value=result.values[binding.secretId];
    if(!secret(value))throw failure("CREDENTIAL_RESOLUTION_FAILED");
    return value;
  }
  /** Replacement values come from the trusted provider callback, never a prompt. */
  async refreshProvider(id,context,refresh){
    const binding=this.#binding(id,context,"provider_refresh"),key=binding.secretId.toLowerCase();
    if(this.#refreshing.has(key))throw failure("CREDENTIAL_REFRESH_IN_PROGRESS");
    this.#refreshing.add(key);
    try{return await this.#refreshProviderOwned(id,context,refresh);}finally{this.#refreshing.delete(key);}
  }
  async #refreshProviderOwned(id,context,refresh){
    const binding=this.#binding(id,context,"provider_refresh");
    // A provider may rotate its credential during refresh. Prove the authoritative
    // writeback path is ready before reading a value or calling that provider.
    const prepared=this.#prepareWriteback(binding,context),previous=this.#read(binding,context);
    let result;
    try{result=await refresh(previous);}catch{throw failure("CREDENTIAL_REFRESH_FAILED","unknown");}
    try{
      context.assertCurrent();
      if(!result||!["unchanged","replaced","reauth_required"].includes(result.status))throw failure("CREDENTIAL_REFRESH_RESULT_INVALID");
      if(result.status!=="replaced")return {bindingId:id,status:result.status,authoritativeWriteback:result.status==="unchanged"};
      if(!secret(result.value))throw failure("CREDENTIAL_REFRESH_RESULT_INVALID");
      const receipt=this.#writeback(binding,previous,result.value,context,prepared);
      return {bindingId:id,status:"replaced",authoritativeWriteback:true,revision:receipt.revision};
    }catch(error){
      // Once refresh has returned, it may already have rotated the provider token.
      // No configuration, readback, grant or transport failure means "not sent".
      const code=typeof error?.code==="string"&&/^CREDENTIAL_[A-Z_]+$/.test(error.code)?error.code:"CREDENTIAL_REFRESH_OUTCOME_UNKNOWN";
      throw failure(code,"unknown");
    }
  }
  #prepareWriteback(binding,context){
    const env=this.#environment;
    const permitted=new Set((env.BWS_ALLOWED_WRITE_SECRET_IDS??"").split(",").map(value=>value.trim().toLowerCase()));
    if(!permitted.has(binding.secretId.toLowerCase()))throw failure("CREDENTIAL_WRITE_NOT_AUTHORIZED");
    let binary,script;
    try{
      validateAutomationConfig(env.BWS_CONFIG_FILE,env.BWS_SERVER_URL);
      binary=trustedFile(env.BWS_SDK_PYTHON,{executableAlias:true});script=trustedFile(env.BWS_SDK_SCRIPT);
      if(!env.BWS_ACCESS_TOKEN||!env.BWS_SDK_API_URL||!env.BWS_SDK_IDENTITY_URL)throw Error();
      for(const endpoint of [env.BWS_SDK_API_URL,env.BWS_SDK_IDENTITY_URL]){
        const url=new URL(endpoint);if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash)throw Error();
      }
    }catch{throw failure("CREDENTIAL_WRITE_PROVIDER_UNAVAILABLE");}
    const childEnv=Object.create(null);
    for(const key of ["PATH","LANG","LC_ALL","BWS_ACCESS_TOKEN","BWS_SDK_API_URL","BWS_SDK_IDENTITY_URL","BWS_ALLOWED_WRITE_SECRET_IDS"])
      if(env[key])childEnv[key]=env[key];
    const {BWS_ACCESS_TOKEN:bootstrap,...probeEnv}=childEnv;void bootstrap;
    context.assertCurrent();
    try{
      const result=this.#sdkInvoke(binary,["-I",script,"--check"],{env:probeEnv,encoding:"utf8",timeout:5_000,maxBuffer:16*1024,windowsHide:true,shell:false});
      const readiness=JSON.parse(result.stdout);
      if(result.error||result.status!==0||readiness.status!=="ready"||readiness.sdkVersion!=="2.1.0")throw Error();
    }catch{throw failure("CREDENTIAL_WRITE_PROVIDER_UNAVAILABLE");}
    context.assertCurrent();return {binary,script,childEnv};
  }
  #writeback(binding,previous,replacement,context,{binary,script,childEnv}){
    context.assertCurrent();
    // Secrets travel through stdin, never argv, the environment, a file, or a receipt.
    let result;
    try{result=this.#sdkInvoke(binary,["-I",script],{env:childEnv,input:JSON.stringify({protocolVersion:1,id:binding.secretId,expectedValue:previous,value:replacement}),
      encoding:"utf8",timeout:8_000,maxBuffer:16*1024,windowsHide:true,shell:false});}
    catch{throw failure("CREDENTIAL_WRITEBACK_UNKNOWN","unknown");}
    context.assertCurrent();
    let receipt;
    try{receipt=JSON.parse(result.stdout);}catch{throw failure("CREDENTIAL_WRITEBACK_UNKNOWN","unknown");}
    if(result.error||result.status!==0||receipt.status!=="committed"||receipt.id?.toLowerCase()!==binding.secretId.toLowerCase()||
      typeof receipt.revision!=="string"||!Number.isFinite(Date.parse(receipt.revision)))
      throw failure(receipt.status==="conflict"?"CREDENTIAL_REVISION_CONFLICT":"CREDENTIAL_WRITEBACK_UNKNOWN","unknown");
    return {revision:receipt.revision};
  }
  /** Caller supplies an authenticated task and the browser's actual current origin. */
  async useBrowserLogin(id,context,{origin},consume){
    const binding=this.#binding(id,context,"browser_login");
    if(!context.taskId||!context.sourcePromptId||!binding.origins.includes(exactOrigin(origin)))throw failure("CREDENTIAL_BROWSER_DELEGATION_DENIED");
    let credentials;
    try{credentials=JSON.parse(this.#read(binding,context));}catch{throw failure("CREDENTIAL_LOGIN_FORMAT_INVALID");}
    if(!credentials||typeof credentials.username!=="string"||!secret(credentials.password)||
      Object.keys(credentials).some(key=>!["username","password"].includes(key)))throw failure("CREDENTIAL_LOGIN_FORMAT_INVALID");
    let result;
    try{result=await consume(Object.freeze({username:credentials.username,password:credentials.password}),
      Object.freeze({origin:exactOrigin(origin),profileId:context.profileId,taskId:context.taskId,sourcePromptId:context.sourcePromptId}));}
    catch{context.assertCurrent();throw failure("CREDENTIAL_BROWSER_OUTCOME_UNKNOWN","unknown");}
    context.assertCurrent();
    if(!["authenticated","human_required","failed"].includes(result?.status))throw failure("CREDENTIAL_BROWSER_RESULT_INVALID","unknown");
    return {bindingId:id,status:result.status};
  }
}
