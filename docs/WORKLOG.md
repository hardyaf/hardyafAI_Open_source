# Household assistant worklog

## November 3, 2026 documentation and design alignment

Updated the project from a baseline-only description to the current household-assistant direction. Added the living design, implementation plan, decision log, current-status page, local Rolodex decision and donor/source map. Linked the existing conductor, memory, document, list, app and operations documentation to that planning set.

Recorded owner choices: clear brain-dump actions execute while uncertainties clarify; invitations use named/agreed recipients; OCR stays local by default with approved cloud exceptions; every card saves/reports and later changes follow ordinary user prompts; the Rolodex is local first; clear wiki facts save automatically while inference stays tentative; explicit diagnosis cannot repair; Bitwarden remains the external-secret direction.

Marked the HardyAI native-runtime entry points and plans as historical. Preserved previous acceptance evidence while separating it from current availability. The frozen Jarvis reference and Uplift implementation were read for source/contracts only; no runtime data, receipts, card images or credentials were copied.

Architecture decisions: reuse OpenClaw execution/continuation/scheduling and native memory/wiki facilities; adapt existing household delivery and provider interfaces; introduce one local Contacts authority because the former mutable provider was deliberately absent. Uplift remains the financial authority and kitchen/app views remain projections.

Documentation checks include change/whitespace checks, source/ownership review and local-link verification. No implementation, runtime configuration, vault setup, credential scope, service restart or deployment was performed. Documentation rollback is a normal diff revert; original edited file snapshots are retained privately in the authorized task workspace.

The owner subsequently selected a dedicated household Discord channel as the V1
brain-dump entry and the shared household Rolodex as the default card destination.
Save reports name that audience; unrelated private source-conversation history
remains private. Contact editing roles and later app brain-dump entry remain
separate design work.

## November 3, 2026 receipt reasoning and acceptance policy

The owner approved automatic acceptance of clear receipts and visible review of
unresolved amounts, project assignment and reconciliation. They clarified that
Uplift must become a reasoning-led skill on import: Main selects composable
operations, inspects evidence/project context, calculates or uses short Python,
and revises before accepting or asking. Existing scripts remain reusable
capabilities; their pipeline order is not the agent's mandatory workflow.

Added the receipt policy and aligned design, decisions, plan, status, README and
source map. Distinguished processed from provisional/accepted revisions, required
source-grounded gates and accepted-only final reports, preserved corrections,
and made synthetic balancing, legacy accepted counters, destructive reprocessing
and unfiltered report queries explicit implementation gaps. No receipt data,
source implementation, runtime, accounting state or provider scope was changed.

## November 3, 2026 full-build integration slices

The owner changed the implementation sequence: build all planned features before
functionality testing, grouping overlapping work at sensible deploy/startup
checkpoints. Replaced per-feature vertical slices with six integration slices:
runtime/application backbone; shared execution/connections; canonical data;
composable domain tools; agent/conversation behaviors; clients/display/release
wiring. Deployment smoke checks do not certify those behaviors.

Functional unit/contract, integration and natural-language scenarios remain in
one campaign after the full build. Slices are execution batches, not renewed
approval gates. Updated the design/decision log and receipt policy to match.
This turn changes planning documents only; no implementation or deployment ran.

## November 3, 2026 three slices and Slice 1 execution

The owner consolidated the build into three integration slices and explicitly
instructed starting Slice 1. Reworked the plan as shared runtime/platform;
domain data/capabilities; agent behaviors/interfaces/release. Slice 1 now includes
implementation, Ubuntu deployment and run checks. Functionality testing remains
after all three slices. Existing documentation changes remain preserved.

## November 3, 2026 Slice 1 implementation and deployment

Implemented and deployed household control 0.3.0 using stock OpenClaw 2026.9.8.
Reused the existing submission ledger for payloads, admission, leases/retry and
recovery; added scoped events/artifacts, native goal/context controls and CAS
checkpoint pointers, restricted Python/diagnostic helpers and Bitwarden exec
resolution/readiness. The pointer projection is justified by native progress's
whole-card writes and in-memory question state; it does not duplicate native
task authority. The [Slice 1 record](slice-1-runtime-platform.md) contains the
reuse/ownership map, changed areas, exact release identity, checks and rollback.

Ubuntu syntax/import, contract consistency, native configuration, disposable
additive migration/reopen/count preservation, dependency imports and clean
candidate startup/shutdown passed. Both production services are active and
Gateway readiness succeeds; schema v2 integrity is `ok`. Retained protected
source/configuration/environment/state backups. No model task, provider write,
secret lookup or expanded functional test was run. Added tests remain deferred
until all three slices are assembled.

One preexisting missing-payload dispatch is now explicitly recovery-required;
another historical request remains marked running. They reserve both slots and
were not replayed or silently completed. Bitwarden bootstrap/bindings remain
unconfigured; OAuth repair, domain behaviors, parent no-repair mode, output
harvesting and complete clients are later scope. Deployment readiness does not
mean free execution capacity or completed household behavior acceptance.

## November 3, 2026 owner-authorized historical closure

The owner clarified that the newly booted system is pre-production and
authorized closing historical requests. Backed up the application database,
confirmed native cancellation for the two outstanding request conversations,
and recorded both requests as cancelled with `operator_closed_preproduction`.
Kept their records and an explicit protected closure audit. Released recovery
reservations and both execution slots; Owner is available. The seven completed
submissions remain unchanged, no work was replayed and integrity is `ok`.

This supersedes the earlier occupied-slot limitation, not the general rule
against replaying uncertain effects. No functionality campaign ran as part of
the administrative cleanup.

## November 3, 2026 Slice 2 implementation and deployment

The owner authorized proceeding with Slice 2 after confirming Slice 1 health.
Implemented/deployed 0.4.0 with 68 native typed tools: Contacts/Documents,
canonical lists, read-only bot mail, household calendar, native memory/wiki and
schedule adapters, composable Uplift primitives and scoped effect/diagnostic
evidence. Reused application migrations, native execution/memory/scheduler,
capture stores and Uplift financial ownership. Added no second task engine,
queue, memory index or financial database in household SQLite.

Application schema 3 adds Contacts/effect receipts and per-submission admission
authorization snapshots. The native plugin binds trusted host call/run identity
to the exact admitted signed request; current authority, source provenance,
audiences, goal controls and resource reads are fenced. Central replay is
content-free; domain receipt reads recheck current ACLs. Static review tightened
shared/private contacts/documents, child cleanup, source regrant and virtualenv
handling. Fixed native capture packaging of receipt schema metadata. Hardened
the existing document interpreter from group-writable to owner-writable only.

Ubuntu source/schema/import/configuration/client consistency, 18 Python syntax
checks, dependency imports, isolated app/Uplift migration/reopen/count/integrity,
native plugin registration, candidate startup/shutdown and deployed readiness
passed. Both services active; actual plugin initialized with 68 tools; isolated
household wiki status responds. Exact source hashes verified. Retained protected
consistent pre-cutover backups and evidence. Seven historical completions and
two cancellations are unchanged, with zero reservations, contacts or effects.

No card, receipt, OCR sample, provider mutation, model task or expanded
functional suite ran. Tests were written for the final campaign. OAuth/vault,
receipt projects and schedule activation remain unconfigured; no legacy
financial data were imported. Remaining agent behaviors, source navigation,
family/client rollout and no-repair diagnosis stay Slice 3. The
[Slice 2 record](slice-2-domain-capabilities.md) owns the detailed file areas,
ownership/reuse, release identity, limitations and rollback notes.

## November 3, 2026 Slice 3 deployment and initial contract campaign

Implemented the final authorized build slice: native task/source/run continuity,
selected skills, durable questions and evidence, scoped analysis output,
diagnosis-only execution, grounded managed memory, receipt review/report
composition, Android media/views and the dedicated kitchen projection. Reused
native sessions/goals/children/jobs, the existing delivery/checkpoint/effect and
device authorities, Contacts, Uplift and native wiki ownership. No second agent
engine, task queue, financial ledger or credential store was introduced.

Deployed 0.5.0 with application schema 4, Uplift schema 1 and 85 native tools.
The clean source/export, tool-schema/import/API checks, 21 Python source checks,
Android/static builds, additive migration/reopen, preserved counts/integrity,
plugin boundary registration, candidate shutdown and actual service readiness
passed. Protected pre-cutover source/configuration/state/artifact backups remain
available. Historical submission records were retained.

Opened the one consolidated functionality campaign only after that complete
deployment checkpoint. Initial final results: backend 155/155; Uplift 15;
Android unit, household-capture Python, kitchen signing and generated-client consistency passed. Eight
initial failures were stale fixtures corrected to exercise current identity,
durable delivery, verified resume source and native reconciliation semantics.
Those changes affected tests only; deployed runtime code remained unchanged.

Native/model end-to-end cases, actual devices/providers, controlled recovery and
the family rollout remain pending. Supported native-owner hot reload converged
the complete inventory to 11 jobs with zero enabled, preserving Workshop/cron
off and restoring the original configuration bytes. Scheduling activation stays
held until fixture restoration and final release pinning. No raw cron-store
edits or forced system-owner bypass were used. These contract results do not
grant overall functional acceptance. The [Slice 3 record](slice-3-implementation.md)
retains release identity, implemented areas, limitations and rollback rules.

## November 3, 2026 native goal compatibility campaign findings

