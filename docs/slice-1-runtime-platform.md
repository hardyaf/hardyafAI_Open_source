# Slice 1: shared runtime and platform

Implemented and deployed November 3, 2026, in the pre-production environment. Household control version 0.3.0; application schema 2; stock OpenClaw/SDK 2026.9.8; Node 24.21.0. **Deployment/run checkpoint passed. Functionality acceptance is deferred until all three slices are built.**

## Scope and reuse

The [three-slice plan](household-assistant-implementation-plan.md) groups shared runtime/platform first, domain data/tools second, then agent behavior/interfaces/release. This slice extends the existing household service, SQLite migration authority and native OpenClaw APIs. It introduces no second task engine, scheduler, approval system, memory index or broker.

| Area | Implemented boundary | Remaining behavior |
| --- | --- | --- |
| Delivery | Retained queued payload; atomic two-slot reservation; per-conversation FIFO; leases, bounded proven-not-sent retry, device/grant recheck and restart reconciliation. Unknown effects retain a recovery reservation. | Functional delivery/restart/revocation campaign. Historical reservations were later closed with explicit owner authorization. |
| Native context | Exact session description, native goal controls, admitted goal resume, read-only progress adapter and cancellation-tree verification. | Multi-phase conductor, semantic completion, clarification and app progress experience. |
| Checkpoints | CAS pointer projection keyed by conversation/native session/native goal, with scoped artifact references and retained old bindings. | Agent-created handoff/question content and its task-aware use. |
| Artifacts | Immutable scoped inputs/outputs/evidence with atomic/hash/idempotency checks, bounded uploads and safe download headers. | Android capture, document/domain consumers and native output harvesting. |
| Analysis | Restricted native Docker helper plus pinned Python/numpy/pandas/matplotlib/Pillow image and runtime-policy validation. Internal coordinator requires existing trusted task admission. | No public run endpoint is exposed yet; task admission wiring and user-requested programs/visuals are later integration. |
| Diagnosis | Read-only helper, native read-only session permission and bounded redacted evidence builder. | Explicit operator task-mode selection and parent/continuation no-repair enforcement. |
| Credentials | Native SecretRef exec resolver, exact immutable-ID allowlist, dedicated private no-cache BWS config and readiness. | Bootstrap and secret bindings, real provider resolution, integration rotation/writeback. |
| Documents | Existing local document-reader dependency reused and available. | Card-image OCR, contacts and receipt workflows. |

Native progress writes replace a whole card and do not offer a safe pinned nonempty compare-and-swap contract; the native question manager is in-memory. Therefore the application stores only versioned checkpoint/question artifact pointers and their exact native binding. This small projection makes stale-client conflicts inspectable without duplicating the native goal, transcript or task lifecycle. Native progress is currently adapter-only; `/context` is a native context snapshot, not the final user progress interface.

## Data ownership and lifecycle

| Datum/effect | Single owner | Projection, retention and deletion |
| --- | --- | --- |
| Goal, execution, child/yield state and transcript | Native OpenClaw | Household context/progress reads derive from the exact session. App state cannot authorize native work. |
| Accepted app submission and transport outcome | Existing household SQLite submission ledger | Payload commits before HTTP acceptance; clears after definitive Gateway acceptance or terminal delivery. Unknown outcomes retain available payload/evidence and reserve capacity. No automatic uncertain replay. |
| Checkpoint/question reference | Household application pointer table | CAS revision and native binding fence stale updates; immutable artifacts contain content. Old bindings are retained for recovery. Native goals remain authoritative. |
| Uploaded/published artifact bytes and manifest | Scoped ArtifactStore under protected application state | Owner/conversation/task/audience bound; immutable and replay-safe. No public delete route exists in Slice 1; include in application backups and add explicit retention/forget handling with the domain lifecycle. |
| Device grants and event visibility | Existing device/profile authority | SSE subscription is a live filtered projection; rechecks revocation and has a per-client sequence. |
| External secret and bootstrap grant | Bitwarden automation project / protected service configuration | No application secret database or prompt/log/artifact copy. Resolver fetches only exact allowed IDs; integration owns later rotation. |
| Helper configuration and fixed image | Existing trusted OpenClaw configuration and managed Docker topology | Two helper execution profiles inherit the existing local model; they are not family personas. No network, host binds, elevation or delegation. |

Changes remain modular: database/submission storage, Gateway wire adapters, artifact/policy/evidence modules, HTTP routes and composition are separate. Existing modules remain below the size hotspot threshold except the generated API contract, which is cohesive schema output.

## Deployment evidence

Protected deployment evidence retains the clean source archive, per-file release manifest, consistent application database backup, previous source/unit/configuration/environment, candidate logs and production readiness results. Credentials and raw household content were not exported to Windows or tracked documentation.

