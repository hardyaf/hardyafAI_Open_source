import { constants } from "node:fs";
import { access,lstat,open,realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { DocumentsError } from "./types.ts";
import type { DocumentExtractor,DocumentMode,DocumentSource,LocalExtraction,DocumentProcessRunner } from "./types.ts";

const maximumSource=25*1024*1024;
async function regular(filename:string,maxBytes:number):Promise<Buffer>{
  const file=await open(filename,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{const info=await file.stat();if(!info.isFile()||info.nlink!==1||info.size>maxBytes)throw new DocumentsError('document_output_invalid',503);return await file.readFile();}
  finally{await file.close();}
}
/** Local adapter receives bytes, never a path selected by the model or document. */
export class LocalDocumentExtractor implements DocumentExtractor{
  private readonly options:{pythonPath:string;readerScriptPath:string;cacheRoot:string;timeoutMs?:number};
  private readonly runner:DocumentProcessRunner;
  constructor(options:{pythonPath:string;readerScriptPath:string;cacheRoot:string;timeoutMs?:number},runner:DocumentProcessRunner){
    if(![options.pythonPath,options.readerScriptPath,options.cacheRoot].every(path.isAbsolute))throw new DocumentsError('document_runtime_paths_invalid',500);
    this.options=options;this.runner=runner;
  }
  async readiness(){
    try{
      const [python,reader]=await Promise.all([realpath(this.options.pythonPath),lstat(this.options.readerScriptPath)]);
      await access(python,constants.X_OK);
      if(!reader.isFile()||reader.isSymbolicLink()||reader.nlink!==1||reader.size>256*1024)throw Error('reader');
      return {status:'configured',detail:'Local executable/script readiness only; no document or OCR model has been exercised.'};
    }catch{return {status:'unavailable',detail:'Local extraction runtime is unavailable; cloud fallback is disabled.'};}
  }
  async extract(source:DocumentSource,mode:DocumentMode,execution?:{assertCurrent?:()=>void;signal?:AbortSignal}):Promise<LocalExtraction>{
    if(!Buffer.isBuffer(source.bytes)||source.bytes.length<1||source.bytes.length>maximumSource||source.byteLength!==source.bytes.length||
      createHash('sha256').update(source.bytes).digest('hex')!==source.sha256||!['application/pdf','image/png','image/jpeg','image/webp'].includes(source.mimeType)||
      !['auto','fast','structured','ocr'].includes(mode))throw new DocumentsError('document_source_invalid',400);
    if((await this.readiness()).status!=='configured')throw new DocumentsError('document_runtime_unavailable',503);
    execution?.assertCurrent?.();
    if(execution?.signal?.aborted)throw new DocumentsError('document_extraction_cancelled',409);
    const env:Record<string,string>={PATH:'/usr/bin:/bin',HOME:process.env.HOME??'',LANG:'C.UTF-8',
      HARDY_HOME_DOCUMENT_CACHE:this.options.cacheRoot,HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',TOKENIZERS_PARALLELISM:'false',
      OMP_NUM_THREADS:'4',OPENBLAS_NUM_THREADS:'4',MKL_NUM_THREADS:'4',PYTHONDONTWRITEBYTECODE:'1'};
    const response=await this.runner.runJson(this.options.pythonPath,[this.options.readerScriptPath,'--stdin-artifact','--mode',mode,'--max-output-chars','12000'],{
      env,timeoutMs:Math.min(360000,Math.max(1000,this.options.timeoutMs??330000)),maxBytes:2*1024*1024,
      input:JSON.stringify({mime_type:source.mimeType,content_base64:source.bytes.toString('base64')}),signal:execution?.signal,assertCurrent:execution?.assertCurrent,effect:false,
    });
    if(!response||typeof response!=='object'||Array.isArray(response))throw new DocumentsError('document_reader_result_invalid',503);
    const result=response as Record<string,unknown>;
    if(result.ok!==true||result.source_sha256!==source.sha256||typeof result.engine!=='string'||result.engine.length>100||
      !Number.isSafeInteger(result.page_count)||Number(result.page_count)<1||Number(result.page_count)>100||
      !Array.isArray(result.warnings)||result.warnings.length>100||result.warnings.some(item=>typeof item!=='string'||item.length>2000))throw new DocumentsError('document_reader_result_invalid',503);
    const directory=path.resolve(this.options.cacheRoot,source.sha256);
    const expectedMarkdown=new Set([path.join(directory,'fast.md'),path.join(directory,'structured.md')]);
    const expectedJson=new Set([path.join(directory,'fast.json'),path.join(directory,'structured.json')]);
    if(typeof result.markdown_path!=='string'||!expectedMarkdown.has(result.markdown_path)||typeof result.json_path!=='string'||!expectedJson.has(result.json_path))throw new DocumentsError('document_output_path_invalid',503);
    const directoryStat=await lstat(directory);
    if(!directoryStat.isDirectory()||directoryStat.isSymbolicLink()||await realpath(directory)!==directory)throw new DocumentsError('document_output_path_invalid',503);
    const [markdown,json]=await Promise.all([regular(result.markdown_path,5*1024*1024),regular(result.json_path,10*1024*1024)]);
    let structured:unknown;try{structured=JSON.parse(json.toString('utf8'));}catch{throw new DocumentsError('document_structured_output_invalid',503);}
    return {engine:result.engine,pageCount:Number(result.page_count),sourceSha256:source.sha256,text:markdown.toString('utf8'),structured,warnings:result.warnings as string[]};
  }
}
