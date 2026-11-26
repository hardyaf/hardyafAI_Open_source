import {constants} from "node:fs";
import {open} from "node:fs/promises";
import {createServer, type Server as HttpsServer} from "node:https";
import type {Server as HttpServer} from "node:http";
import path from "node:path";

async function protectedPem(filename:string):Promise<Buffer> {
  if(!path.isAbsolute(filename))throw new Error("tls_configuration_unavailable");
  const handle=await open(filename,constants.O_RDONLY|(constants.O_NOFOLLOW??0)).catch(()=>null);
  if(!handle)throw new Error("tls_configuration_unavailable");
  try{
    const stat=await handle.stat();
    if(!stat.isFile()||stat.nlink!==1||stat.size>256*1024||stat.size<32||
      process.platform!=="win32"&&((stat.mode&0o077)!==0||stat.uid!==process.getuid?.()))
      throw new Error("tls_configuration_unavailable");
    const bytes=await handle.readFile();
    if(bytes.length!==stat.size)throw new Error("tls_configuration_unavailable");
    return bytes;
  }finally{await handle.close();}
}
/** A second transport over the same application handler, identity, state and lifecycle. */
export async function createSecureListener(application:HttpServer,options:{certificate:string;privateKey:string}):Promise<HttpsServer>{
  const [cert,key]=await Promise.all([protectedPem(options.certificate),protectedPem(options.privateKey)]);
  try{
    return createServer({cert,key,minVersion:"TLSv1.2",requestTimeout:60_000,headersTimeout:15_000},
      (request,response)=>{application.emit("request",request,response);});
  }catch{throw new Error("tls_configuration_unavailable");}
}
