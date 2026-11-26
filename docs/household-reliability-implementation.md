# Household reliability implementation

November 4, 2026. Source implementation record for the authorized build-plan,
restriction and OpenClaw ecosystem follow-through. Stock OpenClaw remains the
runtime. This replaces the initial work plan; it is not a deployment or complete
workflow acceptance claim. [Current status](current-status.md) owns the running
release and actual campaign evidence. The verification section below records completed candidate checks and the
current final-verification blocker.

OAuth repair, vault/account bootstrap, receipt-project onboarding, family grants
and schedule activation remain held. Historical schedules remain retained and
disabled. No hosted inference, replacement runtime or legacy Jarvis activation is
part of this work.

## Resulting execution model

Main interprets human intent and composes authorized typed skills. Routine reads,
list changes, card intake, automatic memory and ordinary clarification need no
formal native goal, upfront outcome plan or progress ceremony. Matching authorized
skill instructions load mechanically before the operation; manual domain selection
is optional preload. Routine operation IDs and uniquely matching receipt links are
application-derived. These conveniences never supply identity, grants or proof of
a business result.

Longer work uses the existing native goal, child, yield and continuation lifecycle.
The actual native progress callback can arm unfinished-plan continuation; a saved
progress record alone cannot. Completion may declare semantic outcomes late and
uses current owning receipts or scoped output artifacts. Reads, model prose and
child announcements cannot substitute for committed effects. Existing verified or
human-bound requirements remain protected when Main changes its draft strategy.
No extra productive tool/turn cap, timer loop or self-prompt queue is introduced.

Blocking follow-ups use durable questions, followed by a natural visible question.
Replies are normal freeform prompts interpreted against current and suspended
questions. An independent new topic can execute in the same chat while the first
question waits. Nested questions retain their original source and attachments;
answering the side question restores the previous focus. Side-topic effects and
outputs have independent source scope and cannot complete the original goal.

V1 still permits **one formal native goal per conversation**. Independent ordinary
actions and question chains can coexist with it; parallel formal goals cannot.
Pending independent questions must be resolved or explicitly steered away before
that formal goal completes. Source settlement closes resolved waiting turn records
without turning question resolution into proof of business delivery. Native-end
settlement and maintenance recovery use the same source/run/session/control fences.
See [task-flow contracts](TASK-FLOW-IMPLEMENTATION.md).

## Reuse map and data ownership

Every change adapts an existing owner or adds a narrow adapter behind it. No new
canonical task engine, queue, approval broker, credential store, contact database,
memory database or event journal is introduced.

| Datum / effect | Decision and authoritative owner | Projection, consistency and deletion |
| --- | --- | --- |
| Session, goal, child runs, continuation and schedules | Reuse stock OpenClaw | Existing native persistence and lifecycle; application pointers do not become another execution authority. |
| Human source, identity, grants and invocation lineage | Adapt existing admission, submissions and native execution grants | Current checks fence every effect. Derived topic/source tags index existing immutable proof; they cannot grant authority. Existing retention and revocation apply. |
| Active/suspended questions, phase and handoff | Adapt existing checkpoint CAS and ArtifactStore | Immutable handoffs/questions plus one current pointer; restore original source and attachments. Retain history, including unreachable artifacts after a CAS conflict, under existing task-evidence lifecycle. |
| Household effects and uncertain operations | Reuse owning domain receipts and existing application effect/control receipts | Current owner state is re-read at completion/recovery. Preserve failed, unknown and committed records; no blind replay or rollback over newer effects. |
| Discord input bytes | Adapt trusted native media staging into ArtifactStore | Copy bounded authorized staged files once using message-bound idempotency; hashes and original input ownership persist. Native provider metadata or a model path is not custody. Existing artifact backup/deletion applies. |
| Scheduled message and delivery result | Reuse native job, preparation hook and outbound queue | Policy checks each new preparation. Accepted immutable messages follow explicit queue policy; execution and delivery are distinct native facts. No parallel outbox. |
| Captured facts and memory sources | Adapt scoped captured-source owner | Immutable source plus retirement/history metadata remains authoritative. Topic/journal parts and native compiler/search are derived; correction/forgetting prunes attributed entries across parts. |
| Card originals, extraction and Rolodex fields | Reuse ArtifactStore, Documents and Contacts respectively | Documents attests extraction; Contacts owns revision/history and later-human changes. Fresh OCR has operation-bound evidence. Retain originals and prior revisions; no Google Contacts mirror. |
| Calendar event and verification | Adapt Google adapter | Provider event is authoritative. Normalized readback proves requested fields; an application receipt is not a second event store. |
| Financial receipt acceptance | Reuse Uplift | Existing exact-money/revision/grant/transaction rules and accepted-only reporting remain intact; this pass adds no competing financial ledger. |
| Diagnostic observations | Adapt native hooks/adapter into existing private ArtifactStore evidence | Exact source/run/session metadata only, maximum 64 immutable captures per run. Reads verify scope/integrity; absent data stays unavailable. Retention follows existing artifact lifecycle, with no new retention service. |
| Credential value and rotation | Adapt exact-ID Bitwarden resolver plus trusted SDK connector | Bitwarden remains authoritative. No credential mirror; expected-value check and exact write/readback precede rotation success. Existing integration receipts own uncertain outcomes. |
| Skill/schema, app and kitchen views | Adapt current catalog, loader, API and display owners | Rebuildable scoped projections of their named owners. Display publication retains immutable output and expiry; it does not create an editable list/calendar authority. |

