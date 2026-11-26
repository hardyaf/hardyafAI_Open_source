# Default Gmail route repair

Status: implemented, verified and deployed for household control 0.10.1.
HTTP API 0.8.0, application schema 8 and native boundary 0.7.0 remain unchanged.

## Problem and plan

An owner-authored ordinary private request searched the house mailbox without
a connection ID. Its native tool invoked the old configured CLI route and
returned dependency_failed. The saved owner Google grant was still connected
and matched the protected configured house account. The earlier successful
live canary explicitly selected a connection, so it did not establish the
ordinary omitted-ID route.

1. Reuse the protected configured Google account as the default identity.
2. Resolve its exact owner-owned approved Gmail connection inside the isolated
   credential service; read through its existing immutable secret binding.
3. Keep explicit approved account selection for other intended mail accounts,
   and deny missing, unavailable or ambiguous defaults without account fallback.
4. Align schemas, domain metadata, discovery ID naming and skill guidance.
5. Test default search/read and authorization failures through the real consumer
   boundary, then deploy and verify a natural private request without supplying
   connector IDs or tool instructions.

## Reuse and ownership

| Boundary | Decision and authority |
| --- | --- |
| Default mailbox identity | Reuse existing protected google.account configuration. The model cannot choose or rewrite the default. |
| Account/operation binding | Reuse canonical owner connection metadata, verified Google identity, preset/scopes and exact Bitwarden secret ID. No additional credential or default store. |
| Native request authorization | Reuse the existing admitted source/session/run/goal snapshot, current profile/device/private-audience and cancellation/revocation checks. |
| Provider reads and token refresh | Reuse ConnectionsService and its sole credential daemon, vault adapter and provider client. No raw token or provider client reaches the model. |
| Query/date interpretation | Reuse model-owned Gmail query composition under typed schemas. No request-phrase, sender or date-range routing branches. |
| Legacy compatibility | Preserve the old adapter only when no connected consumer is configured. A configured consumer failure cannot fall back to CLI or another account. |
| Conversation and task state | Reuse native execution and existing signed application admission/receipts. No new queue, goal engine, identity or memory system. |

The default operation carries no caller-supplied account or selected secret ID.
The consumer derives the account from protected configuration and resolves only
that signed owner's bindings. Disconnected historical grants do not block a
new connected grant. Multiple current matching binding IDs remain ambiguous,
including during an unknown/refresh state; default choice must not flip while
a provider request is in flight. A unique binding must be connected and permit
the requested Gmail read. The existing owning read path rechecks all remaining
scope, identity, secret and current-request requirements.

Connections metadata remains canonical in the household database; secret values
remain canonical in Bitwarden; Google owns mailbox data and granted scopes.
Request authority and resolved default identity are ephemeral for that read.
Folders, conversation deletion, calendar routing/writes, consent and provider
permissions are outside this patch.

## Verification and rollback

Use isolated service/provider fixtures for default search/read, explicit account
selection, second personal accounts, absent/duplicate/disconnected/unknown/missing
scope bindings, owner/audience/diagnostic/current/revoked-source denial and no
fallback after a connected failure. Verify that rejected metadata never reads the
vault or provider. A signed natural-request canary must contain neither a
connection ID nor tool names; correlate actual native results with the approved
account and current canonical receipt, and revoke its temporary device.

Retain the failed owner request, component attempts and exact source preimages.
Deploy reviewed source and instructions together. Preserve current household
records and credential/provider state; never restore a database or old refresh
token. The additive schema-8 deletion fence must remain effective during any
rollback or forward repair. Actual checks and limitations follow when complete.


## Executed default-route acceptance

An exact owner-authored ordinary request exposed the old route: native search
omitted connectionId, reached the legacy adapter and returned dependency_failed.
The connected grant metadata still matched the configured mailbox and remained
connected. This is distinct from a later message-reading context overflow.

The repair passed 603/603 installed-SDK tests, zero skips or failures, 195-file
source validation and generated-client consistency. Ten focused real runtime/
Unix-consumer tests cover default search/read, exact owner/account selection,
explicit selection, disconnected historical grants, ambiguous or unavailable
bindings, scope/current/private denial, no CLI fallback and forged account/ID
wire fields. Independent source review found no authorization blocker.

Deployment verified all 11 reviewed protected files, current native attestation,
credential isolation and trusted 0.10.1 readiness. An independent content-free
postdeployment pass completed 23 checks. The automated signed natural prompt
contained neither an account connection ID nor tool names. One actual Gmail
search omitted connectionId and returned the approved configured account through
connected_google; the seven-day query and limit were confirmed. The canonical
receipt completed, the assistant reported search success, and the temporary
verification device was revoked. This verifies the ordinary default route,
rather than only an explicitly selected connector.

The separate longer request successfully read 18 approved connected messages
before context_overflow. Its last successful input was 28,677 tokens and output
1,920, against the configured 32,768-token context window. Native recovery
attempted compaction twice with summary_failed; an unavailable compaction count
was not evidence that compaction was disabled. See the
[context-precheck investigation](native-context-precheck.md). This search
acceptance does not itself certify full long-mailbox summarization.
