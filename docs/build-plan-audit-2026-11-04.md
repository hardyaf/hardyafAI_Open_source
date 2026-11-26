# Jarvis build audit November 4 2026

This is the retained audit snapshot before the authorized reliability work. See
[the implementation record](household-reliability-implementation.md) for the eight-gap
and restriction follow-through, and [current status](current-status.md) for actual
deployment and acceptance. Findings below are not a current missing-code list.

Jarvis has a deployed, working foundation and four demonstrated Qwen workflow groups. It does not yet fulfill the complete household plan. Several remaining items need implementation work, alongside the larger acceptance backlog. The three successful build/startup checkpoints establish deployability; they do not establish complete coverage of the design.

The appropriate current use is supervised owner trials of the measured list, card, private-memory and continuation paths. Household-wide rollout remains open.

## Running build and evidence

The live inspection at approximately 7:27 p.m. Eastern on November 4 confirmed:

- Household control 0.6.0 and the OpenClaw gateway are active and ready, with 87 registered household tools and no temporary fixture overrides.
- Main uses local Qwen3.8 27B Q4_K_M at 32K context. The GPT-OSS default and other profiles retain their previous settings. Ollama is 0.32.15; the native SDK is 2026.9.8.
- All 280 files in the sealed deployed manifest match the Ubuntu runtime and the local development checkout. There is no drift in that release inventory.
- Application schema 4 and Uplift schema 1 pass integrity and foreign-key checks. No active, queued or recovery-required requests were present.
- The owner is the only profile with household-domain grants. The other adult and both child profiles have those grants disabled.
- Bitwarden bootstrap and secret bindings are absent; Uplift has zero projects; the owner's project and attendee grant lists are empty.
- Scheduling is disabled at both boundaries. All 11 historical jobs remain retained and disabled. All nine switched test fixtures are restored and inactive.
- One RTX 3090 with 24,576 MiB is detected. The second GPU is not yet visible.

The retained component evidence is intact: 411 backend tests with actual installed-SDK execution and zero skipped tests, 21 Uplift tests, 7 capture tests, 140 source/startup files and the native schema checks. Complete Android source-map equality supports reuse of the earlier built APK. These checks were not repeated during this audit because the sealed implementation is unchanged.

The model campaign demonstrates Qwen parent/child completion (about 131 seconds), exact ordinary list delivery (31 seconds), real local six-field card capture plus later correction (129 seconds), and private fact capture/unknown-age recall/correction with topic and journal restored (194 seconds). The memory follow-up uses the bounded memory-repair source; the earlier matched comparison uses its preceding source. Each run retains its own source pin. Earlier failed attempts and partial effects remain preserved.

## Coverage against the plan