## Eight implementation gaps

The eight audit gaps now have source implementations. This means the missing code
paths and focused contracts exist; it does not mean every natural model, provider,
Discord or physical-device workflow has passed.

| Audit gap | Implemented source behavior | Remaining acceptance / limit |
| --- | --- | --- |
| Same-chat task switching | Source-scoped active/suspended question stack; independent authorized actions and nested freeform follow-ups preserve the original question, side source and attachment custody. Source settlement distinguishes resolved turns from delivered effects. | One formal goal per conversation. Natural interruption, nested answer, compaction and actual restart cases remain campaign work. |
| Discord image custody | Native `message_received` observes canonical staged `media`; `message:preprocessed` completes pending staging using exact session/message/sender/run correlation. Image/PDF bytes enter the existing ArtifactStore before source admission. Image-only prompts keep their true empty text. | Only supported, bounded staged local files acquire custody. Owner Discord/card end-to-end acceptance remains open. |
| Scheduled result delivery | Create/update select the trusted current conversation or protected notification destination; quiet work explicitly uses `delivery.mode=none`. Saved route readback, job admission, capabilities and initial message preparation recheck current grants/audience/routes. | Scheduling remains disabled. Strict retry revocation is unsupported by the pinned SDK; see the queue boundary below. Real delivery/restart acceptance remains open. |
| Targeted diagnostic evidence | Select affected submission or retained native run; normalize existing `user:` source references; read the actual selected session/goal checkpoint. Combine scoped effect/request codes with exact-run native budget/usage/finish observations and passive hook metadata. | Owner-only/private evidence, no raw logs/transcripts/secrets and no repair. Missing historical metrics or expired bindings remain unavailable. Natural explanation acceptance remains open. |
| Memory growth and partial curation | Deterministic native topic/journal continuation parts keep each generated body within 20,000 characters / 350 lines. Source/claim markers reconcile already committed parts and finish missing projections; forgetting/supersession reaches every part. | No new rollover ledger. External concurrent native writers still lack atomic CAS; broad shared/restart/restore acceptance remains open. |
| Calendar verification | Comparator checks normalized explicit popup/email reminders, explicit empty reminders and effective IANA endpoint time zones as well as existing fields. Provider defaults cannot prove requested overrides. All-day semantics remain separate. | No OAuth/account/attendee activation. Real provider recurrence/reminder/invitation acceptance remains open. |
| Fresh OCR redo | A new redo operation requires a newly attested local OCR extraction; a prior handle cannot satisfy freshness or mask extraction failure. Exact retry reuses the same redo operation. Ordinary reinterpretation/correction can reuse evidence and preserves untouched fields. | Later current human prompt and current revision remain required. No silent merge/enrichment; noisy, multi-sided and multi-page cases remain open. Page/block attribution is still advisory. |
| Credential lifecycle | Trusted provider refresh preflights exact write grant/configuration/executable/SDK readiness before reading a secret or calling a potentially rotating provider. Replacement requires authoritative writeback/readback. Explicit exact-origin browser delegation is a trusted consumer contract. | Official SDK 2.1.0 is installed in an isolated Ubuntu connector environment and import readiness is established. No actual vault/bootstrap/bindings, provider refresh or browser login has been accepted; concrete provider/browser wiring remains held. |

See the original [build-plan audit](build-plan-audit-2026-11-04.md), the
[data-gap implementation](data-gap-implementation-2026-11-04.md),
[memory owner](memory.md) and [platform connector contracts](../tools/README-platform.md).

## Proportional restrictions

- Recoverable list removal executes under the current authorized request without
  a second confirmation. Removed items retain stable IDs and can be restored.
  Destructive provider deletion, source forgetting and audience changes retain
  their actual approval/permission boundaries.
- A current authorized adult request can publish an owned eligible household
  output to the kitchen screen, including an output from a previously completed
  task. It needs no second confirmation. The source must already be household
  output; private content, diagnostics, private financial reports and child
  publication remain ineligible. Publication is never automatic.
