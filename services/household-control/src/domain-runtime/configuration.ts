import { open, lstat, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { DomainError } from "./common.ts";
import type { ProfileDomainGrant } from "./native-scope.ts";

export type DomainConfiguration = {
  version: 1;
  fitbit?: import("../fitbit/contracts.ts").FitbitConfiguration;
  profiles: Record<string,ProfileDomainGrant>;
  capture: { python:string; script:string; workspaces:Record<string,string> };
  google: { gogBinary:string; account:string; client:string; calendarId:string; timezone:string };
  memory: { workspaces:Record<string,string>; sharedAgentId:string; wikiVaults:Record<string,string> };
  execution: { skillsRoot:string; nativeConfigPath:string; openclawBinary:string; sandboxImage:string; sandboxRoots:string[]; workshop?: {ownerProfileId:string; image:string; sandboxRoot:string; dataRoot:string}; nativeEntries:import("./native-admission.ts").NativeEntryRule[]; notificationTargets?:Record<string,import("../domains/native-contracts.ts").NativeDeliveryTarget>; queuedNoticePolicy?:"finish_accepted"|"recheck_each_attempt"; schedulingEnabled:boolean };
  documents: { python:string; script:string; cacheRoot:string };
  uplift: { python:string; moduleRoot:string; database:string; vaultRoot:string };
};
function record(value: unknown): Record<string,unknown> {
  if(!value || typeof value!=="object" || Array.isArray(value))throw new DomainError("domain_configuration_invalid",{httpStatus:503});
  return value as Record<string,unknown>;
}
function text(value: unknown): string {
  if(typeof value!=="string" || !value || value.length>4096 || value.includes("\0"))throw new DomainError("domain_configuration_invalid",{httpStatus:503});
  return value;
}
function absolute(value:unknown):string {const result=text(value);if(!path.isAbsolute(result))throw new DomainError("domain_configuration_invalid",{httpStatus:503});return result;}
function strings(value:unknown):string[] {
  if(!Array.isArray(value) || value.length>500 || value.some(item=>typeof item!=="string" || !item || item.length>300))throw new DomainError("domain_configuration_invalid",{httpStatus:503});
  return [...value];
}
function workspaces(value:unknown):Record<string,string>{return Object.fromEntries(Object.entries(record(value)).map(([key,item])=>{
  if(!/^[a-z][a-z0-9-]{0,63}$/.test(key))throw new DomainError("domain_configuration_invalid",{httpStatus:503});return [key,absolute(item)];
}));}
async function privateFile(filename:string,maxBytes:number):Promise<string>{
  if(!path.isAbsolute(filename))throw new DomainError("protected_configuration_required",{httpStatus:503});
  const handle=await open(filename,constants.O_RDONLY|(constants.O_NOFOLLOW??0)).catch(()=>null);
  if(!handle)throw new DomainError("protected_configuration_unavailable",{httpStatus:503});
  try{
    const stat=await handle.stat();
    let rootManaged = false;
    // User-service mount namespaces can report host root as an unmapped UID.
    // Compare the exact protected path against that namespace's filesystem root.
    const rootOwner = process.platform === "win32" ? undefined : (await lstat("/")).uid;
    if (process.platform !== "win32" && filename === "/etc/hardy-home-credentials/domains.json" &&
        stat.uid === rootOwner && (stat.mode & 0o777) === 0o440) {
      const parents = await Promise.all(["/etc", "/etc/hardy-home-credentials"].map(async directory => {
        const entry = await lstat(directory);
        return entry.isDirectory() && !entry.isSymbolicLink() && entry.uid === rootOwner &&
          (entry.mode & 0o022) === 0 && await realpath(directory) === directory;
      }));
      rootManaged = parents.every(Boolean);
    }
    if(!stat.isFile() || stat.nlink!==1 || stat.size>maxBytes ||
      (process.platform!=="win32" && !rootManaged && ((stat.mode&0o077)!==0 || stat.uid!==process.getuid?.())))
      throw new DomainError("protected_configuration_unavailable",{httpStatus:503});
    const buffer=Buffer.alloc(maxBytes+1);let count=0;
    while(count<buffer.length){const {bytesRead}=await handle.read(buffer,count,buffer.length-count,count);if(!bytesRead)break;count+=bytesRead;}
    if(count>maxBytes || count!==stat.size)throw new DomainError("protected_configuration_unavailable",{httpStatus:503});
    return buffer.subarray(0,count).toString("utf8");
  }finally{await handle.close();}
}
function parseExecution(value:unknown):DomainConfiguration["execution"]{
  const data=record(value),entries=data.nativeEntries??[];
  if(!Array.isArray(entries)||entries.length>50)throw new DomainError("domain_configuration_invalid");
  const nativeEntries=entries.map(raw=>{const rule=record(raw);
    if(!["private","household"].includes(String(rule.audience)))throw new DomainError("domain_configuration_invalid");
    return {profileId:text(rule.profileId),externalUserId:text(rule.externalUserId),channelId:text(rule.channelId),agentId:text(rule.agentId),audience:rule.audience as "private"|"household",brainDump:rule.brainDump===true};});
  const notificationTargets:NonNullable<DomainConfiguration["execution"]["notificationTargets"]>={};
  for(const [profileId,raw] of Object.entries(record(data.notificationTargets??{}))){
    const target=record(raw),channel=text(target.channel),to=text(target.to);
    if(channel!=="discord"||target.audience!=="private"||!nativeEntries.some(rule=>rule.profileId===profileId&&rule.channelId===to.replace(/^channel:/,"")&&rule.audience==="private"))throw new DomainError("domain_notification_route_invalid");
    notificationTargets[profileId]={channel,to:"channel:"+to.replace(/^channel:/,""),audience:"private",...(target.accountId?{accountId:text(target.accountId)}:{})};
  }
  const queuedNoticePolicy=data.queuedNoticePolicy??"finish_accepted";
  if(!["finish_accepted","recheck_each_attempt"].includes(String(queuedNoticePolicy)))throw new DomainError("domain_delivery_policy_invalid");
  let workshop: DomainConfiguration["execution"]["workshop"];
  if (data.workshop !== undefined) { const value = record(data.workshop);
    if (Object.keys(value).some(key => !["ownerProfileId", "image", "sandboxRoot", "dataRoot"].includes(key)) || !/^[a-z][a-z0-9-]{0,63}$/.test(String(value.ownerProfileId))) throw new DomainError("workshop_configuration_invalid");
    workshop = { ownerProfileId: text(value.ownerProfileId), image: text(value.image), sandboxRoot: absolute(value.sandboxRoot), dataRoot:absolute(value.dataRoot) };
  }
  return {...(workshop ? {workshop} : {}),notificationTargets,queuedNoticePolicy:queuedNoticePolicy as "finish_accepted"|"recheck_each_attempt",skillsRoot:absolute(data.skillsRoot),nativeConfigPath:absolute(data.nativeConfigPath),openclawBinary:absolute(data.openclawBinary),sandboxImage:text(data.sandboxImage),sandboxRoots:strings(data.sandboxRoots).map(absolute),nativeEntries,schedulingEnabled:data.schedulingEnabled===true};
}
export async function loadDomainConfiguration(filename:string):Promise<DomainConfiguration>{
  let data:Record<string,unknown>;
  try{data=record(JSON.parse(await privateFile(filename,256*1024)));}catch(error){if(error instanceof DomainError)throw error;throw new DomainError("domain_configuration_invalid",{httpStatus:503});}
  if(data.version!==1)throw new DomainError("domain_configuration_version_unsupported",{httpStatus:503});
  const profiles:Record<string,ProfileDomainGrant>={};
  for(const [id,value] of Object.entries(record(data.profiles))){
    if(!/^[a-z][a-z0-9-]{0,63}$/.test(id))throw new DomainError("domain_configuration_invalid",{httpStatus:503});
    const grant=record(value),scopes=strings(grant.scopes);
    if(scopes.some(scope=>!["personal","household"].includes(scope)))throw new DomainError("domain_configuration_invalid",{httpStatus:503});
    profiles[id]={enabled:grant.enabled===true,domains:strings(grant.domains),scopes:scopes as ProfileDomainGrant["scopes"],
      contactEditing:grant.contactEditing===true,projectCodes:strings(grant.projectCodes),canManageProjects:grant.canManageProjects===true,
      canReviewReceipts:grant.canReviewReceipts===true,allowedAttendees:strings(grant.allowedAttendees),sharedDomains:strings(grant.sharedDomains??[])};
  }
  const capture=record(data.capture),google=record(data.google),memory=record(data.memory),documents=record(data.documents),uplift=record(data.uplift);
  const configuration:DomainConfiguration={version:1,profiles,capture:{python:absolute(capture.python),script:absolute(capture.script),workspaces:workspaces(capture.workspaces)},
    google:{gogBinary:absolute(google.gogBinary),account:text(google.account),client:text(google.client),calendarId:text(google.calendarId),timezone:text(google.timezone)},
    memory:{workspaces:workspaces(memory.workspaces),sharedAgentId:text(memory.sharedAgentId),wikiVaults:workspaces(memory.wikiVaults??{})},
    execution:parseExecution(data.execution),
    documents:{python:absolute(documents.python),script:absolute(documents.script),cacheRoot:absolute(documents.cacheRoot)},
    uplift:{python:absolute(uplift.python),moduleRoot:absolute(uplift.moduleRoot),database:absolute(uplift.database),vaultRoot:absolute(uplift.vaultRoot)}};
  if (data.fitbit !== undefined) {
    const fitbit = record(data.fitbit), bindings: NonNullable<DomainConfiguration["fitbit"]>["profiles"] = {};
    const used = new Set<string>();
    for (const [id, value] of Object.entries(record(fitbit.profiles))) {
      const binding = record(value), guestId = text(binding.guestId);
      if (!profiles[id] || !["guest1","guest2"].includes(guestId) || used.has(guestId) || Object.keys(binding).some(key => key !== "guestId"))
        throw new DomainError("fitbit_configuration_invalid", {httpStatus:503});
      used.add(guestId); bindings[id] = {guestId:guestId as "guest1"|"guest2"};
    }
    if (Object.keys(fitbit).some(key => !["controller","profiles","locationLabel"].includes(key)) || used.size > 2)
      throw new DomainError("fitbit_configuration_invalid", {httpStatus:503});
        const locationLabel = fitbit.locationLabel === undefined ? undefined : text(fitbit.locationLabel);
    if (locationLabel && (locationLabel.length > 80 || /[\p{Cc}]/u.test(locationLabel))) throw new DomainError("fitbit_configuration_invalid",{httpStatus:503});
    configuration.fitbit = {controller:absolute(fitbit.controller),profiles:bindings,...(locationLabel?{locationLabel}:{})};
  }
  // This object originates in protected operator configuration and is never merged with tool arguments.
  return configuration;
}
export async function readProtectedEnvironment(filename:string):Promise<Record<string,string>>{
  const result:Record<string,string>={};
  for(const line of (await privateFile(filename,128*1024)).split(/\r?\n/)){
    if(!line.trim() || line.trimStart().startsWith("#"))continue;
    const match=/^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);if(!match)throw new DomainError("protected_environment_invalid",{httpStatus:503});
    let value=match[2];
    if((value.startsWith('"')&&value.endsWith('"')) || (value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);
    result[match[1]]=value;
  }
  return result;
}