| Planned area | Current implementation and acceptance | Remaining work |
| --- | --- | --- |
| Stock OpenClaw and modular ownership | Deployed. Native owns sessions, goals, children and scheduling; the existing app owns admitted delivery/checkpoint pointers; domains own business state. No second task engine or self-prompt queue was found. | Retain these owners while closing the gaps below. |
| Context and consecutive work | Durable goals, handoffs, evidence, child isolation and completion/recovery boundaries are implemented. One real Qwen parent/child round trip completed. | Forced context refresh, document-to-artifact verification/correction, interruption and actual restart acceptance remain open. Native unfinished-plan continuation requires the actual progress tool callback. |
| Natural multi-turn conversation | Persistent freeform clarification/reply binding is implemented. | Independent actionable new topics while a question is pending require a new conversation. Same-chat task switching is incomplete. Clarification after a real reconnect/restart remains unaccepted. |
| Reliable queued delivery | Durable payloads, admission, reservations, leases and uncertain-outcome reconciliation are implemented and component-tested. | The planned two occupied runs plus queued delivery/restart scenario remains unrun. |
| Shopping and task lists | Canonical private/household stores, stable IDs, capture, read, complete, restore, approved removal and display are built. Ordinary Qwen shopping delivery passed. | Fixed Shopping/Tasks/Waiting/Notes categories; arbitrary named lists are unsupported. Wider recovery, scope and app/display cases remain open. |
| Local card OCR and shared Rolodex | Local extraction, immutable originals, shared default, source-only fallback, searchable contacts and later-human revision patches are built. Clear-card capture/correction passed through signed app fixture intake. | Discord attachment custody is missing. Redo does not enforce a new extraction. Blurry, rotated, front/back, missing-field, duplicate and real handset cases remain unaccepted. |
| Automatic memory wiki | Current-human source capture, topic/journal curation, fact/candidate labels, private/shared separation, correction history and scoped forgetting are implemented. Private Qwen capture/recall/correction passed. Native SQLite/wiki indexing is reused. | Growing pages have no rollover. Shared capture, inference/contradiction breadth, fresh-session recall, natural forgetting and full restart/restore acceptance remain open. Private-to-shared publication is explicitly deferred. |
| HardyAI email | Bound-account read-only Gmail capabilities and untrusted-content handling are built. | OAuth and actual owner delivery remain held/unaccepted. Sending, labeling and deletion require separately implemented/granted capabilities. |
| Household calendar and invitations | Typed calendar operations, timezone/date handling, recurrence scope, named/allowlisted attendees, reconciliation and readback are built. | OAuth/attendee setup and real provider cases remain held. Readback can report verification without checking requested reminders. |
| Delayed work and brain dumps | Native schedule declarations and grant rechecks exist. Dedicated Discord brain-dump routing is configured; skills compose clear actions and clarify uncertainty. | Schedules lack a delivery destination. Mixed-domain brain dump and scheduled execution remain unaccepted; calendar and project setup are dependencies. |
| Uplift receipts | Reasoning-led source/OCR/context/candidate/review/acceptance/report primitives are built. Policy 2 retains schema 1, exact financial checks, transactional acceptance and accepted-only final reporting. Component tests pass. | Real projects/grants are empty. No complete model-led unfamiliar-receipt, clear acceptance, review/correction or report workflow is accepted. Card OCR success does not prove receipt accounting accuracy. |
| Bitwarden | Exact-ID allowlisted native SecretRef lookup is implemented. Secret values remain outside model-facing results. | Bootstrap is intentionally held. Generic browser delegation and durable credential/token writeback are separate missing integration work. |
| Python analysis and visuals | Restricted native child, fixed no-network/no-secrets environment, scoped input/output and actual-file publishing are built. | Natural run/inspect/revise/publish/cancel acceptance remains open. SVG/PDF are outside the current analysis publisher's supported formats. |
| Explicit diagnosis without repair | Operator-only diagnostic mode, sticky no-repair policy and bounded effect/request metadata are built. | Targeted native/provider logs and real context/compaction/finish evidence are missing. The diagnostic checkpoint lookup uses the wrong goal key. |
| Custom app and kitchen screen | Android conversation/task/question/media/library interfaces and signed kitchen lists, calendar cards and approved raster/text publication are built. | Physical device/enrollment/reconnect/offline/revocation cases remain open. Completed-task kitchen publication and broader report/interactive formats are compatibility limits. |
| Four family members | Four profile/agent mappings and private/shared identity boundaries exist; children are conversation-only. | Only the owner currently has domain grants. Family enrollment, policy rollout and combined GPU/workload acceptance remain open. |

## Concrete implementation gaps

### Same chat task switching

The design allows several tasks in one conversation and interruption/return without losing an unanswered question. The actual reply handler retains the old question but explicitly tells the user to open another conversation for independent new action work. This is an intentional current limitation in code, rather than solely an unrun test.

Evidence: `services/household-control/src/task-flow/service.ts:473` and `task-flow/hooks.ts:74`; intended behavior is in the conversation section of `docs/household-assistant-design.md`.

Adapt the existing native session/goal/checkpoint bindings to select and restore tasks without mixing source authority, questions or receipts. Do not add another task ledger.

### Discord image custody

