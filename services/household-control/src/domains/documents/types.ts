export type DocumentMode="auto"|"fast"|"structured"|"ocr";
export type DocumentPrincipal={
  profileId:string;agentId:string;conversationId:string;taskId:string;audience:"private"|"household";
  canReadHousehold:boolean;canProcessDocuments:boolean;allowedArtifactIds?:readonly string[];
  assertCurrent?:()=>void;signal?:AbortSignal;
};
export type DocumentSource={artifactId:string;sha256:string;mimeType:string;byteLength:number;bytes:Buffer};
export type LocalExtraction={engine:string;pageCount:number;sourceSha256:string;text:string;structured:unknown;warnings:string[]};
export interface DocumentExtractor{
  readiness():Promise<{status:string;detail:string}>;
  extract(source:DocumentSource,mode:DocumentMode,execution?:{assertCurrent?:()=>void;signal?:AbortSignal}):Promise<LocalExtraction>;
}
export interface DocumentProcessRunner{
  runJson(binary:string,args:string[],options?:{cwd?:string;timeoutMs?:number;maxBytes?:number;input?:string|Buffer;env?:Record<string,string>;
    signal?:AbortSignal;assertCurrent?:()=>void;effect?:boolean}):Promise<unknown>;
}
export type SavedExtraction={schemaVersion:1;requestFingerprint:string;sourceArtifactId:string;sourceSha256:string;mode:DocumentMode;engine:string;
  pageCount:number;text:string;structured:unknown;warnings:string[];createdAt:string;trust:"untrusted_document_data"};
export interface DocumentArtifacts{
  source(principal:DocumentPrincipal,artifactId:string):Promise<DocumentSource>;
  find(principal:DocumentPrincipal,operationId:string):Promise<{artifactId:string;result:SavedExtraction}|undefined>;
  publish(principal:DocumentPrincipal,operationId:string,result:SavedExtraction):Promise<{artifactId:string;result:SavedExtraction}>;
  result(principal:DocumentPrincipal,artifactId:string):Promise<SavedExtraction>;
}
export class DocumentsError extends Error{
  readonly code:string;readonly statusCode:number;
  constructor(code:string,statusCode=409){super(code);this.name="DocumentsError";this.code=code;this.statusCode=statusCode;}
}