The complete three-slice build reached the real signed-app/native campaign.
Two first-send failures were explicit native protocol incompatibilities before
productive execution: ordinary workContext combined with atomic goal start, and
the global before_agent_run hook making native restart-safe admission unavailable.
The adapter now omits workContext only for atomic goal start and recognizes only
the exact typed pinned pre-admission workContext rejection as definitively not
sent; other protocol/transport uncertainty remains unknown. The bridge no longer
registers a restart-unsafe run hook. Positive admission hooks, per-run denial and
pending latches, no-tool refusal prompts, trusted native policy, native safe tool
allowlists and exact invocation/effect fences remain enforced. Rejected requests
may produce refusal text but cannot act under old source authority. Pinned native
2026.9.8 code remains unmodified. Regression and real-native acceptance are
reported separately; failures are retained with owning evidence and explicit
fixture cleanup rather than blind replay.


## November 3, 2026 native campaign defects and host-access interruption

The baseline final backend rerun passed 155/155; Uplift 15, Android, capture
Python, kitchen signing and generated-client contracts also passed. Signed
fixture requests passed 7 read/query/identity/display cases with 2 pending for
actual private conversation/output data. These are component results, not a
passed native workflow or family rollout.

Real native execution found a goal-start wire incompatibility: ordinary-chat
workContext could not accompany the native goal-start intent. The correction
and narrow explicit validation-refusal classification passed 11 focused tests.
Native execution then exposed an unsupported global admission hook; removal is
prepared in source, but its focused rerun and the expanded 158 backend tests
remain pending. No native/model end-to-end scenario passed.

SSH stopped before its protocol banner while the existing service units were
last running the isolated disposable fixture. The owner reports the host is on;
the cause is unknown. All host/model calls stopped. Ordinary restoration and
verification are the first actions when access returns; latest host/source
synchronization, affected checks, model cases and final release pin remain
pending. Canonical configuration files and protected backups are preserved.

Prepared documentation redaction and four narrow source-hygiene changes offline
only. No Windows build/test/runtime work, host service change, deployment seal,
publish or push was performed. These source changes are unverified until Ubuntu
checks. The private source export retains explicit hygiene/verification limits.

The task-runtime handoff confirms partial synchronization: the adapter/protocol
test reached both checkouts and passed 11 checks. Hook bridge removal reached
the host file but was not restarted into the process; updated hook-test transfer
hung and was terminated, leaving remote content unconfirmed. Latest hook notes
and the second rejected-request cleanup preparation are Windows-only. The first
rejected request was proved unadmitted and cancelled; the second remains
recovery-required and unreplayed. These limits are preserved in the private
handoff and do not count as native workflow acceptance.

## November 3, 2026 postboot recovery and corrected contract rerun

After the owner rebooted the host, ordinary 0.5.0/schema 4 services/configuration
were verified restored: both normal units active, integrity ok, zero active
requests, no fixture environment/drop-in and unchanged canonical configuration
hashes. The 31-file source delta was checked against known preimages; nine files
already matched and 22 were backed up and atomically synchronized. Both runtime
corrections already matched; no service change occurred during this sync.

The focused suite passed 24/24 and complete backend passed 158/158, with zero
failures/skips/cancellations. Native registration remains 85 tools, and the
complete 11-job inventory has zero enabled. No native/model workflow passed.

The next two source-check transports stalled and were stopped. Their four
hygiene-source checks remain unverified, not failed application cases. New SSH
connections again fail before their banner; cause remains unproven. Root owns
single-connection diagnosis. Ordinary runtime was last verified restored; the
second rejected request remains retained/recovery-required/unreplayed in the
inactive fixture. Its prepared cleanup, model/control/publication scenarios and
final release pin remain pending. Latest documentation is Windows-ready only
until transport synchronization resumes.

## November 3, 2026 clean-client transport recovery and source checks

A direct TCP probe received the SSH server greeting. Verified clean client
options then restored SSH access without global configuration edits; the cause
of standard-client failures is not yet confirmed. Ordinary 0.5.0 services and
unchanged configuration remain healthy with zero active requests.

The four hygiene files passed Ubuntu installer Bash/embedded JavaScript and
live-smoke TypeScript syntax, managed document-reader compile/import and example
environment structure checks. No installer, live smoke, OCR workflow or service
action was executed. Recovery documentation was synchronized with known hashes
and backups. Native phase/control/publication scenarios remain held pending the
next actual native phase result; no native/model workflow has passed.

## November 4, 2026 native worker ownership and ordinary prompt correction

The next real native case admitted its goal/run but produced no execution
grants or domain effects: agent workers do not run the gateway's service-start
lifecycle, leaving the worker's household owner absent at task-context assembly.
Separately, the SDK's authorized before_prompt_build stage drops system context
and toolsAllow; the household projection requires the ordinary prompt stage.

The correction uses new pure native-runtime composition behind the thin plugin
entry. Safe static schemas/executor wrappers are discoverable before owner or
service startup, with zero owner I/O. Actual hooks/tools share cached async
ensureOwned and one resource graph per process over the existing DB, artifacts
and native authorities. Gateway service lifetime remains persistent; worker
active-run leases and agent_end release close resources only when no active run
remains, including rejected turns. A late A release cannot close active B.

Ordinary prompt projection retains conductor/system instructions and toolsAllow
under native hookInvocation lifetime checks. Trusted tool policy, V2/source
identity and every effect boundary remain unchanged; no second engine, store,
queue or authorization path was added. Combined lifecycle/ordinary-prompt
verification passed 24/24 focused checks (hooks 12, owner 5, boundaries 7) and
167/167 backend tests on Ubuntu, with zero failures/skips/cancellations. These
results include rejected-run cleanup and late-A/live-B overlap. Productive
runtime acceptance still requires actual native phase/analysis cases. The actual signed goal-stop/control-receipt case passed independently
and does not establish productive model-led delivery.

## November 4, 2026 deferred invocation refusal under investigation

The next actual phase reached native goal/run admission, a source grant and
inference. Its deferred household_lists_capture target was refused with
trusted_native_invocation_required; no effects or children were created. An
exact signed operator pause succeeded and the driver ended. This does not count
as a completed productive native workflow or analysis acceptance.

Added diagnostic-only opaque bridge/call hashes and mismatch flags to distinguish
separate global/discovery bridge closures from exact key/argument mismatch.
Focused telemetry regressions passed 25/25 (hooks 13, owner 5, boundaries 7),
zero failures/skips/cancellations. No raw prompt/arguments/native IDs or new
authority fallback was introduced. Native V2 lifetime assertions, exact source
and invocation proof, trusted policy and effect guards remain required. Root
owns reload and one tiny controlled unique-list probe; no release export or
productive phase/analysis pass is claimed while this diagnosis continues.

## November 4, 2026 proven registry split and existing-grant invocation projection

The controlled unique-list probe bound and refused the same opaque call hash in
different native bridge instances, proving a global/discovery registry split.
The exact source was cancelled with zero effects/children; no productive phase
or analysis pass is inferred. Retained proof contains only the scoped diagnostic
evidence, not a grant to retry work.

Reused native_execution_grants with one additive invocations_json column owned
by ExecutionAuthorityRepository.invocations. Bounded 256-live/10-minute exact
call/tool/argument-hash/run/source/session proofs are bound only after current
trusted native policy allows, then V2/current-root/source checked and atomically
CAS-consumed before execution. Existing effect guards remain. Identity changes
invalidate pending proof; identical refresh preserves it. The only initial child
session-ID fill uses exact current policy/run/source/parent/root/goal/mode CAS;
null roots and non-null mismatches deny. Consumed/expired proof is not a replay
path. Discovery-only owner graphs use per-call leases/cleanup so another
registry's agent_end is not needed to release them. No second store, table,
queue, engine or global authority cache was introduced.

The narrow child dispatch fix rechecks explicit goalStart when the current
profile becomes conversation-only. Two regressions exercise downgrade while
queued and during source-capture await; no adapter send/native goal is allowed.
Focused new-plus-delivery checks passed 10/10. Combined backend now passes
181/181, zero failed/skipped/cancelled, and startup source checks pass 116 files.
Actual installed-SDK tests use the registered trustedToolPolicies phase; nine
projection cases cover the child-ID edge and owner tests cover overlapping calls.

Root reload and new real productive phase/analysis remain pending. Existing
effect receipts survive rollback; older code can ignore the additive projection
column. This documentation update performs no service change, runtime edit or
whole release export and does not grant final functional acceptance.

## November 4, 2026 actual parent/child effects and continuation boundary

The real phase committed parent alpha and same-agent child beta effects, yielded
through native orchestration, and woke in a new announce run under its original
goal. Parent continuation then failed closed with toolsAllow empty and
native_request_lineage_not_authorized because public active-run projection was
absent/stale at prompt construction. The exact goal was paused. Both effects
and the child remain retained; nothing was replayed or rolled back. Phase
completion and analysis acceptance are still pending.

The narrow native-scope correction additionally accepts a current trusted grant
with exact agent/root-session/source/session-generation/run/original-active-goal
identity. SDK/hook, mutable profile/device, source and control-watermark checks
remain. Real NativeAdmission inter-session tests cover no-public-run positive
authority and wrong run/source/root/session/goal, paused and stale denials.
Ubuntu backend passed 182/182 with zero failures/skips/cancellations. Root
reload and fresh completion/analysis cases remain pending. No export or runtime
operation accompanies this documentation-only update.

## November 4, 2026 child assignment projection and artifact HTTP boundary

An actual phase child received beta but inherited root objective/conductor text,
attempted parent alpha again and recursively delegated beta. Exact root-goal
control paused it, retaining effects/lineage. Child projection now uses the
current trusted native child assignment and its own conductor, excluding root
objective/outcomes/next action, automatic fact/brain-dump and parent orchestration
instructions while retaining root/source/audience/contracts/diagnosis boundaries.
Parent projection is unchanged; no phase queue or arbitrary depth cap was added.
Five new application/flow checks bring Ubuntu backend evidence to 187/187, zero
failed/skipped/cancelled. Productive phase completion and analysis remain pending.

