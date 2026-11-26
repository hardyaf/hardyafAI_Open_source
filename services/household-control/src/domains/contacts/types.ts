export type ContactAudience = "private" | "household";
export type ContactAction = "revise" | "ocr_redo" | "change_audience";
export type ContactPrincipal = {
  profileId: string; agentId: string; conversationId: string; taskId: string;
  audience: ContactAudience; canReadHousehold: boolean; canWriteHousehold: boolean; canEditContacts: boolean;
  sourcePromptId?: string; sourcePromptCreatedAt?: string;
  assertCurrent?: () => void;
  allowedArtifactIds?: readonly string[];
  userPromptBinding?: {
    promptId: string; conversationId: string; taskId: string;
    targetContactId: string; expectedRevision: number; allowedActions: readonly ContactAction[];
  };
};
export const contactFieldNames = ["full_name", "organization", "job_title", "email", "phone", "website", "address", "notes"] as const;
export type ContactField = typeof contactFieldNames[number];
export type ContactFields = Partial<Record<ContactField, string[]>>;
export type ContactObservation = {
  field: ContactField; value: string; sourceArtifactId: string;
  page?: number; blockId?: string; quote?: string; confidence?: number; inferred?: boolean; extractionArtifactId?: string;
};
/** Capture/redo may bind a supporting quote to one already authorized source. */
export type ContactObservationInput = Omit<ContactObservation,"sourceArtifactId"> & {sourceArtifactId?:string};
export type ContactSource = {
  artifactId: string; sha256: string; mimeType: string; byteLength: number; filename: string;
  audience: ContactAudience; ownerProfileId: string; conversationId: string; taskId: string;
};
export interface ContactsSourceAccess {
  inspect(principal: ContactPrincipal, artifactId: string): Promise<ContactSource>;
  publishCardSource(principal: ContactPrincipal, source: ContactSource, audience: ContactAudience, operationId: string): Promise<ContactSource>;
}
/** Evidence resolved by the Documents owner through an injected application port. */
export type ContactExtractionEvidence =
  | {state:"extracted";sourceArtifactId:string;sourceSha256:string;extractionArtifactId:string;text:string;pageCount:number;warnings:string[];executionOperationId?:string}
  | {state:"failed"|"unavailable";sourceArtifactId:string;sourceSha256?:string;warnings:string[]};
export interface ContactsExtractionAccess {
  resolve(principal:ContactPrincipal,sourceArtifactIds:readonly string[],extractionArtifactIds:readonly string[],operationId:string,options?:{fresh:boolean}):Promise<ContactExtractionEvidence[]>;
}
export type ContactExtractionSummary={sourceArtifactId:string;state:"extracted"|"failed"|"unavailable";extractionArtifactId?:string};
export type ContactRevision = {
  revision: number; fields: ContactFields; observations: ContactObservation[]; uncertainties: string[];
  reason: "initial_scan" | "correction" | "ocr_redo" | "enrichment" | "scope_change";
  actorProfileId: string; promptId: string | null; createdAt: string;
};
export type ContactRecord = {
  id: string; cardId: string; ownerProfileId: string; audience: ContactAudience;
  currentRevision: number; createdAt: string; updatedAt: string;
  fields: ContactFields; observations: ContactObservation[]; uncertainties: string[];
  sources: Array<Pick<ContactSource, "artifactId" | "sha256" | "mimeType" | "byteLength" | "filename">>;
};
export type ContactReceipt = {
  operationId: string; contactId: string; cardId: string; revision: number;
  audience: ContactAudience; saved: true; readableFieldCount: number; warnings: string[];
  extraction?:ContactExtractionSummary[]; scanState?:"fields_saved"|"source_saved_only"|"extraction_failed"|"extraction_unavailable";
};
export type ContactMutationResult = { receipt: ContactReceipt; contact: ContactRecord; replayed: boolean };
export type CaptureCardInput = {
  operationId: string; sourceArtifactIds: string[]; audience?: ContactAudience;
  fields?: ContactFields; observations?: ContactObservationInput[]; uncertainties?: string[]; extractionArtifactIds?:string[];
};
export type ReviseContactInput = {
  operationId: string; contactId: string; expectedRevision?: number; fields?: ContactFields;
  patch?: {set?:ContactFields;remove?:ContactField[]};
  observations?: ContactObservationInput[]; uncertainties?: string[]; extractionArtifactIds?:string[]; reason: "correction" | "ocr_redo" | "enrichment";
};
export class ContactsError extends Error {
  readonly code:string;
  readonly statusCode:number;
  constructor(code: string, statusCode = 409) { super(code); this.name = "ContactsError"; this.code=code;this.statusCode=statusCode; }
}
