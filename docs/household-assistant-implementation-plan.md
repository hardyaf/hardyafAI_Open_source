# Household assistant implementation plan

Updated November 4, 2026.

Status: the original three integration slices established the 0.5.0 baseline;
the 0.6.0 bookkeeping simplifications are deployed. The authorized 0.7.0
reliability implementation addresses the eight concrete gaps and further removes
unnecessary model bookkeeping. See the [reliability implementation record](household-reliability-implementation.md)
for current source behavior, reuse/ownership, limits and file groups. This is an
extension of the same build and consolidated acceptance campaign, not a new runtime
or repeated rollout ceremony. [Current status](current-status.md) owns actual
promotion, versions, check totals and individual workflow acceptance. Component
passes do not establish complete household acceptance.

## Outcome

One owner request should complete across meaningful phases, tool calls, fresh contexts and interruption recovery. Reliable skills then provide household mail/calendar/invitations, lists, local OCR/Rolodex, memory wiki, explicit diagnosis, receipt integration, Python visuals and app/kitchen output. Four-person rollout follows enforcement and acceptance of per-person access.

Keep stock OpenClaw, supported native extensions and the current local-model baseline. Use the existing OpenClaw project; do not reactivate the retired native HardyAI engine.

## Verified starting point

See [current status](current-status.md). Native spawn/yield/parent resume and context-policy tests have passed. Complete chained-task recovery is still outstanding. Household connection/device identity and one-person phone reconnect have prior acceptance. The live audit reproduced missing queued-message dispatch and identified run-admission and event-scope defects.

OAuth repair is deferred from the immediate continuation package. Current provider access cannot be counted as working merely because stored account metadata exists.

## Reuse map

| Capability | Decision | Rationale and boundary |
| --- | --- | --- |
| Execution, successor turns, task/run ownership | Reuse | Native OpenClaw already owns these; no alternate agent engine. |
| Goal, compaction and phase context | Adapt | Durable goal plus current conductor/handoff/artifacts; no shadow task store. |
| Queued app delivery | Adapt | Existing ledger now retains payloads, admission/recovery and per-request domain authorization snapshots. Per-tool effect receipts share its migration authority without becoming a queue. |
| Lists/notes | Reuse | household-capture already has stable IDs and verified mutations. |
| Scheduling | Reuse | Native OpenClaw scheduler/task infrastructure; no new daemon. |
| Calendar/Gmail | Adapt | Maintained gog/provider functionality plus deterministic scope, account and receipts. |
| Python analysis | Reuse/adapt | Supported native execution facilities plus a maintained environment and artifact publishing; validate isolation/resources. |
| Knowledge wiki | Reuse/adapt | Bundled memory-wiki and memory-core; add curation/routing, not another index service. |
| Business-card extraction | Adapt | Reuse the local OCR stack and historical field/evidence/correction contracts; add supported image intake. |
| Local Rolodex | New domain authority | Prior contact writes deliberately had no provider. Create one local Contacts boundary, not an ad hoc wiki or second address book. |
| Receipt management | Adapt | Uplift_Finance owns financial records; expose source/OCR/context/candidate/validation/commit primitives so Main can reason rather than invoke a fixed workflow. |
| Secret storage | Reuse/adapt | Bitwarden automation project plus native SecretRef resolution; no local secret database. |
| Diagnostics | Adapt | Existing diagnostics authorization and native tool policy plus a redacted evidence reader. |
| Kitchen output | Adapt/build thin client | Legacy kiosk/message specification exists; no working display app was found. Reuse the household API and display projections. |

The new Contacts authority is justified because extraction/proposals cannot provide durable searchable contact writes without a selected owner. Reuse existing application SQLite connections/migrations, stable operations and the ContactProvider contract. Keep Contacts policy/modules independent of transport handlers and vendor-owned database tables. Back up its schema/data, make migration additive, and support disabling new writes without deleting original cards. The extra operational cost is one owned module/schema/backup scope, not another service platform.

