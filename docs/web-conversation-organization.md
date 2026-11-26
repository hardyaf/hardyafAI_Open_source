# Web chat layout and conversation organization

Status: implemented, verified and deployed for household control 0.10.0, HTTP API
0.8.0 and additive application schema 8. Native boundary 0.7.0 stays compatible.
Current status owns deployment and the wider household acceptance limits.

## Outcome and plan

Keep the message composer within the browser viewport at ordinary zoom. Give the
sidebar and transcript independent scrolling. Provide sidebar rename and delete
controls without opening another window, and durable folders with drag and drop
plus a keyboard/touch move control. Narrow screens use an in-app Chats drawer.

1. Adapt the existing web shell and conversation list, retaining signed requests,
   drafts, attachments, delivery recovery and private connection entry.
2. Extend canonical conversation metadata with owner-scoped folders and personal
   sidebar placement. Keep conversation identity, audience and grants unchanged.
3. Add owner-only retained deletion with live-work checks and admission fencing.
4. Verify browser geometry/interactions and canonical API authorization/migration,
   then deploy the reviewed files and built web assets together.
5. Retain preimages and failed attempts; synchronize source without losing local
   history. Do not commit, push or restore older business databases.

## Reuse map

| Capability | Decision and reason |
| --- | --- |
| Browser shell, sidebar and signer | Adapt the existing Hardy Home client. No new app, UI service or credential path. |
| Conversation title and tags | Reuse the signed metadata route and existing canonical ownership checks. |
| Folders and placement | Extend the household database's existing migration authority and conversation repository. Existing tags do not represent folders or per-viewer placement. No second database or authorization system. |
| Conversation removal | Add a retained tombstone to the canonical conversation owner. Existing code has no app delete endpoint or safe native history-erasure interface. |
| Live execution and cancellation | Reuse stock OpenClaw and the existing submission/goal controls. Deletion refuses active or uncertain work instead of implicitly cancelling it. |
| Event refresh | Extend existing owner-filtered application events. No new queue or event stream. |

## Data ownership

| Datum or effect | Authoritative owner and lifecycle |
| --- | --- |
| Conversation ID, title, tags, owner and audience | Existing household conversation repository. Renaming retains identity and provider/source bindings. |
| Folder name and identity | Same household database, scoped to the signed profile. Folder changes do not change chat visibility. |
| Conversation placement | Same database, per signed profile and visible conversation. Removing a folder returns its chats to Unfiled. |
| Retained deletion marker | Canonical conversation repository. Owner-only and idempotent; hides the conversation from app reads and prevents further source/native authority. |
| Native history, artifacts and action records | Existing owners remain authoritative and retain their records. Deletion is not provider undo or history erasure. |
| Layout, menu state and drag target | Temporary web view state. Durable organization comes from signed canonical API responses. |
| Credentials and Google grants | Existing isolated credential daemon and Bitwarden, unchanged. No model, shell or browser token access is added. |

## Verification and rollback

Use disposable profiles/conversations and synthetic messages. Verify long history,
long sidebar, short desktop viewport, narrow touch layout, independent scrolling,
composer visibility, inline rename/delete, drag/drop and accessible move fallback,
folder persistence, cross-profile refusal and no audience widening. Check migration
and reopen, active/uncertain deletion refusal, repeated mutations and deleted-source
admission. Browser test traffic stays inside its isolated fixture.

Deploy source and protected assets together with schema backup and no active
accepted work. The migration is additive. Rollback restores reviewed source/assets
without overwriting newer household records, folders, tombstones, credentials or
provider effects. An old release that ignores tombstones is not a safe production
rollback after any conversation is removed; retain the deletion/admission fence or
leave the affected service unavailable until the forward repair is ready.
Scheduling, inference providers, Google scopes and native host-tool policy stay
unchanged. Executed results and remaining limits follow.


## Executed result and limits

The original browser layout reproduced the failure with synthetic long history:
the transcript expanded the grid instead of scrolling, pushing the composer off
the viewport. The repaired layout passed at ordinary zoom on desktop and short
windows, and on 320-pixel-wide and simulated keyboard-height viewports. The sidebar
menu, rename/error/retry/cancel, folder create/rename/delete, per-viewer placement,
pointer drag/drop, Move fallback, reload, drawer focus and library/Connections
navigation passed 17 browser checks. A delayed-folder-GET regression failed the
retained older candidate and passed the final source, preventing stale snapshots
from hiding a newly saved folder. No browser test submitted a model message or
used production conversations, credentials or providers.

Canonical schema-7-to-8 migration/reopen, ownership and shared visibility, retained
and repeated removal, title-only rename/tag preservation, native-state uncertainty,
stopped versus active tasks, new source arrival during native awaits, cached/raw
admission, catalog/native/credential current guards and delayed read revocation
passed in the installed-SDK suite. The final total was 593/593, zero failures or
skips, with 194 source files validated. API 0.8.0 generated-client consistency
passed. Android source remains compatible with the additive contract; no APK was
rebuilt or physical Android interaction certified for this web release.

Deletion uses the existing canonical conversation and submission authority.
An atomic tombstone update refuses unsettled submissions; a canonical insertion
trigger prevents later source admission. Current source/native checks and
post-await app reads reject removed conversations. Active or continuing goals
must first be stopped; idle paused, blocked or limited goals can be retained with
a removed conversation once no unsettled work remains. Folder creation uses the
same stable client-generated ID across an unconfirmed retry and refuses conflicting
replays or resurrection of a deleted folder.

Deployment retained protected source and a consistent database backup, verified no
active accepted work, stopped the affected services, installed the reviewed files,
and awaited ordinary readiness/schema 8 before starting protected credential
ingress. All 35 deployed file hashes, 12 served browser assets and the credential
audit passed; trusted readiness reports 0.10.0 with the native adapter connected.
The migration is additive and no database was restored. No real chat was renamed,
moved or deleted by the verification campaign. Google credentials and grants,
model/provider configuration, native host-tool restrictions and disabled jobs
remain unchanged. Physical touch dragging and a real software keyboard remain
unverified; browser viewport and pointer coverage do not imply them.

Independent postdeployment verification passed all 37 checks, including exact protected file/asset identity, native PID/config attestation, schema/admission fences, disabled scheduling and unchanged local provider health. This check made no model or account-provider calls.
