# Slice 3 household clients

Status: source implemented for the Slice 3 deployment/startup gate. Android compilation,
static asset build, and runtime startup evidence belong in the Slice 3 deployment record.
The consolidated functionality campaign runs after all three slices are built. No workflow
success is implied by source completion or by a successful build.

## Reuse and ownership

| Concern | Decision | Authority and client projection |
| --- | --- | --- |
| Family identity | Adapt | Existing household device enrollment and Android Keystore signing. Each phone is separately enrolled to one configured family profile; there is no pretend profile switch. |
| Kitchen identity | Adapt | Same device authority, dedicated revocable display kind and read-only grants. Browser holds a nonextractable P-256 private key in IndexedDB. |
| Conversations, questions, goals, approvals | Reuse | Existing OpenClaw session/goal and household API. Clients display the current checkpoint and submit typed prompts or explicit control requests. |
| Rolodex, wiki, receipts, lists | Reuse | Owning domain stores remain canonical. Browser/API view state is a projection, never a second contact, memory, queue, or task store. |
| Pending submissions | Adapt | Existing phone draft buffer now preserves the exact request body, operation identity, audience through the selected conversation, attachment IDs, mode, focus revision, and question binding. |
| Pending media | Adapt | App-private draft cache only until upload and durable submission capture. Server artifact storage owns accepted bytes. Failed upload leaves the phone draft available. |
| Published kitchen output | Reuse | Explicit server publication projection only, never general conversation artifacts or private resource lookup. |

Android private draft metadata uses app-private SharedPreferences; media bytes use app-private
files. These are delivery buffers, not an authoritative work queue. Message retries preserve
the original request identity and complete body. Goal and cancellation retries preserve
their target and issue time. Cancellation must fail when its original goal/run no longer
matches; it must never silently retarget later work. Explicit permanent rejections remove
the unaccepted request from retry. Network failures keep it retryable on refresh/reconnect.
The service remains responsible for idempotency, effect receipts, authorization on every
request, and task restart recovery.

The existing phone delivery buffer also retains accepted-but-not-started receipt metadata.
`submission.changed` events become visible queued/failed/review notices, including failures
that happen before a message reaches native chat history. Reconnect refreshes an existing
receipt using its exact original request identity/body, rather than inventing another send.
Once native execution starts, the phone drops the original delivery body. A fresh explicit
retry is offered only for an allowlist of known pre-dispatch transport failures with no
recovery uncertainty; it uses a new submission identity because the original server record
is terminal. Unknown or partially delivered outcomes have no retry control or retained
resubmission body. This remains the same bounded private delivery buffer, not another queue
or task authority. Accepted messages return the composer to Chat so ordinary follow-ups
steer the existing task; an explicit task mode still requests a separate goal.

Read-only HTTP projections live in `services/household-control/src/client-views`.
They accept fixed browse paths and a typed, fixed read-query port from the owning domain
runtime. No caller-selected tool name or arbitrary argument dispatcher is exposed.
Current device/profile/grant checks run before and after asynchronous reads. Card source
bytes are checked against the current card's source membership, hash and audience, then
the card revision is read again before delivery. Task cards come from the current native
session/goal, checkpoint and bound immutable handoff/question artifacts; internal task
JSON evidence is not presented as a household artifact chip.

The message API accepts an exact metadata allowlist. Internal admission time, native
session/goal fences, source references and external-origin identity are never client
fields. Task modes create a native goal with stable admission metadata; a linked question
reply instead preserves its original goal/session and must still target the current
waiting question at admission and dispatch. Answering never issues a native resume.
Operator resume is a separate control and preserves a bounded reference to the original
verified source artifact through the existing submission ledger, without copying text.

Targeted cancellation reuses the existing control receipts and goal-control watermark.
The pinned native abort API has no goal compare-and-swap argument, so the adapter first
pauses the exact goal through native goal update's goal/time/operation fence, then aborts
only the exact observed run ID. A late request never sends an unqualified session abort.
Later resume/control intent invalidates an older uncommitted cancellation retry. A recorded
completed control returns its exact replay receipt. Client checkpoint pointer writes are
retired; only the trusted task application updates the canonical checkpoint.