- Analysis can start from an admitted ordinary source without a formal goal. The
  existing exact child-admission/control receipt prevents an uncertain spawn from
  being blindly repeated. Native sandbox, input/output custody and no-network /
  no-secrets boundaries remain. Report publication is separate from operational
  mutation; diagnosis can publish a bounded text report without gaining execution.
- Automatic matching skill loading replaces repeated selection bookkeeping while
  current catalog/schema/invocation checks remain. Legacy verify/finish endpoints
  are internal compatibility dispatch, not advertised ordinary workflow steps.
- Protected native plugin approvals adapt allow-once/deny into the existing
  question/source/control receipt. The exact private operator reviewer route must
  be proven. A run/tool-call barrier awaits durable decision persistence because
  native resolution callbacks are not awaited. Normal text cannot impersonate an
  approval, and no second approval queue exists.

These simplify unnecessary ceremony. They do not turn tool availability,
credentials, external content or model confidence into authorization. The earlier
[bookkeeping implementation](bookkeeping-simplification-implementation.md) remains
background for direct actions, automatic IDs, late outcomes and owner proof.

## Scheduled notice commitment boundary

The default explicit queue policy is `finish_accepted`. The native
`message_sending` hook checks current protected policy before preparing a new
message. Native acceptance of that immutable prepared batch is the external-effect
commitment boundary. After acceptance, that exact message may finish even if a
grant changes; revocation blocks new preparations and cannot retract an accepted
message. Failure, recovery and auto-disable notices use the same per-job delivery
session. All enabled jobs, including deliberately quiet jobs, therefore require
non-global native session scope so operational notices retain job provenance.

Installed OpenClaw 2026.9.8 reuses a saved `preparedBatch` during retry without
rerunning this hook. It exposes no supported per-provider-attempt policy callback
with the required job identity. Choosing `recheck_each_attempt` consequently blocks
activation with `native_scheduled_delivery_retry_guard_unavailable`; it cannot
silently degrade to `finish_accepted`. Global session scope also blocks activation.
Unknown delivery remains unknown and is reconciled through native delivery state,
not resent from an application queue. See [scheduled notice authorization](scheduled-notice-authorization.md).

## Diagnostic and credential boundaries

Native `model_call_ended`, `llm_output` and `after_compaction` observations contain
only whitelisted numeric usage/context/timing fields, known stop/termination codes,
normalized error categories, timestamp and exact execution references. No prompt,
response, provider error body, credential, model alias or transcript path enters
this evidence. The 64-record cap bounds passive metadata capture only; it never
limits productive agent work. Full windows are marked truncated; observed
compactions are a lower bound when coverage is incomplete. Session estimates are
not retroactively attributed to another run. Operator diagnosis remains read-only
across replies/children/continuations and cannot repair or replay effects.

The new credential connector is trusted host code, not a model plaintext-secret
tool. Official `bitwarden-sdk==2.1.0` uses a token-free import check before refresh,
then minimal subprocess environment and secret input on stdin only for actual
writeback. Protected virtualenv interpreter aliases are permitted after target
trust validation; the original alias path is invoked to preserve the environment.
The SDK script must remain a regular nonsymlink file. Errors and receipts contain
fixed codes and safe identifiers, never secret values or raw SDK output.

Expected-value read/check plus readback is not server-side atomic compare-and-swap;
retain one owning integration writer per secret binding. A failure after a callback
may have rotated a credential is `unknown`, including later writeback/grant failure.
Do not blindly retry that provider mutation. Browser delegation authorizes only a
specified automation secret, profile, task/source and actual HTTPS origin; its
trusted browser consumer owns origin recheck, direct filling and human-required
challenges. This is not Password Manager unlock or arbitrary browsing authority.

## Source and regression file groups