## Build slices and deployment checkpoints

The owner selected three integration slices, with the full build followed by one consolidated functionality campaign. Slice 1 deployed at 0.3.0, Slice 2 at 0.4.0 and Slice 3 at 0.5.0. All three passed deployment/run checkpoints. The final campaign began only after the assembled deployment ran; no checkpoint alone grants functional acceptance.

| Slice | Work grouped together | Deployment/run checkpoint |
| --- | --- | --- |
| 1. Shared runtime and platform foundations | Native goal/continuation integration; task/question/handoff references; durable household payload delivery and actual run admission; owner-filtered events; shared API contracts and diagnostic evidence hooks; Bitwarden/native secret-resolution adapter and readiness; scoped image/artifact storage/output; Python/local-OCR runtime integration and native execution/diagnostic policy boundaries. | Build/import/static/config/schema checks; additive application migration/reopen on disposable state; service/worker startup, heartbeat and clean shutdown; authenticated Gateway handshake; environment/dependency/artifact readiness. No natural-language feature scenarios or provider mutations. |
| 2. Domain data and composable capabilities | Local Rolodex/card/revision authority; native wiki source/index routing; canonical list bindings; Uplift candidate/acceptance/review revisions and report contracts; mail/calendar/invite, OCR/contact, list/wiki, scheduling, receipt reasoning primitives and redacted diagnostic evidence tools. | Migrations/plugin loading and structural readiness; tool/schema/route registration; adapter initialization and honest credential/hardware readiness. No functionality campaign yet. |
| 3. Agent behavior, interfaces and complete release | Skills/context assembly; consecutive phases, clarification and steering; brain-dump composition; automatic grounded wiki curation; reasoning-led Uplift behavior; independent verification; Python/visual artifact use; explicit no-repair diagnosis; Android views and media, Pi kitchen output, dedicated Discord entry, four profile/agent configurations and final packaging/operations. | Complete service/client build and startup; APK/kiosk bundle build/open, static assets and connection plumbing; full configuration/dependency inventory. Then start the single consolidated functionality campaign. |

Shared contracts are established in Slice 1 and extended by their owning domains. Related work can proceed in parallel inside an authorized slice. Group integration around these checkpoints; do not require each feature to pass a functional gate before continuing its slice.

A checkpoint answers whether the combined software builds, deploys, starts and remains inspectable. It does not certify Calendar, OCR, memory, receipt reasoning or any other user workflow. Keep built, runnable, functionally accepted and deployed distinct.

Original build evidence remains in [Slice 1 runtime/platform](slice-1-runtime-platform.md), [Slice 2 domains/capabilities](slice-2-domain-capabilities.md) and [Slice 3 behaviors/interfaces/release](slice-3-implementation.md). Those records describe the three-slice 0.5.0 release history. Subsequent 0.6.0 simplifications adapt the same native execution, source admission, domain receipts and checkpoint owners; see the [implementation record](bookkeeping-simplification-implementation.md). [Current status](current-status.md) owns the active service/provider/model configuration, verification totals, promotion state and remaining acceptance/setup limits. Protected release receipts retain exact source/configuration identity. Failed attempts, partial effects and corrections remain in the existing consolidated campaign.

## What runs between slices

Allowed checks are compilation/type/import/static architecture checks, dependency/configuration/schema validation, additive migration/reopen/data-integrity smoke checks, service launch/health/heartbeat, authenticated Gateway connection, endpoint/static-asset availability and clean process lifecycle. Use the smallest non-semantic infrastructure probe needed to show the wiring is live.

Write relevant tests alongside the implementation; execute functional suites in the final campaign. Static checks remain available throughout.

Do not turn a smoke checkpoint into card-quality testing, household conversation evaluation, Calendar fixture creation, receipt acceptance/reconciliation tests, wiki recall/correction tests or full family/privacy workflows. The acceptance cases below remain mandatory, but run after the full build is assembled.

