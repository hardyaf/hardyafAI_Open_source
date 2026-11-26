# Slice 2: domain data and composable capabilities

Implemented and deployed November 3, 2026 with explicit owner authorization. Household control 0.4.0, application schema 3 and integrated Uplift schema 1 passed the deployment/run checkpoint. The system remains pre-production; functional testing stays after Slice 3. Historical records are retained and both execution slots are free.

## Implementation plan and reuse decisions

| Area | Decision | Boundary and reason |
| --- | --- | --- |
| Native tools | Adapt | Register a first-party OpenClaw plugin using the pinned installed factory/context contract. Native session and turn authority remain upstream-owned. |
| Identity and capability grants | Reuse/adapt | Existing household profiles, devices, conversations and admitted submissions bind each tool invocation. Protected configuration selects domain/resource grants. No model-supplied identity or scope promotion. |
| Effect receipts | Adapt | Reuse application SQLite/migrations and stable operation IDs. Tool effects need individual receipts because one existing submission can contain several effects. Add a receipt table, not another task queue or worker. |
| Contacts | New domain authority | Existing historical Contacts interfaces never had a selected mutable provider. One Contacts-owned schema in the existing app database stores cards, observations and revisions. No Google synchronization. |
| Source bytes and extraction | Reuse/adapt | Scoped ArtifactStore and existing local PDF/Docling/RapidOCR reader gain bounded image intake. Originals and extraction observations remain immutable. |
| Lists | Reuse | Existing household-capture canonical Markdown, locks and stable IDs. No new list database. |
| Memory/wiki | Reuse/adapt | Native memory source files, memory-core index and memory-wiki. Private sources stay agent-scoped. A locked, non-conversational household-knowledge native scope separates shared sources without making a second memory engine. |
| Scheduling | Reuse | Native scheduler owns jobs, due times and execution. Typed adapters restrict agent/owner/delivery targets. No new scheduler daemon. |
| Mail/calendar | Adapt | Existing maintained Google CLI behind fixed-argument typed operations, bot account and configured calendar. No OAuth repair or new send grant. Recipient/destructive authority is supplied by trusted grants, never a tool boolean. |
| Receipts | Adapt | Individually adapt Uplift's source identity and SQLite ownership into a reusable integrated Uplift package. Its configured financial DB/vault owns candidates, validation, acceptance, review and reports. Household SQLite stores only operation references. No donor data/vault copied. |
| Diagnosis evidence | Reuse/adapt | Project bounded, redacted task/effect/version metadata. Explicit diagnosis mode and parent no-repair behavior remain Slice 3. |

## Ownership and lifecycle

| Data/effect | Authority | Projection and consistency |
| --- | --- | --- |
| Current turn/task, session and descendants | OpenClaw | Tool factories require trusted native context and an existing admitted app request; no delegated identity inferred from a key substring. |
| Device/profile grants and app request | Existing household application authority | Current device, profile, owner and invocation are rechecked before effects; unknown/unbound/child paths fail closed until configured. |
| Tool operation receipt | Application effect receipt table | Each effect has one request fingerprint and outcome. Interrupted external effects remain unknown and are not replayed blindly. Domain transactions own their underlying commits. |
| Cards, canonical contact revisions and corrections | Contacts module in application SQLite | Search/read views derive from the current authorized revision. No automatic cross-card merge; sparse cards save even without extracted fields. |
| Original bytes and extraction evidence | Scoped ArtifactStore | Only intended card bytes may be published into shared card scope. Private originating conversation metadata is not published. Retain source/extraction provenance and explicit prior-sharing limits. |
| Lists/notes | household-capture | Typed views call the existing store. Personal scope is the active granted agent workspace; household scope is the shared store. |
| Memory sources/topic claims | Native memory-core/memory-wiki | Agent-private or explicitly shared native scope; compiled/index state remains a rebuildable native projection with provenance. |
| Scheduled jobs | Native scheduler | The application keeps references, not another timer/queue. |
| Provider event/mail state | Google | Bounded observations and durable effect receipts; uncertain writes require readback/reconciliation. |
| Original receipts, candidates, review and accepted revisions | Integrated Uplift financial authority | Application tools reference Uplift identities. Reports select current accepted revisions at their supported profile. No financial rows in household SQLite. |

The local Contacts authority is a justified new domain, not a duplicate service. The financial adaptation is deployed code with its own protected configurable Uplift DB/vault; importing existing financial data is a separate deliberate migration. Empty project grants and missing credentials must remain visible.

## Build and deployment checkpoint

Implement domain-owned schemas, operations and meaningful deferred tests. Compose them through one scoped native plugin and existing service lifecycle. Keep providers, credentials, raw paths and databases behind narrow adapters. Domain manifests own tool semantics; no phrase-specific router branches.

On Ubuntu, verify syntax/import and schema/tool registration, dependency/configuration readiness, additive application and Uplift migration/reopen on disposable state, plugin loading, service/Gateway readiness and clean shutdown. Do not run model turns, provider mutations, OCR samples, contact/receipt scenarios or the functional suites. Candidate state must not consume household inputs.

Record exact source/dependency/configuration identity and deployed status after the checkpoint. Keep consistent before-deployment backups. Retain cards, financial revisions, operation receipts and native memory sources across rollback; never expose new provisional financial rows through old unfiltered reports.

## Remaining integration in Slice 3

Skills and selected-domain context, semantic interpretation, conversational target/clarification binding, wiki curation, multi-phase reasoning, receipt evidence use, parent diagnosis restrictions and complete app/kitchen/Discord/family interfaces remain Slice 3. Registered tools and migrated schemas are not functional acceptance. OAuth, vault bootstrap and missing resource grants are reported separately from build readiness.

