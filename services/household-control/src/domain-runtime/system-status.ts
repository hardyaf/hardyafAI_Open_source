import {lstat,realpath} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import type {BoundedProcessRunner} from "./bounded-process.ts";
import {DomainError,domainErrorCode} from "./common.ts";

export type SystemStatusReadContext={assertCurrent():void;signal?:AbortSignal};
export interface SystemStatusReader {read(context:SystemStatusReadContext):Promise<unknown>}
type StatusAuthority={audience?:string;profile?:{role:string;capabilities:readonly string[]};grant?:{enabled:boolean;domains:readonly string[];scopes:readonly string[]}};
export function systemStatusAuthorized(value:StatusAuthority):boolean {
  return value.audience==="private"&&value.profile?.role==="admin"&&value.profile.capabilities.includes("viewDiagnostics")===true&&
    value.grant?.enabled===true&&value.grant.domains.includes("diagnostics")&&value.grant.scopes.includes("personal");
}
export function assertSystemStatusAuthority(value:StatusAuthority):void {
  if(value.audience!=="private")throw new DomainError("diagnostic_private_conversation_required",{httpStatus:403});
  if(value.profile?.role!=="admin"||!value.profile.capabilities.includes("viewDiagnostics"))throw new DomainError("diagnostic_operator_required",{httpStatus:403});
  if(!value.grant?.enabled||!value.grant.domains.includes("diagnostics")||!value.grant.scopes.includes("personal"))throw new DomainError("domain_not_authorized",{httpStatus:403});
}
const collector=fileURLToPath(new URL("../../../../tools/read-system-status.py",import.meta.url));
/** The process boundary accepts no caller commands, paths, URLs or environment. */
export class LocalSystemStatusReader implements SystemStatusReader {
  private readonly runner:Pick<BoundedProcessRunner,"runJson">;
  constructor(runner:Pick<BoundedProcessRunner,"runJson">){this.runner=runner;}
  async read(context:SystemStatusReadContext):Promise<unknown>{
    context.assertCurrent();
    const info=await lstat(collector).catch(()=>null);
    if(!info?.isFile()||info.isSymbolicLink()||(info.mode&0o022)!==0||![0,process.getuid?.()].includes(info.uid)||await realpath(collector)!==collector)
      throw new DomainError("system_status_unavailable",{httpStatus:503});
    context.assertCurrent();
    return this.runner.runJson("/usr/bin/python3",["-I",collector],{timeoutMs:7000,maxBytes:32768,effect:false,
      env:{PATH:"/usr/bin:/bin",HOME:"/nonexistent",LANG:"C.UTF-8"},signal:context.signal,assertCurrent:context.assertCurrent});
  }
}
type Json=Record<string,unknown>;
const errors=new Set(["command_missing","command_timeout","command_output_limit","command_failed","invalid_response","host_metric_unavailable","owner_session_unavailable","ollama_unavailable","collection_deadline"]);
function invalid():never{throw new DomainError("system_status_invalid_response",{httpStatus:503});}
function object(value:unknown):Json{if(!value||typeof value!=="object"||Array.isArray(value))return invalid();return value as Json;}
function number(value:unknown):number{if(typeof value!=="number"||!Number.isFinite(value)||value<0)return invalid();return value;}
function integer(value:unknown):number{const n=number(value);if(!Number.isSafeInteger(n))return invalid();return n;}
function nullable(value:unknown):number|null{return value===null?null:number(value);}
function list(value:unknown):unknown[]{if(!Array.isArray(value)||value.length>16)return invalid();return value;}
function errorCode(value:unknown):{errorCode?:string}{if(value===undefined)return{};if(typeof value!=="string"||!errors.has(value))return invalid();return{errorCode:value};}
function section(value:unknown):Json{const row=object(value);if(!["ok","unavailable"].includes(String(row.status)))return invalid();return row;}
function name(value:unknown,model=false):string{
  if(typeof value!=="string"||value.length<1||value.length>160||!(model?/^[A-Za-z0-9][A-Za-z0-9._:/+-]*$/:/^[A-Za-z0-9][A-Za-z0-9 ._()+/-]*$/).test(value))return invalid();
  return value;
}
function fields(row:Json,keys:readonly string[]):Record<string,number>{return Object.fromEntries(keys.map(key=>[key,number(row[key])]));}
/** Only this closed projection can reach native model context; unknown fields vanish. */
export function projectSystemStatus(value:unknown){
  const row=object(value);
  if(row.version!==1||typeof row.observedAt!=="string"||row.observedAt.length>40||!/(?:Z|\+00:00)$/.test(row.observedAt)||!Number.isFinite(Date.parse(row.observedAt))||!["ok","partial","unavailable"].includes(String(row.status)))return invalid();
  const gpu=section(row.gpus),cpu=section(row.cpu),ram=section(row.ram),disk=section(row.disk),models=section(row.models);
  const devices=gpu.status==="ok"?list(gpu.devices).map(value=>{
    const d=object(value),memory=fields(d,["memoryUsedMiB","memoryTotalMiB","memoryFreeMiB"]),util=nullable(d.utilizationPercent);
    if(memory.memoryUsedMiB>memory.memoryTotalMiB||memory.memoryFreeMiB>memory.memoryTotalMiB||util!==null&&util>100)return invalid();
    const temperatureC=nullable(d.temperatureC),powerDrawW=nullable(d.powerDrawW),powerLimitW=nullable(d.powerLimitW);
    // Parser sanity only; these do not configure a device or impose a workload budget.
    if(temperatureC!==null&&temperatureC>200||powerDrawW!==null&&powerDrawW>100000||powerLimitW!==null&&powerLimitW>100000)return invalid();
    return{index:integer(d.index),name:name(d.name),...memory,utilizationPercent:util,temperatureC,powerDrawW,powerLimitW};
  }):undefined;
  if(devices&&new Set(devices.map(d=>d.index)).size!==devices.length)return invalid();
  const services=list(row.services).map(value=>{
    const s=object(value),scopes:Record<string,string>={native_gateway:"system",credential_ingress:"system",household_control:"user"};
    if(typeof s.id!=="string"||!Object.hasOwn(scopes,s.id)||s.scope!==scopes[s.id]||!["active","activating","inactive","failed","unknown","unavailable"].includes(String(s.status)))return invalid();
    return{id:s.id,scope:scopes[s.id],status:s.status as string,...errorCode(s.errorCode)};
  });
  if(services.length!==3||new Set(services.map(s=>s.id)).size!==3)return invalid();
  const unavailable=(section:Json)=>({status:"unavailable" as const,...errorCode(section.errorCode)});
  const projectedCpu=cpu.status==="ok"?{status:"ok" as const,logicalCores:integer(cpu.logicalCores),...fields(cpu,["load1","load5","load15"])}:unavailable(cpu);
  if(projectedCpu.status==="ok"&&projectedCpu.logicalCores<1)return invalid();
  const durationMs=number(row.durationMs);if(durationMs>6000)return invalid();
  const projectedRam=ram.status==="ok"?{status:"ok" as const,...fields(ram,["totalMiB","availableMiB","usedMiB"])}:unavailable(ram);
  const projectedDisk=disk.status==="ok"?{status:"ok" as const,path:"/" as const,...fields(disk,["totalGiB","availableGiB","usedGiB"])}:unavailable(disk);
  if(disk.status==="ok"&&disk.path!=="/")return invalid();
  if(projectedRam.status==="ok"&&(projectedRam.usedMiB>projectedRam.totalMiB||projectedRam.availableMiB>projectedRam.totalMiB))return invalid();
  if(projectedDisk.status==="ok"&&(projectedDisk.usedGiB>projectedDisk.totalGiB||projectedDisk.availableGiB>projectedDisk.totalGiB))return invalid();
  return{version:1,observedAt:row.observedAt,durationMs,status:row.status as "ok"|"partial"|"unavailable",
    gpus:gpu.status==="ok"?{status:"ok" as const,devices:devices!}:unavailable(gpu),cpu:projectedCpu,ram:projectedRam,disk:projectedDisk,services,
    // Ollama API size is resident model allocation (including cache), not GGUF file size.
    models:models.status==="ok"?{status:"ok" as const,items:list(models.items).map(value=>{const item=object(value);return{name:name(item.name,true),contextTokens:item.contextTokens===null?null:integer(item.contextTokens),modelSizeBytes:integer(item.modelSizeBytes),modelVramBytes:integer(item.modelVramBytes)};})}:unavailable(models)};
}
export async function readSystemStatus(reader:SystemStatusReader,context:SystemStatusReadContext):Promise<ReturnType<typeof projectSystemStatus>>{
  const current=()=>{if(context.signal?.aborted)throw new DomainError("operation_cancelled");context.assertCurrent();};
  current();let raw:unknown;
  try{raw=await reader.read(context);}
  catch(error){
    current();
    const code=domainErrorCode(error);
    if(context.signal?.aborted||code==="operation_cancelled")throw new DomainError("operation_cancelled");
    throw new DomainError(code==="dependency_timeout"?"system_status_timeout":code==="dependency_capacity_busy"?"system_status_busy":"system_status_unavailable",{httpStatus:503});
  }
  current();
  const result=projectSystemStatus(raw);current();return result;
}
