import { NativeDomainError } from "../native-contracts.ts";

/** Optional code-point window over the versioned text projection. */
export type GoogleBodyWindow={offset?:number;maxChars:number;version?:string};
export type GoogleMessageReadInput={messageId:string;format?:"full"|"metadata"|"attachment";bodyWindow?:GoogleBodyWindow;
  attachmentId?:string;partId?:string;filename?:string;mimeType?:string;delivery?:"inline"|"file"|"both"};
export const googleBodyWindowProperty={type:"object",additionalProperties:false,required:["maxChars"],
  description:"Optional text window. Omit for the full available body. Offsets count Unicode code points; continue with nextOffset/version.",
  properties:{offset:{type:"integer",minimum:0},maxChars:{type:"integer",minimum:1},version:{type:"string",pattern:"^sha256-v1:[a-f0-9]{64}$"}}};
function invalid():never{throw new NativeDomainError("invalid_google_read",400);}
function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=="object"||Array.isArray(v))return invalid();return v as Record<string,unknown>;}
export function googleMessageReadInput(value:unknown):GoogleMessageReadInput{
  const input=object(value);
  if(Object.keys(input).some(k=>!["messageId","format","bodyWindow","attachmentId","partId","filename","mimeType","delivery"].includes(k))||
    typeof input.messageId!=="string"||!input.messageId||!/^[A-Za-z0-9_-]+$/.test(input.messageId))return invalid();
  if(input.format!==undefined&&!["full","metadata","attachment"].includes(String(input.format)))return invalid();
  if(input.delivery!==undefined&&!["inline","file","both"].includes(String(input.delivery)))return invalid();
  const result:GoogleMessageReadInput={messageId:input.messageId,...(input.format!==undefined?{format:input.format as GoogleMessageReadInput['format']}:{})};
  if(input.delivery!==undefined)result.delivery=input.delivery as GoogleMessageReadInput['delivery'];
  if(input.format==='attachment'){
    if(input.bodyWindow!==undefined||(input.attachmentId===undefined)===(input.partId===undefined))return invalid();
    for(const key of ['attachmentId','partId','filename','mimeType'] as const){
      const v=input[key];if(v===undefined)continue;
      if(typeof v!=='string'||!v||v.includes('\0')||key==='attachmentId'&&!/^[A-Za-z0-9_-]+$/.test(v)||key==='partId'&&!/^[A-Za-z0-9._:-]+$/.test(v)||key==='mimeType'&&!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(v))return invalid();
      result[key]=v;
    }
    return result;
  }
  if(['attachmentId','partId','filename','mimeType'].some(k=>input[k]!==undefined))return invalid();
  if(input.bodyWindow!==undefined){
    if(input.format==='metadata')return invalid();
    const w=object(input.bodyWindow),offset=w.offset===undefined?0:w.offset;
    if(Object.keys(w).some(k=>!['offset','maxChars','version'].includes(k))||!Number.isSafeInteger(offset)||Number(offset)<0||
      !Number.isSafeInteger(w.maxChars)||Number(w.maxChars)<1||
      w.version!==undefined&&(typeof w.version!=='string'||!/^sha256-v1:[a-f0-9]{64}$/.test(w.version))||Number(offset)>0&&w.version===undefined)return invalid();
    result.bodyWindow={offset:Number(offset),maxChars:Number(w.maxChars),...(typeof w.version==='string'?{version:w.version}:{})};
  }
  return result;
}