Use disposable/candidate state and inactive external delivery where needed for deployment smoke checks. Incomplete automation must not consume household inputs, invite attendees, change real financial/contact records or curate private data merely because its process starts. Reuse the existing deployment topology; temporary candidate configuration is not a second permanent agent platform.

Fix a deployment regression before adding another slice. Record deferred functionality without calling it passed. A secret, OAuth consent or physical-device blocker does not prevent unrelated code from being built; it must be resolved or explicitly reported before the affected final functional case can pass.

## Full build completion

All three slices must contain real implementations and wiring, rather than placeholder endpoints or mock providers counted as delivered features. All planned schemas, interfaces, skills, clients and supported service entry points are present and the assembled deployment starts.

Record exact code/configuration versions, migration state, dependency readiness and external blockers. Missing credentials/hardware and behavior that has not yet been exercised stay visible. A runnable complete build is the starting point of functional acceptance, not the end of it.

## Execution rules

Main interprets requests and composes authorized typed capabilities. Do not fix each new wording with another router branch. Instructions can define a procedure; deterministic code owns identity, resource grants, schemas, effects, idempotency and durable outcomes.

Persist before and after consequential effects, maintain stable logical operations and distinguish uncertain results. Check provider/destination truth before retrying an uncertain write. Cancellation prevents subsequent effects but does not claim to undo saved work.

Use native execution ownership and scheduling. Native safety/time/resource limits and no-progress detection remain; this plan does not add arbitrary tool/turn caps to productive work or change model/context without measured need.

Preserve existing credential, private document, child identity and audience boundaries. A retrieved document, web page or log cannot grant authority. A skill edit, credential lookup or memory candidate cannot silently broaden a person's resources.

## Consolidated functionality campaign after the full build

Begin this campaign only after all three build slices are implemented and the complete deployment passes its run check. Use local/disposable fixtures, then the required authorized provider/device cases. Run meaningful unit/contract, integration and natural-language end-to-end behavior checks as one coordinated campaign. Do not require each feature to pass its own functionality gate before the next slice is built.

Track one consolidated evidence index. When a case fails, fix the issue and rerun affected checks; repeat wider coverage only for a demonstrated dependency/regression risk. Do not repeatedly restart the entire campaign or add repeated model benchmarks and observation ceremonies.

| Area | Required acceptance |
| --- | --- |
| Continuation | Read a document, normalize, save an artifact, independently verify, correct one mismatch and finish from one request. Span successive workers; force refresh and controlled interruption. |
| Conversation | Clarification survives reconnect; freeform answer resumes the correct task. New-topic interruption preserves old work. An ambiguous answer is not attached to the wrong task. |
| Delivery | Two occupied execution slots plus queued submissions; free capacity and restart. Every accepted payload is delivered once or reports a durable terminal reason. |
| Calendar/invites | Correct household destination, DST/all-day/recurrence/edit scope, requested attendees only, provider readback and uncertain-write deduplication. Use disposable labeled fixtures after OAuth repair. |
| Mail | Reads use the bot account/grant and appropriate audience; future sending requires its own real granted capability and requested recipient/body. |
| Lists | Shared/private scope, stable IDs, exact completion, deduplication, recovery and same data in app/display. |
| Python/artifacts | Run, inspect and revise a small script; publish actual output; cancellation and credential/workspace boundaries hold. |
| Cards/contacts | Clear, blurry, rotated, missing-field, front/back, zero-readable-field and duplicate-intake cards all save/report committed source records. Natural-language correction and redo target the right revision. No silent merge or background rewrite; save reports name the shared-household default and explicit scope changes are respected. |
| Wiki | Clear stated fact, labeled inference, source/date, topic synthesis, fresh-session recall, contradiction/correction, private/shared routing, forget and index rebuild; an untrusted contradictory source does not overwrite a confirmed fact. |
| Brain dumps | Several clear actions plus one uncertain item and one non-task fact; clear items execute, only uncertainty waits, answers resume and scheduler runs under current grants. |
| Vault | Correct immutable secret binding, unavailable vault, rotation, revoked grant and restart; plaintext absent from prompts/logs/wiki/artifacts. |
| Receipts | Local OCR; AI resolves an unfamiliar receipt using evidence/context/calculation without a new workflow branch; clear auto-acceptance and unresolved review; synthetic balanced match blocked; revisioned correction/redo, duplicates, accepted-only/draft totals and transactional replay. See [receipt policy](receipt-acceptance-policy.md). |
| Displays | Revocable least-privilege device, private-content exclusion, current/stale/offline states and publication of only the selected audience-approved artifact. |
| Diagnostics | Explicit operator request; observation versus hypothesis; no repairs, credential retrieval, configuration changes, job replay or unrestricted shell; the parent cannot execute a fix after receiving the worker's diagnosis. |
| Family/recovery | Four identity paths, private/shared access and events, cancellation/revocation, backup/restore and an actual user-authored app/Discord request. |