No-inference signed client checks then exposed duplicate differently cased
Content-Length headers on actual artifact content responses. The one-line
platform HTTP fix emits the existing canonical headers once. A real HTTP test
failed before and passes after for exact UTF-8, binary and empty bytes/hashes,
including private denial. Affected artifact/platform checks pass 7/7; a new full
suite and loading this correction into the service remain separate checkpoints.
The original uploaded private input remains intact and was reused without a
duplicate upload. Four signed ACL cases pass: private conversation exclusion,
private artifact denials/wrong-conversation scope, forged generated-output
rejection and no unsigned/app/display HTTP publishing bypass. Three subcases
remain pending: owner exact-content download after reload, actual private output
denial and actual explicit eligible publication. No inference, service change,
whole export or overall release acceptance was performed by these client checks.

## November 4, 2026 loaded-contract projection implementation plan

Measured native domain attempts skipped the matching skill/context contract.
Plan: adapt the existing execution-grant repository with one bounded metadata
projection (at most 16 domain IDs/SHA-256 digests), recording only after current
context load succeeds under exact grant identity and compare-and-swap. Reuse
native_execution_grants rather than add another skill, session, authorization
store or queue. Existing capabilities/ACL/approvals/effect fences stay sovereign.
Admitted no-goal context needs no synthetic goal/checkpoint. Identity changes
clear the projection; unchanged refresh preserves it. Focused stale/revoked/CAS/
digest/bounds tests precede loader/guard integration. The additive field remains
on rollback for older code to ignore; actual effect receipts are retained.
Metadata owner implemented and synchronized after 9/9 focused Ubuntu checks
passed in isolated source staging. Tests include exact full tuple, independent
repositories, no-goal context, digest mismatch, revocation, write/read races,
capacity/malformed data, child session-ID clearing and schema-4 reopen/default/
idempotence. Existing grant and capability records remain authoritative. Actual
loader/guard integration and native domain acceptance remain separate work; no
service restart or export accompanied this source update.


## November 4, 2026 selected-contract and native-progress integration

Implemented source now requires a current authorized skill contract before typed
business tools execute. Successful explicit selection records only its domain ID
and full UTF-8 SHA-256 on the existing exact execution grant. No-goal selection
remains ephemeral: it creates no goal, checkpoint or handoff. Prompt restoration
records only complete contracts actually included within the bounded projection;
deduplicated text covers each corresponding domain, while skipped oversized
contracts remain unavailable until explicitly loaded. Current source, audience,
capabilities, ACL, diagnosis, native lineage and effect checks remain independent.
The trusted initial child session-ID transition clears the generic projection,
then rehydrates only the same child's still-current delivered contract metadata.
A different source, run, goal, session generation or mode cannot inherit it.

Reuse decisions and ownership:

| Datum | Authoritative owner | Projection lifecycle |
| --- | --- | --- |
| Original goal and execution | Stock OpenClaw | Existing native source/run lineage |
| Declared outcomes and verified evidence | Existing TaskFlow checkpoint/artifacts and owning domains | Original task only; no second plan store |
| Loaded contract IDs/digests | Existing execution-grant repository | Exact grant tuple, bounded CAS; identity change clears |
| Progress presentation | Native progress card | Exact bounded outcome labels plus verification stage; no effect authority |
| Business effects | Existing domain receipt ledgers | Current grants and final pre-effect checks; retained after cancellation |

Root active-goal writes and analysis launches now require a matching unfinished
native progress projection. Native goal completion also requires current owning
outcome evidence, TaskFlow finish and the completed projection. Read-only work,
recovery inspection, task metadata, no-goal automatic memory and delegated phase
work keep their existing boundaries; children cannot publish the root card.
Waiting on a durable human question finalizes its turn without clearing or falsely
completing the unfinished plan. The fixed sandbox analysis output publisher keeps
its separate native child/sandbox authority and does not claim an unloaded skill.

Validation: the complete Ubuntu backend suite passes 212/212, zero skipped,
failed or cancelled, including installed stock SDK cases. New real-runtime tests
exercise actual repositories, source/device fences, artifact storage and grounded
no-goal memory persistence; native/provider observations are fixture ports. They
cover stale digests, revoked access, pre-effect refusal, child/successor restoration,
the first child session generation, oversized/deduplicated contracts and progress
admission. This is source/contract evidence, not household-domain acceptance.

Earlier actual card/memory attempts remain retained failures: local OCR committed,
a later card saved an empty shared record after skipping its instructions, and
private candidate topic/journal writes preceded a redacted native model error.
The SDK itself paused that failed memory goal; the driver's later exact cleanup
was distinct. Clear-card correction, confirmed wiki correction and the remaining
domain model scenarios are still pending. Fresh natural card execution after the
generic gate reload is in progress; no overall functionality claim is made.
Rollback restores the matching source/config while execution is stopped, retains
all effect/history records and the additive metadata column, and requires fresh
authority projection before resumed work. No new store, queue or memory authority
was introduced.


## November 4, 2026 progress clarity and card ordering evidence

The later complete backend campaign passes 213/213 with zero skips/failures.
Task responses now distinguish an unsaved progress projection from the actual
native card using nativeProgress.state, observed revision/time, and an exact
nextRequiredNativeCall. Business and completion denials carry the same bounded
native call arguments. The regression exercises real source persistence, owning
verification, finish, stale/current cards and the remaining completion gate.
Diagnostic phase children hide root controls as well as rejecting their execution.

A fresh natural card attempt then saved a real native two-stage progress card
and one shared contact, but skipped OCR, saved empty fields and encountered a
redacted native model error before verification or the ordinary correction.
The case remains failed; component writes are not end-to-end acceptance. Earlier
records and failed goals were retained, with exact cleanup after terminal proof.

The contacts contract had an ordering ambiguity: "save immediately" did not
clearly separate source intake from the first field save. The instruction and
capability description now require local document extraction/evidence before the
first field save; prompt source persistence remains separate. A real failed,
unavailable or no-readable extraction still permits the required honest empty
fallback. Skipping extraction does not establish unreadability, and a saved card
cannot be silently rewritten without a later ordinary human response. This is
an instruction correction reusing the existing OCR/contact tools, not a handler,
router, store or permission change. The actual source loader validated the
contract; no prose-string tests or additional card retry were used. Natural
clear-card capture and correction acceptance is still pending after this change.
Ordinary no-goal private/shared memory variants were prepared to assess automatic
curation independently of multi-step task completion; their actual results are
separate from the backend contract campaign.

## November 4, 2026 completion integrity and current Slice 3 record

Latest Ubuntu backend verification passes 226/226, zero skipped/failed/cancelled,
and 125 source checks pass. This supersedes earlier stage counts as current
component evidence; it does not accept a complete model-led household workflow.
The signed retained private input downloaded live with exact bytes/hash after
the framing fix. Four live ACL cases and actual signed exact-goal stop/replay/
control/source fencing pass; actual private-output/publication cases remain open.

The actual no-goal private memory attempt retained candidate-only writes and an
unwanted unbound active native goal, while its source receipt had prematurely
reported complete. Native-end and maintenance now refuse that claim with
native_goal_binding_missing unless current source/goal ownership is proven.
They do not adopt a current/historical goal or replay work. Maintenance rereads
receipt identity across native awaits; newer terminal/binding/run decisions win.
Legacy abort also requires fresh native context for no-goal/old-completed-goal
success and otherwise safely cancels, without changing targeted HTTP controls.
Eight store regressions and five native-end regressions cover these boundaries;
affected store checks pass 24/24 and are included in the complete 226-test result.

Rewrote the Slice 3 record to separate built/deployed/component-tested behavior
from failed phase/card/no-goal-memory workflows and unrun analysis/domain/provider/
hardware cases. Historical R7 remains a passed earlier startup checkpoint, not
the latest corrected source or final release. Earlier SSH/rejected-request/hook
transfer uncertainty is resolved history. R8 pin and ordinary restoration remain
pending, scheduling is off, and the isolated Qwen comparison is in progress;
ordinary GPT-OSS configuration remains unchanged. No export, model request,
deployment, configuration switch or service restart accompanied this doc update.

The subsequent isolated Qwen comparison also ended failed/unaccepted, with its
exact operator-stop evidence retained. It does not promote or replace the
ordinary GPT-OSS configuration. This final comparison result supersedes the
in-progress status in the preceding dated work stage; R8/ordinary restoration
remain pending and overall functionality is still unaccepted.

## November 4, 2026 ordinary restoration and final source freeze

Final frozen backend verification passes 229/229, zero skipped/failed/cancelled,
and 126 source checks pass. Three real generator CLI regressions cover canonical
active-domain authority and rejected collisions/outside-home paths. Earlier
226/125 and other counts are dated stages, not the final current component total.

Ordinary 0.5.0 services are restored and ready with no fixture overrides and
the original GPT-OSS model configuration unchanged. The reviewed native delta
enables global progress and appends progress_card for main/Adult, then points
the native plugin at the same canonical domain file used by control. The old
staged and canonical domain contents were semantically identical, so no existing
permission drift was found; the stale authority path was still a real defect.
Canonical domain/control bytes and other Google/Discord/auth/sandbox/identity
settings remain unchanged. All 11 historical jobs remain retained/disabled;
scheduling is off. No new configuration authority or store was introduced.

The isolated Qwen comparison ended failed/unaccepted and was not promoted.
Core native/card/no-goal-memory cases remain failed or incomplete despite real
retained partial effects and passing boundaries. Overall functional acceptance
remains false. R8 immutable pin/external deployment receipt is still pending;
its archive hash is not embedded in tracked source. Source/docs now freeze for
export/build/pin, with edits only for a concrete check failure. This final doc
update performs no model request, configuration application, restart or export.


### November 4: clean-export startup check before final pin

