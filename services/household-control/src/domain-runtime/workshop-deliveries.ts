import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { createHash } from "node:crypto";
import type { ArtifactStore, ArtifactScope, ArtifactPrincipal } from "../platform/artifacts.ts";
import { buildWorkshopProfile } from "../platform/workshop-profile.ts";
import type { WorkshopConfiguration } from "../platform/workshop-profile.ts";
import { DomainError } from "./common.ts";
const run=promisify(execFile);

export function workshopFileLinks(message:unknown):string[]{
  const value=message as any;
  const text=typeof message==="string"?message:Array.isArray(value?.content)?value.content.filter((v:any)=>v.type==="text").map((v:any)=>v.text).join("\n"):"";
  const found=new Set<string>();
  for(const match of text.matchAll(/\]\((?:workshop:|sandbox:)?(\/[^\s)]+)\)|\bMEDIA:\s*(\/[^\s]+)/g)){
    const file=decodeURIComponent(match[1]??match[2]);
    if(!file.includes("\0"))found.add(path.posix.normalize(file));
  }
  return [...found];
}

/** Only the reviewed native Main environment may supply bytes; no host path is accepted from a message. */
export function selectWorkshopContainer(rows:any[],config:WorkshopConfiguration):string{
  const binds=buildWorkshopProfile(config).sandbox.docker.binds.map(value=>{
    const [Source,Destination,mode]=value.split(":");return{Source,Destination,RW:mode==="rw"};
  });
  const matches=rows.filter(row=>row.State?.Running===true&&row.Image===config.image&&
    row.Config?.Labels?.["openclaw.sandbox"]==="1"&&row.Config?.Labels?.["openclaw.sessionKey"]?.startsWith("agent:main:")&&
    binds.every(expected=>row.Mounts?.some((m:any)=>m.Type==="bind"&&m.Source===expected.Source&&m.Destination===expected.Destination&&m.RW===expected.RW))&&
    row.Mounts?.some((m:any)=>m.Type==="bind"&&m.Destination==="/workspace"&&m.Source.startsWith(config.sandboxRoot+"/"))&&
    row.Mounts?.every((m:any)=>m.Type==="bind"&&(binds.some(b=>b.Source===m.Source&&b.Destination===m.Destination)||
      (m.Destination==="/workspace"||m.Destination.startsWith("/workspace/"))&&m.Source.startsWith(config.sandboxRoot+"/"))));
  if(matches.length!==1||!/^[a-f0-9]{64}$/.test(matches[0].Id))throw new DomainError("workshop_delivery_environment_unavailable");
  return matches[0].Id;
}

export async function captureWorkshopDeliverables(options:{configuration:WorkshopConfiguration;artifacts:ArtifactStore;
  scope:ArtifactScope;principal:ArtifactPrincipal;sourceId:string;message:unknown;assertCurrent():void}){
  return captureWorkshopFiles({...options,files:workshopFileLinks(options.message)});
}
export async function captureWorkshopFiles(options:{configuration:WorkshopConfiguration;artifacts:ArtifactStore;
  scope:ArtifactScope;principal:ArtifactPrincipal;sourceId:string;files:string[];assertCurrent():void}){
  const files=options.files;if(!files.length)return[];
  if(files.some(file=>!path.posix.isAbsolute(file)||file.includes('\0')))throw new DomainError('workshop_file_path_invalid');
  options.assertCurrent();
  const listed=await run("/usr/bin/docker",["ps","-q","--no-trunc","--filter","label=openclaw.sandbox=1"],{maxBuffer:1024*1024});
  const ids=listed.stdout.trim().split(/\s+/).filter(Boolean);if(!ids.length)throw new DomainError("workshop_delivery_environment_unavailable");
  const inspected=await run("/usr/bin/docker",["inspect",...ids],{maxBuffer:4*1024*1024});options.assertCurrent();
  const container=selectWorkshopContainer(JSON.parse(inspected.stdout),options.configuration),outputs=[];
  for(const file of files){
    options.assertCurrent();
    const filename=path.posix.basename(file),extension=path.posix.extname(file).toLowerCase();
    const mimeType=extension===".pdf"?"application/pdf":extension===".json"?"application/json":extension===".csv"?"text/csv":
      [".txt",".md",".patch",".diff",".py",".js",".mjs",".ts",".toml",".yaml",".yml",".log"].includes(extension)?"text/plain":"application/octet-stream";
    outputs.push(await options.artifacts.importOutput(options.scope,options.principal,{filename,mimeType,
      idempotencyKey:"workshop:"+createHash("sha256").update(options.sourceId+"\0"+file).digest("hex")},async destination=>{
        // docker cp resolves paths inside this container. It does not follow a final symlink.
        await run("/usr/bin/docker",["cp",container+":"+file,destination],{maxBuffer:1024*1024});
      },options.assertCurrent));
  }
  return outputs;
}