Phone drafts survive app process death. After a submission is durably buffered locally,
uploaded draft bytes can be removed because the pending request references server-owned
artifacts. Upload requests have stable per-draft/per-conversation idempotency keys. A failed
upload does not turn a message into a false success. Draft files do not cross profiles when
the phone is disconnected: local enrollment, pending requests, pending media, previews,
and projected private resources are cleared. Preview files are bounded to eight recent
files and expire on subsequent preview access after thirty minutes.

A generic signed refresh rejection now hides the prior client view and offers
a retry with the saved phone identity. It preserves the device key and pending
requests. The server continues to enforce revocation on every signed request.
A confirmed local disconnect still clears the phone's key and local data.

## Android experience

Hardy Home 0.5.1-alpha gives the transcript and composer the main display
area. A compact header keeps the conversation title, audience and active
message mode visible. The navigation drawer holds chats, household pages,
presets and connection controls. The chat details drawer holds task
progress, questions, delivery actions, attachments, outputs and permitted
diagnostics. Both drawers open on demand on phones and tablets. Pending
attention stays discoverable in the header. The transcript opens at the
newest message and keeps the reader's position when they scroll back.

Hardy Home 0.5.2-alpha adds a single activity line above the composer. The
existing authenticated workspace response projects queued, dispatching, or
running from the selected owned conversation's submission ledger. Running
shows “Jarvis is thinking…”. Completed, rejected and unrelated requests do
not drive the indicator. Fresh workspace reads restore activity after
reconnect and outdated responses cannot overwrite a newer selection. The
backend projection passed all 521 tests against the installed SDK. The
Android build, lint and six unit tests passed.

Hardy Home 0.5.3-alpha shows a tappable thumbnail when an assistant reply
references an exact saved PNG, JPEG or WebP output in the current chat. The
client matches the reference against its existing authorized workspace data
and uses the same signed image download and private preview. Conversation text
supports Android's long-press selection and copy controls.

The existing Compose conversation remains the central interaction surface. It now includes:

- Photo capture through the phone camera and document/photo import, with upload progress,
  removable drafts, and conversation artifacts. PNG, JPEG, WebP and PDF are supported,
  up to 25 MiB each and eight drafts per submission.
- Explicit Chat, Get something done, Brain dump, and Explain a problem modes. Diagnosis
  is visible only to operator-authorized profiles. Children remain conversation-only.
  Mode and question bindings are included in the persisted request before delivery.
- Current objective, progress steps, saved checkpoint indicator, pending question, linked
  reply, pause/resume, goal completion, and target-fenced stop. Ordinary replies remain
  unrestricted prompts. Approve/Decline appears only for a server-owned approval question
  and creates an approval decision only after the corresponding explicit button press.
- Separate private and shared conversation creation and accurate transcript audience labels.
  Personal list/wiki items cannot be carried into an already shared conversation by the
  contextual “discuss” shortcut. Server scope enforcement is still authoritative.
- Household Rolodex lookup, card fields, uncertainties, revision history and original card
  previews. “Ask or correct” sends ordinary contextual prompts with the observed revision;
  the client never patches a card silently, changes OCR fields itself, or restricts correction
  to a closed set of commands.
- Personal/shared lists, knowledge search and pages, receipt review reasons and contextual
  review prompts. Changes flow through the existing agent/domain path and current grants.
- Raster/text output previews, inert local HTML/SVG rendering, and user-selected document
  viewers for supported document types. HTML/SVG cannot execute scripts or fetch a network
  resource in the preview; they are never handed to an active external web browser.

The FileProvider grants only capture/preview subdirectories; it does not expose arbitrary
app files or durable draft storage. Camera capture invokes the platform camera activity,
so the app needs no camera permission or in-app camera service. No Gateway, mail, vault,
or provider credential is stored by these clients.

## Kitchen deployment

`apps/kitchen-display` is a static browser client, built with `node build.mjs` on Ubuntu.
It needs no npm package installation or browser server. The household HTTP service serves
the built assets at `/display/` (and redirects `/display` appropriately). JavaScript and
styles use absolute `/display/` paths. API calls use the same origin under `/v1/display/`.
Do not add permissive cross-origin settings or put Gateway credentials in a kiosk URL.

