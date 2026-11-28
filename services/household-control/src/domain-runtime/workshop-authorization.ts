import type { AuthorizedScope } from "./native-scope.ts";

/** Existing profile/grant/source owners supply all authority; no workshop identity store. */
export function workshopAuthorized(ownerProfileId: string | undefined,
  profile: { id: string; role: string } | undefined, scope: AuthorizedScope | undefined): boolean {
  scope?.principal.assertCurrent();
  return Boolean(ownerProfileId && scope && profile?.role === "admin" && profile.id === ownerProfileId &&
    scope.conversation.ownerProfileId === profile.id && scope.principal.profileId === profile.id &&
    scope.principal.audience === "private" && scope.mode !== "diagnostic" &&
    scope.grant.enabled && scope.grant.scopes.includes("personal"));
}
