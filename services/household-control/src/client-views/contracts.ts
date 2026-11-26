import type { IncomingMessage, ServerResponse } from "node:http";
import type { Conversation, FamilyProfile, HouseholdNativeProgress } from "../domain.ts";
import type { HouseholdStoreApi } from "../household-store.ts";
import type { ArtifactStore } from "../platform/artifacts.ts";

export type ClientViewName = "contacts" | "lists" | "wiki" | "receipts";
export type ClientReadScope = "personal" | "household";

/** Fixed read operations, selected by the HTTP adapter, never by a client tool name. */
export type ClientReadQuery =
  | { kind: "contacts.search"; query: string; limit: number }
  | { kind: "contacts.get"; contactId: string }
  | { kind: "contacts.revisions"; contactId: string; limit: number }
  | { kind: "lists.read"; scope: ClientReadScope }
  | { kind: "wiki.search"; scope: ClientReadScope; query: string; limit: number }
  | { kind: "wiki.get"; scope: ClientReadScope; lookup: string }
  | { kind: "receipts.review"; limit: number };

/** Root injects the domain runtime's narrow read adapter; it rechecks current grants. */
export interface ClientReadonlyQueries {
  query(profileId: string, request: ClientReadQuery, assertCurrent: () => void, signal?: AbortSignal): Promise<unknown>;
  availableViews(profileId: string, assertCurrent: () => void): Promise<readonly ClientViewName[]> | readonly ClientViewName[];
}
export type ClientRouteContext = {
  profile: FamilyProfile;
  device: { deviceId: string; kind: string };
};
export type ClientViewDependencies = {
  store: HouseholdStoreApi;
  artifacts: Pick<ArtifactStore, "get" | "read" | "list">;
  reads: ClientReadonlyQueries;
  /** Must revalidate the enrolled device and current profile/capability binding. */
  assertCurrent(context: ClientRouteContext): void;
  progress?(profile: FamilyProfile, conversation: Conversation, assertCurrent: () => void): Promise<HouseholdNativeProgress | null>;
};
export type ClientViewRoute = (request: IncomingMessage, response: ServerResponse, url: URL, bytes: Buffer, context: ClientRouteContext) => Promise<boolean>;

export class ClientViewError extends Error {
  readonly code: string;
  readonly statusCode: number;
  constructor(code: string, statusCode = 400) { super(code); this.name = "ClientViewError"; this.code = code; this.statusCode = statusCode; }
}