The design accepts card images from app or Discord. The current Discord observation contains text/provenance, and admission creates a packet with `artifactIds: []`. Documents and Contacts require owned ArtifactStore references. The signed app upload route supplies those references; no corresponding Discord attachment importer was found. Native model visibility of an image does not establish household artifact ownership.

Evidence: `plugins/household-domains/native-task-hooks.mjs:24`, `services/household-control/src/domain-runtime/native-admission.ts:150`, `domains/documents/artifact-adapter.ts:13`, and `platform-http.ts:57`.

Add a narrow attachment adapter into the existing artifact intake, retaining author/channel/audience, original bytes, hashes and later prompt bindings. Ordinary Discord card attachments should not currently be presented as a working household OCR path.

### Scheduled result delivery

Schedule creation always sends `delivery: {mode: "none"}` and disables failure alerts. The tool schema has no destination. Native scheduling and runtime grant rechecks are present, but a requested reminder/report cannot be configured for delivery through this interface.

Evidence: `services/household-control/src/domains/scheduling/index.ts:13` and `:78`–`:84`.

Represent a scoped destination through the existing native scheduler and transport owners, with current recipient/audience checks and an inspectable delivery result. Keep historical jobs disabled. Acceptance should use one new scoped disposable job after this is implemented.

### Diagnostic evidence and phase binding

The evidence tool returns versions and recent effect/request status codes. Its input schema has no affected-task selector. The runtime supplies `outcome: "requested"`, but no native event feed, prompt headroom, compactions, finish reason or redacted provider log data. Those metrics exist in the DTO/test fixture, with no runtime producer found.

The checkpoint lookup also always uses a null goal key, although ordinary diagnostic task admission starts a native goal. It can therefore report an unrecorded phase despite a real goal-bound checkpoint.

Evidence: `services/household-control/src/domain-runtime/catalog.ts:13`, `domain-runtime/runtime.ts:296`–`:301`, `platform/diagnostic-evidence.ts:9`, and `sqlite-household-store.ts:391`.

Bind diagnosis to the affected task/run and existing native evidence, fix the goal-key lookup, and retain the current per-person and no-repair boundaries. The current metadata facade cannot yet explain the full range of context/model failures requested in the vision.

### Memory growth and partial curation

Remember writes one fixed topic page plus one daily journal. At 20,000 characters or 350 lines it fails, with no automatic bounded page parts or rollover. The immutable source may already exist and the topic may have committed before a full journal fails. The resulting unknown projection-refresh state is honest, but ongoing automatic curation stops. Changing the topic name does not bypass a full daily journal.

Evidence: `services/household-control/src/domains/memory/remember.ts:64`, `:66`, `:82` and `:98`.

Add owner-managed bounded parts/rollover and recovery using the same source/wiki authority. Main should supply meaning rather than maintain journal sizes or reconstruct hashes.

### Calendar verification blind spot

Reminders are accepted and sent to the provider, but the readback comparator checks title, dates, selected metadata, attendees and recurrence without checking reminders. A provider result can therefore return `verified: true` while the requested reminder is absent. Stored timezone is also not compared; equivalent timestamps alone do not establish recurrence timezone intent.

Evidence: `services/household-control/src/domains/google/index.ts:54`–`:67`, `:154`–`:156`, `:175` and `:185`.

Compare all requested provider fields with their normalized provider equivalents before claiming verification. OAuth being held is separate from this source defect.

### OCR redo freshness

A later redo can pass an older authorized extraction for the current published contact source. The adapter adopts supplied handles and calls Documents.extract only when none exists; Contacts then commits the revision as `ocr_redo`. No extraction generation/current-request freshness rule distinguishes a new OCR pass from reinterpretation of an existing result. A previous successful redo's handle is a concrete eligible example; some original intake handles correctly fail because their source was republished.

Evidence: `services/household-control/src/domains/contacts/service.ts:168`–`:184`, `domain-runtime/contact-extraction.ts:13`–`:25`, and `test/contact-extraction-adapter.test.ts:38`.