The frozen 263-file candidate passed source/config/tool-schema/API/Python/static
build checks, complete Android-source equality for APK reuse, migration/reopen
with counts/integrity preserved, 85 native tools, isolated readiness/assets and
clean shutdown. Earlier pending-pin notes describe their dated preparation
stages. The current Slice 3 record now directs readers to the external deployment
receipt for the immutable pin, keeping archive identity outside its own source.
Only these two presentation documents changed after that candidate check; code,
skills, schemas, dependencies and client sources remain frozen and identical.
Final deployment outcome belongs to the guarded receipt; no workflow acceptance
is inferred from source/config pinning. Scheduling remains disabled.

## November 4, 2026 bookkeeping complexity audit

The owner agreed to stronger-local evaluation plus protocol simplification and requested a broader audit of unnecessary bookkeeping and rigid checks. Added the source-backed complexity audit with prioritized findings, reuse/data ownership, a proposed implementation order and acceptance/rollback criteria. No runtime, model, provider, schema, code, skill or scheduling changes accompanied this audit.

The audit identifies model-maintained native progress as an execution gate, ordinary-action goal ceremony, frozen model plan wording, repeated evidence/completion calls, duplicated prompt contracts, source-ID copying and literal-claim memory restrictions, contact full-record replacement and weak extraction linkage, narrow receipt grounding, exposed checkpoint revision mechanics and competing current documentation. It distinguishes source-demonstrated limitations from live failed cases and retains identity, scope, provenance, cancellation and effect/financial integrity.

Current status remains the runtime/evidence authority. README and the main plan now link there instead of maintaining stale check totals/pin status. The conductor reference now describes actual artifact/CAS/native ownership and preserves dated component evidence without directing a second Markdown recovery ledger. Task/hook references distinguish deployed contracts from proposed simplification. The model candidate note now names Qwen3.8 27B; no download or comparison occurred. The existing immutable deployment receipt remains valid for its frozen source; these documentation updates are a later source revision and do not repin or deploy it.


## November 4, 2026 bookkeeping simplification implementation and final local comparison

Implemented the authorized audit repairs as household control 0.6.0/API0.5.0,
87 native tools, application schema4/Uplift schema1. Ordinary actions no longer
need native goals/progress ceremony; operation IDs and unambiguous receipt
association are mechanical. Late outcome drafts, trusted owner proof and one
completion facade preserve actual native goal/child state. Corrected transport
ack parsing, exact completed-source recovery, deferred completion dispatch and
terminal successor reconciliation. Native OpenClaw remains task/session/child/
scheduler owner; no second queue, approval or business store was added.

Memory now composes existing authenticated sources, topic and daily journal in
one remember call and pins content writes to the source audience. Source-level
pruning preserves attributable unrelated entries; opaque pages disclose required
rebuilds. Contacts accept grounded observations without duplicate fields/handles
when binding is unique, and later-human patches preserve unchanged evidence.
Uplift supports reasoned nonmonetary interpretation and focused review facts;
deterministic monetary/reconciliation/authorization/acceptance policy remains.
The implementation record contains the reuse/data ownership map and rollback.

Ubuntu backend 407/407, installed SDK actually executed with zero skips, source
and 87-tool schema checks pass. Uplift21 and capture7 pass. Android source is
unchanged across the complete map; APK reuse is source-equality based. Clean
export/promotion receipts seal actual bytes separately from functional claims.

Official Ollama0.32.15 is applied with the existing provider boundary retained.
Qwen3.8:27b-q4_K_M is installed; single-model 32K fit is fully GPU-resident.
The final matched cases passed Qwen parent/child completion (~131s), exact list
(~31s), and actual local six-field card plus ordinary correction (~129s).
Private memory initially saved a confirmed fact/topic/journal and honest recall,
but later correction left the daily journal incomplete; the full case failed.
GPT passed the list case but failed card and memory delivery with unsupported
final claims. Original failed/partial attempts and owner effects remain retained,
not replayed or relabeled. The ordinary GPT default is unchanged; Qwen has not
been promoted. Combined workload and remaining consolidated scenarios are open.

At this source-doc checkpoint ordinary0.5 services are restored with no fixture
override; guarded0.6 promotion is the next step. Google/Discord/identity/grants
remain unchanged and all11 historical native jobs remain disabled. No OAuth,
vault bootstrap, real project onboarding, hosted inference, public push or
physical-device acceptance is claimed. The final deployment result is recorded
by the guarded external receipt and an explicit later worklog entry.


## November 4, 2026 guarded bookkeeping deployment and final memory repair

Promoted ordinary household control0.6.0/API0.5.0 on the canonical Ubuntu source.
The complete frozen component seal passes411/411 backend tests with actual
installed SDK execution and zero skips,140 source/startup files,87 native tools,
Uplift21/21,capture7/7 and the kitchen build. All41 Android-source map entries
equal the earlier accepted build, supporting APK reuse. Source/config/consistent
SQLite backups and exact private release receipts are retained. Both ordinary
units are ready; schemas4/1 and all11 disabled historical jobs are preserved,
scheduling stays off and active/recovery request counts are zero.

Investigation of the earlier Qwen correction failure found current native
Related metadata incorrectly classified as opaque notes. The bounded repair
recognizes only the exact generated section outside human Notes and drops stale
retired-source links before native regeneration. A two-entry regression proves
unrelated attributed content survives; human/opaque content still requires
explicit invalidation/rebuild disclosure. The remember facade can reuse the
supersession's active confirmed replacement source only under exact current-human
quote/reference checks, restoring topic/journal without duplicate capture.
Focused44/44 memory/lifecycle/privacy/boundary checks pass; this is included in
the full411-test assembled seal. Earlier failed attempts are retained unchanged.

The fresh unique-input Qwen memory case passed initial confirmed private
capture/topic/journal, honest unknown-age recall and later correction through
replacement-source reuse with both projections restored. Earlier matched phase,
list and local six-field card/correction cases passed on the preceding source;
the final delta is the bounded memory owner/contract repair and documentation.
Each run retains its exact source/case/native evidence pin. This does not accept
restart/forgetting/concurrency breadth or the remaining consolidated workflows.

Applied a separately reviewed Main-only local-model configuration change to
Qwen3.8:27b-q4_K_M at32K, with its exact validated descriptor. GPT defaults,
Adult/other profiles, fallback policy, provider address/authentication, Google,
Discord, identity and domain grants are unchanged. The guarded switch verified
ordinary0.6/87 readiness and retained job/data integrity. No inference or data
restore occurred as part of that configuration application. Other family
profiles and combined workload remain unaccepted; overall acceptance is false.

The final documentation amendment changes only Markdown; tested implementation,
skills, dependencies, schemas and clients remain byte-identical. Its external
manifest/amendment receipt links the tested source and actual deployment/model
receipts. Source/config/model rollback retains current durable facts/effects;
no database restoration, replay, hosted inference or public push was performed.


## November 4, 2026 eight-gap reliability implementation

Implemented the authorized build-plan/restriction/ecosystem follow-through on
stock OpenClaw. The reliability record owns the reuse map, data ownership, grouped
files, boundaries and rollback. Existing native lifecycle/queue/memory and current
application/domain/artifact/credential owners remain authoritative. No replacement
fork, second engine, task ledger, credential store or memory index was introduced.

Eight source gaps are addressed: same-chat question/side-action continuity;
Discord staged image custody; native scoped notices; targeted read-only diagnostic
evidence; bounded recoverable wiki continuation; reminder/timezone calendar
comparison; operation-fresh OCR redo; trusted credential refresh/writeback/browser
consumer contracts. Routine selection, operation IDs and proof metadata are
mechanical; ordinary analysis/questions and brain dumps need no artificial goal.
Recoverable list removal and current adult requests for eligible household display
outputs need no duplicate confirmation. Identity, audience, grants, credentials,
source custody, exact effects and unknown-outcome reconciliation remain enforced.

The last fully executed candidate passed500/500 backend tests with zero skips,
160 source/startup files,87 native schemas,Uplift21/21,capture7/7,Python credential4/4
and kitchen build/tests. A native0.7 isolated startup and ordinary durable question /
side action / real restart / normal answer passed with owner readback. Other
attempts exposed side proof incorrectly offered at formal completion, duplicated
due text after successful context restoration, and native analysis attachments
disabled despite a local config clone. General receipt/context/schema/configuration
corrections and regressions are written. The latest changes still require Ubuntu
execution; earlier component passes do not certify this final source.

Native analysis cleanup is exact: late unbound goal paused, original run terminal,
only its source cancelled, no active/queued/recovery work, two failed-attempt effect
receipts and all evidence retained. Actual SDK provider-free preflight confirms
runtime-config attachment ownership. Existing setup generators and the reviewed
promotion helper now share the bounded native policy; raw family attachments remain
denied. No actual native policy/configuration change has been applied.

Ordinary0.6 services/configuration were restored and verified before recurrent SSH
banner failure prevented final verification/promotion. The host answers network
probes but SSH does not reach login; cause remains unproven. Source staging and
hygiene checks proceed locally. Current status explicitly records pending work.
All11 historical jobs remain retained/disabled and scheduling stays off. No OAuth,
vault/binding, real project/family activation, hosted inference, public commit/push,
physical-device or full workflow acceptance is claimed. SDK2.1 is installed in an
isolated unused connector environment without a secret read. Rollback preserves
all newer business data/effects; never restore an old database to replay a case.

## November 5, 2026 reliability verification

Household control 0.7.0 is deployed and ready. The final candidate passed **521/521 backend tests**, zero failures or skips, all **87 native schemas**, Uplift **21/21**, capture **7/7**, credential contracts **4/4**, source/startup checks and kitchen build/tests on Ubuntu. The current status and reliability record identify passing restart and both native compaction cases. Earlier failures remain in the evidence.