| Group | Principal source and contract files |
| --- | --- |
| Conversation / settlement | `src/task-flow/{service,hooks,types,source-settlement}.ts`, `src/domain-runtime/{task-application,native-admission,topic-scope,prior-context}.ts`, `src/request-context.ts`, native adapter/store projections and `plugins/household-domains/native-task-hooks.mjs`. |
| Native transport / delivery / approvals | `src/domain-runtime/{discord-artifacts,native-approval}.ts`, `src/domains/scheduling/{index,delivery-session}.ts`, native plugin/runtime wiring, protected configuration preparation and current scheduling/conductor skills. |
| Diagnostics | `src/domain-runtime/{diagnostics,native-diagnostic-events}.ts`, `src/platform/diagnostic-{evidence,native}.ts`, `src/openclaw-adapter.ts`, `plugins/household-domains/native-diagnostic-hooks.mjs`. |
| Memory / OCR / calendar | `src/domains/memory/{append-managed-memory,managed-pages,remember}.ts`, `src/domain-runtime/contact-extraction.ts`, Contacts extraction/service contracts and `src/domains/google/event-verification.ts` / `index.ts`. |
| Simplified display / analysis | Existing `src/display/`, `src/analysis-flow/`, `src/domain-runtime/analysis-admission.ts`, catalog and composition wiring. |
| Credential connector | `tools/bitwarden-credential-connector.{mjs,d.mts}`, `tools/bitwarden-secret-writeback.py`, `tools/requirements-bitwarden.txt`; existing read-only resolver remains the read authority. |
| Regression coverage | Task/reply/source settlement, native hook/admission/approval, staged-media, schedule preparation, diagnostic event/evidence, memory rollover/recovery/forgetting, calendar comparator, fresh OCR, display/analysis and credential lifecycle tests; Python fake writeback tests. |
| Instruction cleanup | Current domain/conductor skills, this record, historical marker in `memory-acceptance.md` and pointer-only dormant `config/workspace/AGENTS.md`. |

`src/` and backend `test/` in this table are under
`services/household-control/`. The prepared public release manifest, not this grouped
map, is the exact deployment inventory. Existing large composition files remain
compatibility debt; narrow domain/evidence/settlement helpers own the new behavior.
No public API/schema migration or new durable authority is claimed by this record.

## Verification and deployment record

The final assembled candidate passed **521/521 backend tests**, zero failures or skips, all **87 native schemas**, Uplift **21/21**, capture **7/7**, credential contracts **4/4**, source/startup checks and kitchen build/tests on Ubuntu. The 0.7.0 source is deployed and ready. Exact source and executed-case pins remain in protected receipts.

Natural-language checks passed for ordinary question/side-action/restart, formal goal restart, actual physical transcript trimming and actual native summary compaction. The fresh summary case completed its original goal. Its earlier partial attempt retained the correct dated write and explicitly failed because the model stopped before native goal completion. Failed effects and traces stay available for diagnosis.

Analysis admission uses the effective native attachment policy. The exact admitted child can read attached inputs and execute Python in the fixed no-network Docker sandbox. Its scoped publisher is direct and included in the helper's own native sandbox tool allowlist. The parent can adopt either exact native single-child completion form for the current signed source. It verifies the completed child and scoped output hashes before delivery. The final live analysis case **failed**. The sandbox published a real PNG and JSON with total 100 and mean 25. The parent failed to verify and return them. Both exact native completion forms pass component checks on the deployed source. A fresh end-to-end run remains open.

During testing the running Ollama container temporarily lost GPU access. Restarting that same idle container restored GPU visibility with its existing device request, image and model storage. The cause of the GPU loss remains unconfirmed. One earlier fixture also required releasing an idle cached parent model to let the analysis child load on the single GPU. These checks do not establish simultaneous model capacity.

The isolated Bitwarden SDK **2.1.0** import/readiness probe and four provider-free
writeback checks establish connector readiness only. They accessed no vault or
provider account. Complete credential acceptance remains held.

Remaining work includes actual nested conversation/reconnect/restart and forced
context recovery, real owner Discord intake/approval, scheduled delivery when
activation is separately released, noisy-card OCR, broader shared memory and
concurrent-writer recovery, analysis inspect/revise/publish/cancel, physical app /
kitchen enrollment/offline/revocation and full backup/restore. Fixed list categories,
no Google Contacts sync, deferred private-to-shared memory publication and current
analysis/display formats remain product limits. Analysis output supports raster,
HTML, JSON, CSV and text; SVG/PDF are not currently harvested. Kitchen publication
supports PNG/JPEG/WebP/plain text only. Held OAuth, vault, family grants and receipt
projects remain setup dependencies rather than fabricated successes.

## Rollback and retained evidence

Use the existing quiet-state, consistent backup and exact clean-export promotion
procedure. Source, native plugin, skills and protected matching configuration move
together. Preserve the prior source/config/provider selection and all failed traces,
partial effects and new evidence. This work does not authorize schedule activation,
model changes, credential onboarding or old-job replay.

Rollback source/configuration without restoring older business data over newer
contacts, accepted receipts, corrections, forgotten sources, native jobs or effect
receipts. Reconcile unknown provider and queued delivery outcomes with their owner
before retrying. Accepted prepared notices cannot be withdrawn by source rollback.
Keep continuation memory parts and source markers; an older memory writer cannot
manage them, so retain the compatibility helper or suspend automatic curation when
reverting it. Retain diagnostic artifacts under existing private lifecycle. The
isolated unused SDK environment has no service wiring or secret bindings; it need
not be activated or removed to roll back source. Never reactivate the retired
HardyAI/Jarvis runtime as a recovery shortcut.