## Migration, ownership and rollback

Use the design's ownership table. Keep native OpenClaw schema ownership with upstream; application additions use the selected application migration authority. Indexes/caches name their canonical sources and refresh/deletion behavior.

Migrate credentials one integration at a time. Keep current provider/config rollback material protected until restart/rotation acceptance passes; retire plaintext copies deliberately. Do not export secrets into the documentation.

Receipt integration must replace legacy classification/accepted-counter shortcuts, synthetic balancing acceptance, destructive reprocessing, hidden shared store-profile writes and unfiltered final reports before exposing those paths. Keep candidate, acceptance and review state in Uplift's authority; no separate Jarvis receipt ledger or review broker.

Preserve immutable source cards and receipt originals. A rollback of extraction/curation must not destroy user corrections or accepted financial/contact state. Topic pages and search projections must be rebuildable with their provenance.

Before changing a live interface or worker, record exact source version, changed area, durable schema impact and how to disable the new path. Take an appropriate consistent backup and test the relevant restore path. Deploy/test only on the authoritative Ubuntu host. Documentation work alone does not deploy anything.

## Deliverables per slice and final campaign

Each slice records the reuse/ownership decision, implementation/file list, exact integrated version, deployment/run-check result, migration impact, known untested behavior and rollback notes. Do not mark functional acceptance from those smoke checks.

The final campaign records user-visible behavior and evidence for all planned capabilities, remaining failures/blockers and any rollout limitations. Mark built, runnable, functionally accepted, deployed, deferred and proposed separately.

## November 4 loaded-contract projection correction

The metadata owner is implemented after measured domain-instruction skipping;
its focused Ubuntu suite passes 9/9. Reuse the existing
ExecutionAuthorityRepository/native_execution_grants owner; adapt it
with bounded loaded-contract metadata, not a skill/session/authorization store.
One additive loaded_contracts_json field records at most 16 domain IDs and
SHA-256 contract digests after successful context loading. No contract text,
document/provider content or credentials enter that projection.

| Datum or operation | Owning authority and consistency |
| --- | --- |
| Loaded domain ID/digest | Existing execution-grant row, exact source/run/session/root/parent/goal/agent/mode tuple; unchanged identity preserves, identity replacement clears. |
| Context loading/selection | Existing deterministic domain loader; successful load records by compare-and-swap with current-source checks. |
| Capability, audience, approval and effect | Existing admission/domain/native guards; selection never grants any of these. |

The helper supports an admitted no-goal context without creating a goal or
checkpoint. Focused coverage includes separate owner instances, changed/stale
identity, revocation, concurrent writes and post-read races, current
contract-digest mismatch, the 16-domain bound, child session-generation clearing
and old-schema reopen/idempotence. The implemented 0.6.0 interface returns exact
scoped schemas and handles routine selection revisions internally. Successful
contract loading remains required and never expands capability or audience. See
the [simplification record](bookkeeping-simplification-implementation.md) for the
interface and [current status](current-status.md) for current checks and actual
native workflow acceptance. Rollback preserves the additive column and existing
effects; older readers ignore the metadata.