Keep both operations available with truthful semantics: a requested new OCR pass needs a new inspectable extraction, while reinterpretation can reuse existing evidence. Contact updates must still require the later human prompt and current revision.

### Credential lifecycle scope

The Bitwarden resolver invokes only exact-ID `secret get`. It does not unlock Password Manager or write refreshed provider credentials back to Bitwarden. The design requires durable authoritative writeback before claiming successful rotation, and it anticipates deliberately delegated browser logins.

Evidence: `tools/bitwarden-secret-resolver.mjs:49`–`:98`, `tools/README-platform.md:36`, and the credential section of `docs/household-assistant-design.md`.

Bootstrap and secret bindings remain intentional setup deferrals. Rotation/writeback and browser delegation require additional connector integration; supplying the bootstrap alone will not complete the whole credential vision.

## Other limits and documentation drift

- Contact source/hash/extraction/quote proof exists, but page is only range-checked and blockId is not checked against actual extraction structure. Quote matching uses the flattened full text. Treat page/block attribution as advisory until implemented; the accepted single-card case does not establish multi-page location fidelity.
- Kitchen calendar cards are implemented. Current server publication allows PNG/JPEG/WebP/plain text. Browser renderer branches for other formats do not expand that allowlist.
- The earlier suggested prompt "Create a shopping list called Qwen tryout" exceeds the fixed list interface. A supported test is "Add oranges, dish soap and paper towels to the household shopping list," followed by "Add apples to that same list and show everything."
- `docs/memory-acceptance.md` is undated legacy guidance for transcript indexing, Adult Active Memory and USER.md/daily-file destinations. It is orphaned from current active links, but its instruction to rerun after model/GPU changes conflicts with managed-wiki policy. Mark it historical or replace it before using it.
- The local ignored HardyAI AGENTS.md still repeats 0.5/GPT/226–229-test stages as current-looking status. Its pointer to the active project's current-status document resolves authority, but the duplicate dated claims should be clearly historical.
- Dormant `config/workspace/AGENTS.md` instructions still mention an older Markdown task ledger. Automatic injection is disabled; reconcile those mirrors before re-enabling them.

## Immediate work order

1. Finish same-chat task switching and target-bound diagnostic evidence. Exercise native clarification/reconnect, return to interrupted work, controlled context refresh and queued restart in the existing consolidated campaign.
2. Close the Discord artifact-custody and scheduled delivery gaps through existing artifact, identity, transport and native job owners.
3. Add memory rollover, truthful fresh-OCR redo semantics and complete calendar readback. Run focused regressions, then only the affected natural cases.
4. Complete remaining integrated Python, receipts/review/reports, brain-dump, shared-memory/forgetting and display cases. Keep accepted and partial effects inspectable; do not restart the whole campaign or replay old writes.
5. When the held setup is released, establish selected Bitwarden bindings/writeback, provider OAuth, attendee identities and receipt projects; then accept real owner interfaces, physical devices and four-person policy/concurrency. Validate the second GPU when it is connected.

These changes adapt the current platform. The audit found no need for a replacement runtime, queue, memory database, financial ledger or broader model-maintained bookkeeping.

## Audit basis

The comparison uses `docs/household-assistant-design.md`, `household-assistant-implementation-plan.md`, `design-decisions.md`, receipt policy, domain boundaries, client/task/memory contracts, current implementation and retained campaign receipts. Build status, source gaps, intentional deferrals and unrun acceptance are distinguished above.

Protected audit evidence records the live snapshot, exact source/test/model/deployment receipt hashes and fixture state. The inspected release manifest hash is `aa61076ca6f8aa7b74b357f6ce63c860ab7f753f13ff97ca9ac5f11b7317696c`; the redacted live snapshot hash is `98d7a328f32ef1a1d58427668124832bf78b92618d4dfd4915a8c3c34bc4b28e`. This audit introduced no runtime or model changes and made no new model inferences or household-provider effects. The findings are source-demonstrated unless an actual executed case is explicitly named.