## Deployed implementation and verification

The native `hardy-household` plugin initializes with **68 optional tools**: seven Contacts, two Documents, 31 native list/mail/calendar/memory/schedule adapters, 26 Uplift/evidence operations and two effect/diagnostic tools. Tool metadata remains domain-owned. The phone API gained protected domain readiness and an updated generated client; it gained no generic raw Gateway/SQL/process endpoint.

The plugin uses the pinned host's version-2 live invocation guard plus its trusted before-tool-call run/call identity. An exact app session and admitted signed request must match the native run or goal lineage. The existing submission row captures the goal-control version, goal binding and audience at admission; this is authorization metadata, not a second task runtime. Device/profile changes, sharing and goal control fence effects after asynchronous preparation.

One bounded process owner serves the adapters. It strips unrelated credentials, preserves the configured Python virtualenv path, limits and joins child groups, and rechecks authority before spawn. The owned Uplift bridge's structured validation-error envelope is handled separately from uncertain provider failures. Cached central effect replay returns no old domain content; domain operation/current-state reads reauthorize resources.

| Check | Evidence and limit |
| --- | --- |
| Source/schema | 70 JS/TS files passed syntax checks, server/plugin imports passed, all 68 schemas compiled, shell/helper syntax and 18 Python sources compiled. This was not a full TypeScript typecheck. |
| API | OpenAPI/client generation consistency passed; no APK/UI build was performed in this slice. |
| Dependencies | Existing document Python/Pillow 12.3.0, pypdfium2 5.14.0 and Docling 2.133.0 imported. The existing interpreter's group-write bit was removed; contents were unchanged. SDK remains 2026.9.8; Ajv is pinned at 8.20.0. |
| Migrations | Consistent copy of app schema 2 migrated to 3, preserved original record counts, created Contacts/effect tables and the admission-context trigger, passed integrity and reopened. Fresh protected Uplift schema 1 initialized/reopened with no imported ledger or receipts. |
| Native loading | Candidate native configuration validated and actual runtime inspection registered 68 tools. The final packaging statically imports receipt schemas so the native plugin capture includes them. |
| Lifecycle | Inactive candidate dispatcher, authenticated Gateway readiness and clean shutdown passed. Deployed services are active, 0.4.0 is ready, native plugin initialization/status succeeds and the isolated household wiki status responds. |
| State | Application and financial integrity are `ok`; source hashes match. Seven historical completions and two cancellations are unchanged, with zero reservations and no new Contacts/effect rows. |
| Deferred | No model turn, provider mutation, OCR sample, card/receipt processing or expanded functional suite ran. Written contract/privacy/recovery tests remain for the final campaign. |

Clean code bundle SHA-256: `84c07779c5e16c9bbdd4621924d640abf0a9571465917a92e658d0ec403f5dad` (137 files before this documentation overlay). Protected Ubuntu evidence retains the per-file manifest, candidate/build logs, database/configuration/source/dependency/artifact backups and deployed checks. The final documentation overlay has a separate manifest; executable code is unchanged.

## Changed source areas

- `src/domains/contacts/*` and `src/domains/documents/*`: owned schemas, protocols, sparse capture/revisions/receipts, source authorization, local extraction and deferred privacy tests.
- `src/domains/{lists,google,memory,scheduling}/*` plus native contracts/validation/facade: composable wrappers over existing authorities and deferred boundary cases.
- `src/domain-runtime/*`, `src/database.ts`, `src/server.ts`, and the narrow adapter RPC port: composition, trusted run/request authorization, effect receipts, schema 3, lifecycle and protected readiness.
- `plugins/household-domains/*`: native manifest, pinned package, version-2 factory, trusted invocation hook and content-free initialization status.
- `integrations/uplift/*`: independently owned financial primitives, additive schema, immutable originals/evidence, revisioned acceptance/review, current accepted-only reports and deferred contracts.
- Local document reader stdin/image extension, deployment/configuration helpers, build checks, pinned dependency lock, API contract/generated client, architecture/status/worklog updates.

## Limits and next-slice boundaries

Only signed admitted app turns for Owner receive the new grants today. Discord/family/child routing, selected-domain prompt assembly, conversational bindings and productive successor phases remain Slice 3. Readiness/registered schemas do not establish reliable agent use.

OAuth and Bitwarden setup remain deferred. Uplift's catalog/project grants are empty, and native schedule activation is disabled. Explicit financial business-exception approval needs the trusted review-response binding in Slice 3; a model cannot mint it through a generic statement. Reports produce real JSON/CSV; PDF/XLSX and app/display presentation remain output integration.

Memory sources are retrievable through the scoped source reader, not presumed wiki vault paths. Native automatic Sources backlinks require actual wiki-page identities and are not yet supplied for these source references. Automatic curation, forget/index handling and navigation remain Slice 3. Wrapper writes use preimage checks/singleton serialization; native wiki has no true atomic CAS, and broad raw operator tools remain compatibility debt.

## Rollback

Before cutover, stopped both services and retained consistent application state/artifacts, previous source/unit/environment/native configuration and dependencies. New financial/wiki data were not imported. To hold delivery, disable it using the existing flag and restart the household service; retain accepted work and do not replay unknown effects.

Rollback must preserve the new Contacts, Uplift, artifacts, effect receipts and native memory/wiki state. Restore prior source/dependencies/configuration only after saving current state and deciding how pending work is handled. Schema 3 is additive, but older code does not understand the new authorities or provisional financial states. Never expose the integrated DB through the donor's destructive reprocessing or unfiltered reports. A pre-cutover database restore would discard later work and is not an automatic code rollback. Full restore/functional acceptance remains in the consolidated campaign.