Browser device signing requires a secure context: use a household HTTPS origin trusted by
the kiosk browser, or localhost when the display browser runs on the same host. A plain
LAN HTTP address cannot create WebCrypto device keys. Use the existing household HTTPS
front door, or a same-machine localhost connection; do not disable browser security to
make an insecure origin pretend to be trusted. The kiosk command is ordinary Chromium
`--kiosk <trusted-household-origin>/display/`, managed by the device's existing desktop
or service setup. No unmanaged background process is introduced by this client.

Enrollment uses a **kitchen-display invitation**, not a phone invitation. The private key
is nonextractable and stored only in browser IndexedDB; invitation text is cleared after
claim and is not stored. Device ID/public key are not Gateway bearer credentials. Existing
device administration can revoke this display independently. Device kind and grants are
enforced by the server, including rejection at every family API route.

The screen polls its read-only household projection every fifteen seconds and on browser
reconnect/foreground. It shows loading and stale/offline states. A failed refresh preserves
the last household snapshot only in memory, for at most ten minutes, then clears it.
Revocation clears all displayed content and removes the stored identity. No household
lists, calendar events, or output bytes are stored in localStorage, IndexedDB, or a service
worker cache. Publications are loaded only from their dedicated signed content route;
any supplied external URL/contentPath is ignored. Every snapshot can revoke the prior
publication immediately. The backend allows only PNG, JPEG, WebP and UTF-8 plain text
for kitchen publications. Raster images use inert image rendering; plain text uses
textContent. SVG, HTML, PDF and JSON cannot be published to the kitchen display.
General app artifact previews do not expand that separate display allowlist.

As of 0.7.0, a fresh authenticated adult request can publish an exact owned household output without a second confirmation. The source may belong to a completed task or earlier conversation; the trusted grant binds that exact artifact, source task/conversation and hash. Private outputs, diagnostics, financial reports, child publication and scheduled/autonomous publication remain rejected. The current source and permissions are rechecked before commit. Publication creates the existing household display projection, not an editable second artifact authority. Real handset/kitchen acceptance remains separate from the source and component checks.

## API presentation contract

Android uses `/v1/conversations/:id/workspace` for task/checkpoint/question, artifact
metadata and `availableViews`. Progress supports a string or `{summary,steps}`. Contact
sources use `/v1/contacts/:id/sources/:artifactId/content`, so a household card source does
not require reading its original private conversation. Browse routes are `/v1/contacts`,
`/v1/lists?scope=…`, `/v1/wiki?scope=…`, and `/v1/receipts/review`.

Message metadata includes `mode`, `artifactIds`, `replyToQuestionId`, and optional
`focus:{kind,id,revision,scope}`. Explicit approval buttons add
`approval:{questionId,decision:'approve'|'reject'}`; freeform prompts never synthesize it.
Card corrections carry the current revision for the server's compare-and-swap check.
Stale revisions produce a refresh request instead of a silent overwrite.

Kitchen uses only `/v1/display/enrollment/claim`, `/v1/display/snapshot`, and
`/v1/display/publications/:id/content`. Canonical signing uses method, exact path including
query, millisecond timestamp, fresh nonce and SHA-256 body hash separated by newlines.
WebCrypto's P1363 P-256 signatures are converted to DER for the existing verifier.

## Verification and rollback

Build/start checks now: compile Android debug APK on Ubuntu; build static assets and check
module syntax; deploy the household service and confirm `/display/` asset delivery. Do
not claim camera, OCR, approval, receipts, personal/shared boundaries or family workflows
passed before the final functionality campaign.

Deferred campaign cases: camera/import interruption and process death; exact metadata retry
after a lost response; per-conversation upload retry; stale card revision; linked ordinary
clarification and explicit approval/rejection; target-fenced late cancellation; separate
family phone enrollment/revocation; personal/shared shortcuts; receipt review prompt and
card rescan prompt; malicious document HTML/SVG; contact source permission; display secure
context/enrollment/revocation; snapshot outage expiry; publication removal and concurrent
refresh/re-enrollment. `node --test test/signing.test.mjs` covers DER interoperability and
signed request binding when the consolidated campaign opens.

Rollback: restore the prior Android APK and household static assets together with compatible
service routes. New client state does not migrate canonical domain data. Disconnect the
phone or revoke a kitchen device to remove its access. Source and deployment backups stay
in the authorized task staging/host backup locations, outside the public source tree.