The final isolated analysis case **failed**. The sandbox published a real PNG and JSON with total 100 and mean 25. The parent failed to verify and return them. Both exact native completion forms pass component checks on the deployed source. A fresh end-to-end run remains open. The helper uses the existing sandbox, native parent/child lifecycle, artifact owner and signed request. Scheduling remains disabled with all 11 historical jobs retained. OAuth, vault and provider setup, family activation and household functional acceptance remain open.

## November 5, 2026 Discord source evidence and version staging

Live read-only inspection tied the reported turns to distinct native runs, including
the fresh inference following `lol`. The traces shared an early source-admission
failure. Synthetic Discord reproduced the missing exact source on the installed
core and on staged 2026.9.9. The separately staged matching Discord adapter contains
the upstream lane-release fix. The source failure and queue change are independent.

Implemented staged exact-message admission in `plugins/household-domains/native-task-hooks.mjs`
and `services/household-control/src/domain-runtime/native-admission.ts`, with
focused regressions in `native-task-hooks.test.ts` and `native-admission-slice3.test.ts`.
The exact existing and staged-version source packages each passed 526/526 backend
tests with zero skips or failures. Native schemas, Uplift, capture, credential
contracts, source/startup and kitchen checks also passed. The staged OpenClaw
gateway dependencies and native compatibility assertions pin the tested pair.