Code bundle SHA-256: `f2d2e46716baade8a5dd34e92a799fb29646372ae29ff9c7f189b24464aba586` (68 files before this final documentation update). Deployed source hashes matched that manifest. The final documentation/config-example overlay is recorded separately; executable code is unchanged by that overlay.

| Check | Result and limit |
| --- | --- |
| Syntax/import | 34 TypeScript/JavaScript source, script and test files passed syntax checking; server module imported. Tests were not executed and this is not a full TypeScript typecheck. |
| Contract/build preparation | Generated Android API client matches the OpenAPI contract; shell syntax and Python deployment-helper compilation passed. No APK/UI build was attempted in this slice. |
| Native configuration | Candidate and live schema validation passed. Merge preserved existing family/Gateway configuration and added only two restricted helpers and the inert Bitwarden provider. |
| Migration | Online copy restored to disposable state, additive v1-to-v2 migration, record counts preserved, integrity `ok`, and database reopened at v2. Candidate dispatcher disabled. |
| Lifecycle | Candidate authenticated read-only Gateway status probe, ready health and clean SIGTERM exit passed. Deployed services are active, `/ready` succeeds at version 0.3.0, and Gateway probe is current. |
| Dependencies | Fixed sandbox image built; installed libraries imported under nonroot/no-network/read-only/resource limits. Existing local reader is executable. BWS 2.1.0 binary installed; no bootstrap configured or secret lookup attempted. |
| Deferred campaign | No model turns, semantic scenarios, provider writes, OCR samples, receipt cases or expanded unit/contract/functional suites were executed. |

Sandbox image ID: `sha256:1218b68488419225262b086b81d718f8dae75b74b737a480b397f393bcbd66ab`. Image recipe pins Python 3.12.12 and primary libraries. Deployed native profile configuration uses the exact image ID.

## Legacy recovery and compatibility debt

At cutover there were seven completed submissions, one legacy dispatch and one request still marked running. The legacy dispatch lacked its original payload and was flagged `legacy_dispatch_payload_missing_unknown` with a recovery reservation. Those two reservations initially occupied both slots.

The owner then confirmed the system is pre-production and explicitly authorized closing historical requests. Both were cancelled through the native cancellation boundary, then recorded as `cancelled` with `operator_closed_preproduction`; their records were retained and reservations cleared. The seven completed submissions were unchanged, Owner became available, both slots were released and database integrity remained `ok`. A protected before-closure database backup and explicit closure audit were retained. No request was replayed or relabeled successfully completed.

For future uncertain work, preserve evidence and require native/provider reconciliation or an explicit authorized cancellation decision before releasing a reservation. Native generic `chat.send` does not provide a universally durable deduplication guarantee across Gateway restarts.

The final campaign must exercise actual queue release/recovery, privacy, goal steering/cancellation, artifact replay, helper isolation and vault failures. Functional tests were added alongside implementation, including delivery, exact native run state, progress normalization and platform boundaries; they remain unexecuted by owner choice.

## Changed areas

- `services/household-control/src/{domain,database,household-store,sqlite-household-store,submission-repository}.ts`: persistence, admission, goal/checkpoint interfaces and delivery lifecycle.
- `src/{openclaw-adapter,gateway-errors,native-session-state,native-progress,restricted-native-session,mock-adapter}.ts`: native wire/state/failure boundaries and compatible test adapter.
- `src/{server,events,http-codec,platform-http,cli}.ts` and `src/platform/*`: composition, scoped routes/events, artifacts, helper policy, readiness and evidence.
- `services/household-control/{package.json,package-lock.json,scripts/check-source.mjs,test/*}`: version/startup checks and deferred tests; SDK pin unchanged.
- `contracts/household-api/openapi.json` and generated Android API definitions: additive context/goal/checkpoint/artifact/readiness contracts.
- `tools/{bitwarden-secret-resolver.*,render-native-platform-config.mjs,README-platform.md}` and `deploy/hardybot/*`: resolver, helper configuration, image recipe, preparation, lifecycle and runbook.
- Design/status/plan/architecture/operations/worklog documents; the former HardyAI entry points remain historical.

## Rollback and operations

Keep the protected before-deployment bundle and current durable state. First stop dispatch with `HARDY_HOME_DISPATCH_ENABLED=false` and restart the household service if new work must be held; this preserves accepted payloads and does not undo committed native effects. Liveness/readiness and delivery capacity are separate signals.

For code/configuration rollback, stop the affected services, preserve another consistent database/artifact snapshot, restore the prior selected source, unit and protected configuration/environment, then validate configuration before restarting. Application schema changes are additive; do not assume the old dispatcher understands new payload/checkpoint state. Reconcile pending work before resuming an older service. Restore the pre-cutover database only when discarding subsequent accepted work is explicitly intended; never overwrite post-cutover state merely to match old code.

The native runtime/schema and existing local model were not replaced. Full native/application restore, family rollout and functional acceptance remain in the consolidated campaign.