Reuse the OpenClaw provider, run ownership, queue and session and the existing
Jarvis submission, execution grant, artifact and domain owners. A private native
projection experiment passed exact source handoff on both versions. Moving
that handoff before tool discovery in a second private 2026.9.9 copy enabled
the first fresh-session Lists read. The final experiment passed three mapped
reads and rejected the unmapped actor. All four reply bodies arrived. One
lacked its expected reference and the native runtime reported delivery
uncertainty. Both native experiments remain separate from stock. The
[native hook investigation](NATIVE-TASK-HOOKS-AND-ANALYSIS.md#discord-source-evidence-and-queue-upgrade)
records the remaining stock runtime gate. No cutover or live Discord test send
took place. The ordinary release and its protected config and data require no
rollback.

## November 5, 2026 Discord short follow-up and overlap verification

The private early-source 2026.9.9 runtime with local Qwen3.8 27B passed all four
sequential exact source, model input and persisted Discord reply checks.
A literal `lol` used the preceding context. New-topic and correction turns
answered their own prompts. The controlled overlap case reproduced reuse of
the active run and original reply reference on stock and experimental builds.
Per-channel `followup` produced separate native turns and household sources.
The narrow Discord adapter candidate supplied the queued implicit references.
The combined synthetic check passed five exact replies, including two inputs
received before the held inference ended, with no duplicate or uncertainty
notice. The earlier false notice has a separate upstream fix already on main
and the official beta. Stock runtime and live cutover remain separate.

## November 5, 2026 Hardy Home archived chat recovery

The exact archived session rejection in stock OpenClaw 2026.9.8 occurred
before admission. Read-only checks found no exact native run, queued input,
execution grant or effect. The original signed request and attachment remained
in custody. Restored the same native session with its expected session ID,
then reconciled that exact request to the front of the queue. Its card scan
committed one Rolodex record and completed. The later signed request remained
separate.

The app backend now classifies that exact correlated gateway error as a
terminal failed send. It no longer emits a redundant event on idempotent
receipt lookup. The canonical submission event and HTTP receipt remain.
Both source changes and their regression cases passed all 521 backend tests
against the installed SDK. The guarded source-only update restarted household
control after both requests settled, retained a source rollback copy, and
passed health verification with the gateway active.

## November 5, 2026 Recipe references in Knowledge

The recipe tool extends the existing native memory owner. The same scoped
wiki writes Markdown and refreshes its native SQLite snapshot. Aliases and
ingredient text use candidate lookup metadata. They do not enter the grounded
fact capture, topic or daily journal path. The signed Knowledge views use
the same read authority and recognize the recipe namespace.

The Lists owner reads an existing note by exact ID and audience. Recipe import
keeps the note text and records its ID and digest. The old note remains as
historical evidence. New recipe saves use the current human turn and the
existing audience checks and effect ledger. Exact repeats use the same page.

Hardybot passed 524 backend tests, all 88 native schemas, eight capture tests
and the startup check. An isolated stock gateway verified native readback and
SQLite metadata after restart. A separate 1,000-recipe fixture resolved a
known title, alias and ingredient in 3–7 ms per local gateway call. Its full
native compile took 11.4 seconds, close to the 15-second default write deadline.
The measurement covers local lookup, without model inference.

The first guarded restart reached its health deadline just before the gateway
listener opened and restored the prior source and config. The retry extended
the startup window and verified both services ready on the same candidate.
The signed Hardy Home acceptance filed the household taco seasoning reference,
verified exact original body readback through Knowledge, and used separate fresh
native sessions to find and open the recipe by alternate name and ingredient.
The live SQLite snapshot contained the recipe path and its lookup metadata.
The original note remains in place. The protected rollout receipt retains a
matching source and configuration rollback copy. The update ran no database
migration and scheduling stayed disabled.

## November 5, 2026 Public web search

The Michigan comparison turn could not discover stock web search or fetch.
The parent tried offline analysis, which produced a template without any
verified vote totals. The absence predated the recipe update. The native agent
allowlist omitted both tools, the trusted invocation policy did not admit
them, and no search provider was configured. The legacy SearXNG container was
absent.

This change reuses stock OpenClaw `web_search` and `web_fetch` for current,
authorized adult root turns. The existing domain grant carries private and
shared audience policy. Parent turns can retrieve public sources before
handing data to the offline analysis worker. OpenClaw owns fetch, provider
transport and caching. The loopback-only Compose service is the SearXNG
provider. The installed plugin matches OpenClaw 2026.9.8 and loads from an
explicit provider path.

The Ubuntu candidate passed all 527 backend tests, 88 household tool schemas,
eight capture tests and startup. Isolated stock OpenClaw returned public search
results and opened a public page, denied a loopback fetch, and omitted search
for the test child. The final provider settings returned expected official
sources across Python, OpenClaw and NOAA probes. Upstream engines can refuse
automated requests. The tested configuration includes more than one public
engine and selects SearXNG explicitly at the OpenClaw boundary.

The guarded promotion preserved matching source and both protected configuration
preimages. It enabled the web grant for Owner's current personal and household
audiences and brought both services back ready. A fresh signed Hardy Home chat
used the native search result to open the official Python documentation, then
cited that URL in the answer. The first verification parser missed OpenClaw's
external-content wrapper. The correlated persisted native calls, HTTP 200 page
result and final answer independently verified the completed turn.

## November 5, 2026 Hardy Home image replies and text selection

Hardy Home 0.5.3-alpha matches exact artifact IDs in assistant replies to
authorized raster outputs in the current workspace. Thumbnails use bounded
downloads and a conversation-scoped memory cache. A tap opens the existing
private preview. Chat text uses Android's native long-press selection.
The change reuses the existing signed workspace and artifact routes.

The signed API returned the saved dog PNG with the expected hash and dimensions
and rejected the same artifact from a different chat. The Ubuntu Android build,
lint and all ten unit tests passed. The APK was signed with the installed
app's certificate and verified through the temporary LAN download. Installation
and gesture verification on the phone remain pending.

## November 8, 2026 Hardy Home time, conversation metadata, and reply display

The household conversation row owns the app title and tags. The signed
metadata route reuses the current chat capability and owner/agent binding.
Title and tags save in one SQLite update. The schema 5 migration adds a
default-empty tag field to older rows. Native session keys, audiences, and
submission history retain their existing authorities.

Hardy Home's history projection skips assistant messages attached to tool
calls and excludes typed reasoning blocks. In recent live transcripts, one
submitted prompt produced two intermediate messages and one final answer
within a single run. The previous projection displayed all three. Genuine
reply messages retain their native identities even when their text matches.

The Android build uses America/New_York for display. The stock OpenClaw
user timezone now uses the same zone, including daylight-saving changes.
Backend startup, the full installed-SDK suite, the signed SQLite round trip,
and the read-only replay of recent live gateway histories passed. The Android
APK was rebuilt from the newer client source, verified with the prior phone
certificate, and checked through the private LAN download. Phone interaction
remains pending.

The protected source and configuration preimages are available for rollback.
A source rollback can retain the additive metadata column and newer records.

## November 8, 2026 Chrome companion parity

Android remains primary and Chrome parity updates are on demand. The initial
Chrome release now reuses the Android-facing workspace, task control, question,
approval, artifact and library APIs. The existing household service and
OpenClaw keep authority over grants, transcripts, delivery receipts, effects
and durable execution. The browser's IndexedDB cache retains local file drafts
and exact unresolved sends bound to the enrolled device. The signed server
continues to enforce private and household scope.

An isolated Ubuntu Chromium run verified enrollment, raster previews, goal
controls, linked clarification, approval, camera capture with fixture media,
file draft recovery, upload, local-only speech API settings, library navigation,
contextual focus, same-ID recovery and the explicit fresh-ID retry for a
confirmed pre-dispatch failure. The live smoke read workspace, history and
authorized library views with a temporary device and revoked it afterward.
The full backend and kitchen signing checks passed. Physical media use is a
separate device check.

The protected rollback copy contains the prior Chrome source and static route.
The release needed no household database migration. Browser key storage
migrates additively when Chrome loads the new release.

## November 9, 2026 Android journaling dictation

Android owns foreground recording and app-private retry data. The existing
signed personal-device protocol and voiceInput capability govern the bounded
draft-transcription request. The household service reuses its bounded local
process runner with a pinned offline Whisper CPU model. It creates no chat,
task, artifact or submission from the recording. The caller reviews the
resulting draft and explicitly sends it in the current mode.

Ubuntu passed 530 backend tests, Android assembly, lint and 11 unit tests.
The isolated signed route verified speech across a 25-second pause, rejected
tampered and malformed requests, and left the conversation and submission
stores empty. The first live assertion treated punctuation as a missing
passage and triggered source and configuration rollback. The successful retry
checked both spoken passages independent of punctuation. The temporary
verification devices were revoked. The prior service source, protected
configuration and Android source remain available for rollback.

## 2026-11-16 Fitbit sync control candidate

Prepared signed own-profile status/start/stop, device-bound idempotent receipts, an additive application schema-6 table and a focused Chrome Sync my Fitbit card. Full service checks: 522 passed, 16 skipped, no failures; native lifecycle checks: four passed; signed browser enrollment/control/other-child hiding passed. The real first guest cold-started and opened the official app in about 12 seconds, retaining its bond. These checks do not prove new steps or cloud API authorization. Protected radio installation, live deployment/readback and child browser enrollment remain the next steps; private operator evidence owns the executed deployment status. No new model tools or Google credential store.

## 2026-11-16 Fitbit sync control implementation

Deployed signed own-profile status/start/stop, device-bound idempotent receipts, additive application schema 6 and a focused Chrome Sync my Fitbit card. Child One's protected guest binding is enabled after owner installation of the constrained radio service. Child Two's existing fred ID is retained with corrected display name; his fresh guest awaits owner pairing. Native boundary protocol 0.7.0 remains unchanged while the service/UI is 0.8.0 and HTTP API is 0.6.0.

Final Ubuntu checks: 535 passed, 6 skipped with the installed SDK; five native lifecycle tests; signed browser enrollment/control/other-child hiding; source/startup validation. Real signed control started Child One's actual guest and official app, replayed without restarting the session and stopped cleanly. Cold boot retained the bond; a short automatic session stopped itself and its guest. Fixed the isolated subprocess's user-bus environment and cancellation during guest startup. Failed attempts remain in private evidence.

Added HTTPS as a second transport over the same application, identity and nonce ledger, with protected PEM loading. TLS tests prove one startup and cross-transport nonce replay rejection. Live chain/IP/ready/home checks pass. The owner setup bundle contains only a public constrained CA and per-Windows-profile desktop shortcut. Child-PC enrollment, fresh-step/background proof, Child Two's pairing and two-account radio handoff remain pending. No cloud reader, API tokens, model tools or second credential store was added. OpenClaw was not restarted; no database was restored.

## November 25, 2026 — protected Connections pre-deployment preparation

Implemented owner-only web/Android Bitwarden setup, transient password entry,
Google OAuth consent and secure completion, token storage and scoped account
binding. Reused device signatures, native request authority, the household
SQLite metadata owner, Bitwarden SDK 2.1.0 and stock OpenClaw tool policy.

Verification passed on Ubuntu with 557 backend checks, five Bitwarden checks,
12 isolation/deployment checks, 16 browser cases, Android assembly/lint and
11 Android unit checks. Source and actual installed-SDK checks passed without
provider access. The generated Android transport matches API 0.7.0.

Administrator deployment was pending at this stage after automatic approval review rejected a privileged container installation method. Ordinary runtime and browser assets were retained. The subsequent deployed and owner-setup results are recorded below. Changes and rollback are recorded in the Connections implementation and isolation runbook.

## November 25, 2026 — protected Connections deployed

Activated household control 0.9.0 / API 0.7.0 / schema 7 with owner-only
Connections in Chrome and Android 0.6.0-alpha. The dedicated credential process
owns Bitwarden bootstrap, password entry and Google OAuth. Existing SQLite
authorities own device/nonces/connection metadata; Bitwarden owns secret values.
Scoped native consumers use immutable secret IDs and current authorization.
The native composition root explicitly injects the broker from protected
environment configuration, including when no inherited socket setting exists.

Root-owned effective configuration, code and static assets plus gateway PID/hash
attestation gate setup. Main/Adult shell, file and browser routes are denied.
Offline analysis children retain stock sandbox execution. No parallel task,
credential, identity or scheduling authority was introduced.

After explicit owner approval of the temporary AppArmor exception, the bounded
networkless maintenance container started the reviewed host installer through
systemd and was removed. Failed snapshots and repair evidence were retained.
Snapshot dependency links were rewritten only for the pinned OpenClaw package;
the public integration manifest and stock plugin-skills projection were included.
A separate protected Node inode preserves user-owned SecretRef validation.
Mapped root ownership in the user-service mount namespace is checked against
that namespace's root identity. Existing business records were not restored.

Final Ubuntu acceptance: 558/558 backend checks, zero skips/failures; five
Bitwarden checks; 16 isolation/deployment checks; 16 synthetic browser cases;
Android assembly, lint with zero errors and 11 unit checks. Live HTTPS passed
nine owner/rejection/asset checks. Temporary devices were revoked. Actual stock
core tools for Main/Adult had no prohibited host tools. Security audit after
credential daemon restart, enabled boot units, dependency imports and synthetic
cross-user SQLite sidecar access passed. Eleven historical jobs remain disabled.

Real vault setup, Google consent and phone interaction remain owner steps.
Financial feeds and concrete saved-password browser consumers are separate
integrations. Rollback retains current databases, vault state and provider
effects. See credential-connections-implementation.md and
credential-flow-isolation.md for ownership, reuse and rollback details.

## November 25, 2026 — live Bitwarden setup verified

The owner enrolled the new personal browser and configured Bitwarden through
Connections. A service-identity check verified isolation, machine authentication
and the exact selected organization/project. A single random dummy secret passed
create/readback, read, expected-value update/readback and exact-ID removal. The
provider acknowledged deletion and no longer listed that test ID. No existing
account secret values were inspected and no Google grant was requested. There
are no saved account connections yet; Google setup remains pending.

## November 25, 2026 — OAuth client whitespace and completion diagnostics

Deployed service 0.9.1 and built Android 0.6.1-alpha / code 11 after a real
account-completion failure. A content-free stored-versus-trimmed synthetic-code
comparison isolated outer client-secret whitespace. Expected-value replacement
and readback corrected the same Bitwarden app secret while the daemon was
fully stopped; the Google client ID/redirect and account grants were preserved.

Added OAuth-only clipboard normalization, fixed exchange/verification error
classification and final request-boundary retry prevention. The stock SDK's
numeric retry configuration required explicit zero values in addition to
retry:false. Clients now explain manual localhost completion, settle readiness
and avoid promising unsupported machine-token replacement. Password whitespace,
PKCE/state, identity/nonce, requested scopes and current owner checks remain.

Ubuntu: 574 backend checks, zero skips/failures; 189 source files validated;
28 browser checks; Android assembly/lint and 11 unit checks passed. Protected
HTTPS is ready at 0.9.1, reviewed browser bytes match and isolation passes.
At this patch stage, fresh owner consent and actual mail/calendar read acceptance were pending. The later owner consent and Gmail results are recorded below. Source preimages, failed
maintenance attempts and the secret-free repair receipt are retained.

## November 25, 2026 — first live Gmail grant verified

Owner consent saved the first Gmail read-only account grant. Production-service
verification passed fresh verified email/subject identity, two offline refreshes,
search and metadata-only message retrieval. Calendar scope denial and final
connected status passed. No account contents or secret values were emitted.
No refresh-token replacement was issued. Exclusive stopped-daemon execution
retained one credential writer; restart, HTTPS readiness and container cleanup
passed.

At this stage, one start of the exact ordinary local Ollama container failed at the NVIDIA hook because the running kernel had no NVIDIA module. Read-only package simulations established repair choices. The separately approved recovery and later native attempts are recorded below.
The failure and private provider acceptance receipt are retained.

## November 25, 2026 — approved NVIDIA recovery

Applied the owner-approved Ubuntu plan: 16 upgrades, three new packages and one
old kernel-module removal. Preserved the old module/package metadata and matched
all downloaded hashes to the approved official repositories. NVIDIA 595.99.02
loads for current kernel 7.0.0-43; RTX 3090 visibility and package audit pass.
Started only the existing pinned Ollama container, verified 0.32.15 and the
configured Qwen model, without reboot or broader package cleanup.

A single direct Qwen canary used the configured 32K context, no tools/account data
or fallback, and returned exactly READY. Package/GPU/HTTPS and disabled-job
postchecks passed independently. This is provider inference evidence only.
The subsequent real private Gmail attempts are recorded below. Calendar remains separate. Source, credentials, native configuration and business databases were
not replaced by this operating-system repair.


## November 25, 2026 — native catalog discovery deployed

Deployed household control 0.9.2 with the existing catalog projection adapted to
stock SDK metadata discovery before a live invocation exists. Current canonical
conversation/profile/grant and audience metadata determine available schemas.
The stock invocation guard and existing admission, source/session generation and
revocation checks continue to govern execution. Added the two missing connection
discovery names and their optional metadata to the plugin registration manifest.

Protected source ownership, actual 90-name CLI registration, both discovery
entries, gateway PID/configuration/domain attestation and trusted readiness
passed. The owner-authored private Gmail test reached the native surface but
failed with `native_session_generation_changed`. Its exact attempt and evidence
were retained for the forwarding repair.

## November 25, 2026 — authoritative invocation snapshot forwarding

Deployed household control 0.9.3 after the native generation mismatch. The
runtime freezes one enriched invocation from the existing native context observation, validates it with unchanged `NativeDomainAuthorization.resolve()`, and forwards the exact eight identity/session/run/goal fields through `scope.credentialAuthority` for that same invocation. Source
and session generation, identity/device, private audience, personal and selected
account grants, cancellation, revocation and credential isolation remain checked.
No new execution owner, queue, identity store or credential mirror was introduced.

Ubuntu passed 584/584 backend tests with zero skips and validated 191 source files. Independent
protected-file/manifest/90-tool registration, attestation, security audit and
trusted HTTPS 0.9.3 checks passed. NVIDIA 595.99.02, the RTX 3090 and the existing
Ollama 0.32.15/Qwen3.8 runtime remained ready. All 11 retained jobs were disabled.

A single automated canary enrolled a temporary personal device and submitted a
new private owner chat through the normal signed application API. Native account
discovery confirmed the selected immutable connection before a connected-Google
Gmail search with `newer_than:7d` and limit 1. Exact native metadata verified call
order, account/connection binding and the successful provider result. The
assistant returned only the success marker. The device was revoked and the
conversation, submission and audits were retained. Exported evidence contains only IDs, statuses, tool names and boolean checks.

The helper used task mode and created a formal goal without its required completion checkpoint. The canonical receipt correctly ended `failed` with `task_incomplete_after_native_run`. No execution or continuation remains active, and the failed source cannot authorize further reads. The failed attempt and idle goal are retained. A separate helper with ordinary private-chat conversation mode, a distinct title and submission prefix was staged for the following verification. Core task-completion policy was preserved. The earlier 0.9.2 generation-change failure remains a separate retained attempt. Direct Google verification remains passed. Calendar,
financial consumers, phone interaction and live Google refresh-token rotation
writeback remain separate acceptance work. The release remains pre-production.


## November 25, 2026 — signed ordinary Gmail conversation verified

The separate automated signed canary passed the normal private-conversation
pipeline on deployed 0.9.3. A temporary enrolled personal device created a new
private owner chat and submitted one conversation-mode request. Actual native
connection discovery confirmed the authorized account and selected immutable
connection before one connected-Google Gmail search with `newer_than:7d` and
limit 1. Exact native metadata confirmed the required order and binding, with
no other provider or domain calls. The assistant returned only the success
marker. The canonical receipt ended `complete`, native completion was confirmed,
and the device was revoked with no recorded uncertainty.

Conversation, submission and content-free evidence were retained. The prior
task-mode `task_incomplete_after_native_run` attempt and the owner-authored
0.9.2 `native_session_generation_changed` failure remain separate retained cases.
The successful test used ordinary conversation mode and preserved existing
formal-goal completion policy. No source or authorization policy change was
needed for that mode correction.

Current 0.9.3 remains ready with the protected native boundary, NVIDIA 595.99.02
and the existing pinned Ollama/Qwen runtime. All 11 historical jobs in the current
protected runtime partition remain disabled. Direct provider verification remains
passed. Calendar, financial consumers, phone interaction and live Google
refresh-token rotation writeback remain open. Household functional acceptance
and production publication remain outside this bounded Gmail verification.


## November 25, 2026 browser chat layout and sidebar organization (0.10.0)

Reproduced the browser composer disappearing below long history at ordinary
zoom. Reused the existing web client and signed API, bounded the app shell and
made sidebar/messages scroll independently. Added inline conversation rename,
move and retained delete, durable personal folders, pointer drag/drop and a
keyboard/touch Move fallback. Narrow layouts use an in-app Chats drawer;
auxiliary panels and the composer remain bounded.

Extended the canonical household database to schema 8 for private folders,
per-viewer placement and retained conversation tombstones. Title-only rename
preserves tags atomically. Folder deletion returns chats to Unfiled without
changing audiences. Owner-only chat removal rejects active, continuing or
unsettled work and uncertain native state. Current identity/native state,
atomic admission and delayed-read guards prevent subsequent access or effects
through removed chats. Native history, artifacts and exact effects remain
retained. No second store, execution system, queue or credential path was added.

Ubuntu passed all 593 installed-SDK tests with zero skips, 194-file source
validation and API 0.8.0 generated-client consistency. The browser campaign
passed 17 checks plus the targeted stale-folder-response regression, including
2,000 synthetic messages, 406 conversation rows, short/narrow viewports, real
pointer dragging, refresh/persistence, inline cancellation/error recovery and
mobile navigation. Earlier browser failures and the first backend response-shape
failure remain retained. Android was not rebuilt; simulated keyboard space and
pointer tests do not certify physical touch/keyboard interaction.

Deployed service/UI 0.10.0 while keeping native boundary 0.7.0. Reviewed source
and consistent database preimages were retained. The release installed 35
protected files, awaited ordinary readiness/schema 8 before credential startup,
and passed all 12 served asset hashes and credential-isolation audit. No active
accepted work was interrupted and no database was restored. No verification
renamed, moved or removed a production chat. Credentials, Google grants, model
settings and the retained disabled schedules remain unchanged. See the
[ownership, evidence and rollback record](web-conversation-organization.md).

Independent postdeployment verification passed all 37 checks, including exact protected file/asset identity, native PID/config attestation, schema/admission fences, disabled scheduling and unchanged local provider health. This check made no model or account-provider calls.


## November 25, 2026 ordinary Gmail default route (0.10.1)

The owner-authored ordinary house-mail request omitted connectionId under the
published tool contract, so it selected the old CLI and failed dependency lookup.
The earlier live canary had explicitly selected the saved connector and missed
this branch. The saved owner Gmail grant remained connected.

Reused protected google.account and canonical owner/scoped connection metadata
inside the isolated credential daemon. Omitted email IDs resolve only that
approved default; ambiguous, missing or unavailable matches fail closed.
Explicit account selection remains available, discovery exposes a consistent
connectionId field, and schemas/skill/domain guidance agree. Calendar routing,
model settings, consent, credentials and public API/schema/native versions did
not change.

Passed 603/603 installed-SDK checks, 195-file source validation, generated-client
consistency and 23 independent deployment checks. A normal signed private
verification prompt supplied no tool names or connector ID. One real search
omitted the ID, resolved the approved account, completed the seven-day search
and canonical receipt, and revoked temporary access. The separate user request
that read 18 messages and then hit context overflow remains retained; successful
mailbox reads do not prove long-context summarization. See the
[route and ownership record](default-gmail-routing-repair.md).


## November 25, 2026 context-overflow diagnosis and unshipped precheck

Confirmed context_overflow after one atomic 18-message read block, rather than a
credential or disk failure. Native recovery attempted compaction twice but could
not retain a complete recent exchange. Earlier shortened history previews hid
the size of original search results; immutable native snapshots corrected that
diagnosis. No repeated per-turn application contract injection was established.

A supported mid-turn-precheck preparation candidate passed 605 component checks.
Its isolated existing-chat lifecycle then completed with real local summaries,
unchanged session/source authority and a productive post-compaction read.
A separate fresh-chat case failed Nothing to compact while actual input fit.
That regression blocked global activation. Restored the exact two preparation
preimages while retaining all candidates/attempts. The restored accepted source
passed 603 installed-SDK checks, zero skips, and 195-file validation.

A separate synthetic 64K one-token probe fit fully on GPU, then restored ordinary
32K. The protected configuration hash did not change. This is a memory-fit
measurement, not full long-context or multi-user acceptance. No context or
compaction setting was promoted, and no business database or session history was
restored. See [context investigation](native-context-precheck.md).

## November 25, 2026 64K Main default and dual-GPU/model readiness

The owner authorized 64K as Main's default and requested dual identical GPUs
support one shared model before any parallel serving/resource manager. Added
the second-card and stronger-model assessment. Existing stock Ollama/OpenClaw,
protected configuration, native sessions/compaction and household data/authority
owners are reused; no queue, store, task engine or model daemon was introduced.
The previous accepted stronger-local plan selected the current 27B model; no
specific larger successor had been accepted. Qwen3.8 27B Q8_0 is the first
proposed precision comparison, not a promised capability improvement. No new
weights were downloaded or model switched.

Fresh/existing signed-app and stock-gateway synthetic chains completed at
45,946/48,405 actual input tokens, with real Qwen capacity/summarization and
deterministic tool planning. Each completed three large reads, an atomic
18-read group and a terminal read; current authority/contracts and zero effects
were retained. Existing automatic compaction reduced 48,555 to 11,262 tokens.
The fresh automatic compaction was interrupted by fixture teardown after
completion; later chronology linked its generic failure to gateway shutdown and
cancellation. This does not establish model-summary failure. Clean fresh 64K
compaction and productive post-compaction execution remain unproven. Retained metadata-mismatch and
manual-RPC assertion failures are documented; no broader acceptance is claimed.

Changed only Qwen contextWindow and params.num_ctx to 65,536 in active protected
configuration and retained preparation input. Other model/profile settings,
output descriptor, precheck-off state, grants and disabled scheduling remain.
The first atomic replacement lost a named read ACL and prevented startup;
restored the exact installer rule and completed protected-preimage, PID/config,
readiness and service-context isolation verification. No source deployment or
database restore occurred. Configuration rollback preserves extended ACLs and
never overwrites newer records.

Only one GPU is currently installed. Driver/container visibility and board lane
topology support the planned expansion, while actual two-card distribution,
thermals and latency require post-install verification. The owner confirmed PSU
capacity. Keep one shared instance, explicit spread and sequential inference;
parallel GPU assignments and resource management stay deferred. See
[context evidence](native-context-precheck.md) and [model/readiness assessment](dual-gpu-model-readiness.md).

Independent postdeployment verification passed all 28 checks, including actual
64K full-GPU residency, protected hashes, ACL/native PID/config attestation and
disabled scheduling. A normal signed private Gmail canary completed one approved
connected search after a pre-provider native rejection. The reused strict test
flagged native discovery/yield control calls; a separate read-only observer
verified no other provider/domain access, canonical completion and device
revocation. Both the initial harness result and native control errors remain.

## November 25, 2026 compaction failure cause correction

The owner asked whether compaction failure indicates model inability or a system
issue. The original 32K mailbox failure was conclusively a runtime retention/
budgeting rejection before summarization inference. At 64K the same Qwen model
successfully summarized the existing-chat case from 48,555 to 11,262 tokens.

A targeted read-only timeline review corrected the fresh 64K interpretation:
manual compaction was rejected while native work remained active, and the test
helper's error cleanup terminated the gateway. Shutdown began three milliseconds
before the generic failed-compaction record, followed by cancellation. Preserve
those events and the original test result; classify the attempt as fixture
interrupted, not proof the model cannot summarize. The catch-all internal error
alone cannot identify its precise cause. Clean fresh compact-and-resume proof is
still pending. No new inference, mailbox access, tests, deployment or runtime
configuration change was performed for this diagnosis.

## 2026-11-25 Child Two virtual Android continuation

Resumed the existing independent second guest. Owner-applied standard KVM group
membership repairs access lost after the earlier host reboot. The existing
user manager had stale groups, so both fixed native guest units and their source
template now use sg kvm for the protected launcher. Native-unit KVM API12 and
empty-VM creation, unit verification and actual Android14 boot passed. The guest
reports Bluetooth ON and its address matches the physical controller through a
read-only host query. The owner-only loopback console and management SSH tunnel
are ready; official Play listing opened before credential handoff.

Owner Google sign-in, official-app installation, Charge6 pairing and new-step
acceptance are pending. Existing guest/account disks are preserved. No household
HTTP code, other domain grants, scheduler or provider credentials were changed;
OpenClaw was not restarted. Failed permission attempts and before-files remain
in protected operator evidence.



## November 25, 2026 native context budget and progressive Google repair

Deployed household control 0.10.2 with the owner-approved exact-version OpenClaw
2026.9.8 V5 patch (eight files). Corrected selected Qwen `contextTokens` 32768→65536
in both protected/retained inputs, aligning native budget with existing 64K
provider allocation. Other models/GPT32, generation settings, grants and scheduling
remain unchanged. Complete configuration ACLs/xattrs and operator SDK bytes are
preserved; no database/session/provider records were restored.

Verified provenance now survives native tool converters; bounded source-hash
recipes survive the ordinary 8K details reducer under the same text policy.
Generic lossless SDK dedup is separate from email-only body omission. Google
windows recheck current grants and scope-bound versions. No second engine/store,
mailbox cache or email/tool/turn count was added.

Passed 621/621 application tests, zero skips, 199 source checks, 34 native Gateway/
cold-replay/redaction/forgery checks and 16/21/11 Python checks. Both signed-app
stubs and both real local-Qwen capacity/summary cases passed original 18-result
workflows, new-source productive continuation, full 11-window reconstruction,
current authority and zero effects. The natural Gmail check and all 37
independent postdeployment checks passed. Broad natural household acceptance and
held grants remain separate. See the [repair record](context-budget-repair.md)
for exact acceptance levels, corrected mixed token telemetry and retained failures.

Native session/transcript/queue/compaction ownership remains OpenClaw's; household
services retain source/identity/grant/domain/effect authority, Gmail full content,
and the existing vault credentials. Partial promotion stays closed for forward
repair; rollback uses code/config preimages and complete metadata with fresh
attestation, never older business data. No commit/push/publication was requested.

Manifest 14bf0fe44bfa1f817f43fc3c7d68d014382710254309793c1b3657d76f07f351.
Patch 311e0a80e20ad3ff7fc4c6dc6edb256213676b5f48b44aaf3af58f07e577f4e6.

## 2026-11-26 shared dual-GPU readiness

Installed two RTX 3090 24 GiB cards and verified driver 595.99.02, kernel 7.0.0-44 and actual PCIe Gen4 x8 links on each. The existing Ollama container had lost GPU-device access. Its native-CDI recreation preserved the pinned 0.32.15 image, model digest/volume, runc, loopback endpoint and all configuration except the three approved spread/serial/single-resident-model flags and GPU request mechanism. The original container remains stopped and retained. Initial strict metadata guards failed on Docker's OomKillDisable null/false normalization; independent exact postverification accepted only that representation difference. No data or volume was restored or deleted. NVIDIA's documented legacy-hook/cgroup issue is relevant guidance, not proof of this host's original trigger.

Exactly two serial diagnostic requests then passed on the unchanged 27B Q4 model at 65,536 provider context. One runner was correlated to both devices, all 66 layers were GPU-offloaded, and API size equaled VRAM size at 22,286,759,358 bytes. Backend model buffers were 7,252.61/7,835.71 MiB; a 682.03 MiB CPU_Mapped buffer also existed. Peak sampled VRAM was 11,690/11,120 MiB and core temperatures 61/54 C; memory-junction temperatures were unavailable. Before/after checks found no new AER/Xid, reset, fallen-off-GPU, API mismatch or sampled thermal-slowdown evidence.

The cold request took 38.876 s including 23.698 s loading and 35.284 s to first byte. The warm request used 10,781 prompt tokens and took 6.449 s, with 2,205.73 prompt tokens/s and 43.417 generated tokens/s. Its request-local 64-token diagnostic limit ended with thinking only; this certifies bounded capacity/health, not answer quality or a long thermal soak. Production thinking, generation, model/profile and protected V5 source were unchanged; native work was idle afterward. Q8/larger-model comparisons remain proposed and no successor weights were downloaded. The registry assessment remains dated November 25.

The owner deferred router reservation/restoration, so household web services remain unavailable from the LAN address/bind/certificate mismatch. GPU testing changed no network, TLS, origin, grants, credentials or scheduling. See the [measured readiness record](dual-gpu-model-readiness.md) and [current availability](current-status.md).


## November 26, 2026 Main 128K and maximum compatible reasoning

Promoted only Main's selected Qwen context and reasoning defaults. The protected and retained preparation inputs now align `contextTokens`, `contextWindow` and `params.num_ctx` at 131,072, and Main `thinkingDefault=high` reaches native Ollama as `think:"high"`, mapped by the installed Qwen renderer to XHIGH. The model, GPT/default and other profiles, production output settings, compaction, grants and disabled scheduling are unchanged.

Two isolated serial capacity requests stopped normally with thinking and responses. All 66 model layers were offloaded, API size equaled VRAM size at 26,241,841,230 bytes (24.440 GiB), peak sampled VRAM was 13,566/12,996 MiB, and core temperatures reached 58/53 C. No new AER, thermal or kernel-fault evidence was observed. A roughly 10.8K-token prefill establishes bounded allocation/effort and hardware health, not near-full 128K performance or semantic certification. The request-local diagnostic output setting did not change production generation.

Both config replacements preserved UID/GID, modes and all xattrs/ACLs. The initial immediate post-start observer failed after publication; its failure and stopped-owner containment were retained. A forward start waited for the Gateway listener and unchanged owner observer, then passed without rewriting either config. Exact initial failure causality remains unconfirmed. Fresh PID/config attestation, isolation audit, live native registry and actual deployed serializer confirmed 131,072/high. Historical 64K compaction and productive-follow-up acceptance remains dated evidence. No session/database rewrite or restore, model replacement, source/SDK change or network repair was performed.

Household web access remains unavailable while router/network restoration is deferred. See [capacity and limits](dual-gpu-model-readiness.md), [repair history](context-budget-repair.md) and [operations](operations.md).


## November 26, 2026 read-only system status implementation

Implemented source 0.11.0's optional `diagnostics.system_status` using the existing native household diagnostics domain, authority checks and bounded process runner. The new collector is a fixed read-only adapter, with no input-selected command, endpoint or path, no daemon/store/queue, and no model invocation. Routine private operator chat can request a snapshot without inventing a diagnostic goal; current capability/domain grants and pre/post collection authority remain enforced. Existing evidence diagnosis retains diagnostic mode.

The collector returns timestamped hardware, CPU/RAM/root-disk, fixed service and loopback loaded-model observations. Collection completeness is distinct from service health, missing data is explicit, and physical VRAM, resident model/cache allocation and context capacity remain separate. Fixed subprocesses use a clean environment, bounded streaming output and owned-group cleanup; HTTP proxies and redirects are disabled and the total deadline is five seconds. Missing/unloaded units are not reported as healthy inactive services.

The installed-SDK backend run passed 635/635 with no skips, including 12 authorization and two policy checks. The earlier 623-pass/12-skip run remains retained; its fixture environment was resolved before the complete run. Python collector checks passed 25/25, installer checks 11/11, and source validation passed. A bounded live read-only snapshot returned two GPUs and the fixed host/service observations with no model loading or inference. Protected deployment of 0.11.0 subsequently passed: 12 exact runtime/source paths and two Main allow-entry inputs were promoted with full ownership/mode/ACL/xattr preservation, unchanged V5 patch and unchanged 128K/high defaults. Native registration confirmed the optional tool within the 91-name manifest, the deployed collector passed as the Gateway actor, and fresh PID/config attestation and credential isolation passed. These are deterministic checks; natural-language chat was not run because network restoration remains deferred. No inference, model loading, network repair, credential-grant change or database/conversation mutation was performed. See [implementation and acceptance](system-status-diagnostics.md).

## November 26, 2026 public OAuth information website

Prepared a buildless homepage, privacy policy and terms in the existing docs publishing source, with a local stylesheet and .nojekyll marker. Relative links support the free GitHub Pages project address without a custom domain. The pages describe the actual read-only connected Google tools, local processing, Bitwarden and protected bootstrap boundary, local retention, soft chat removal, disconnect/revocation and manual deletion limitations. They introduce no app login, analytics, hosted inference, service, store, queue or account grant.

The website reuses GitHub Pages and the existing public-source review process. Publishing settings and repository visibility remain owner actions. Free Pages eligibility for a public repository is separate from this repository's current visibility, and website publication is separate from Google production branding/domain verification. The setup guide records exact branch/folder and Google follow-up steps without claiming live publication or verification. Existing runtime and business data are unchanged. Ubuntu browser/publication checks and the resulting Git commit are recorded in the final task evidence.
