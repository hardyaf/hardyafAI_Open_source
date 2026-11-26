# Household assistant design

Updated November 4, 2026.

Status: living design under discussion. Confirmed choices below reflect the current owner conversation. Proposed mechanisms require implementation and acceptance; this document does not claim that they are deployed or authorize runtime changes by itself.

## Product intent

Jarvis is an OpenClaw household assistant for four family members. It should finish useful work, converse naturally, retain the current topic, ask a necessary follow-up, and continue the same task from the answer. Its repeatable skills should deliver accurate saved results. It should also handle unfamiliar combinations of authorized capabilities, short analysis programs, and visual outputs.

Use stock OpenClaw as the agent runtime, with supported extensions and narrow household integrations. Keep the existing local-model baseline while measuring actual failures. The retired native HardyAI runtime and frozen Jarvis archive are references for individually reusable contracts and artifacts, not alternative active engines.

The source project is this OpenClaw repository. The current implementation and evidence are summarized in [current status](current-status.md). The [implementation plan](household-assistant-implementation-plan.md) records the reuse decisions, ownership and acceptance work.

## Confirmed owner choices

| Choice | Agreed behavior |
| --- | --- |
| Brain dumps | Execute clear authorized items; ask about uncertain details. Do not require a preview of the entire breakdown. |
| Brain-dump entry | V1 uses a dedicated shared household Discord channel. Clarification replies continue their bound task. |
| Invitations | Invite only named people or recipients covered by an agreed rule. Do not invite both adults to every household event automatically. |
| OCR location | Process locally by default. A cloud exception requires approval for its provider, data and scope. |
| Receipt acceptance | Clear receipts accept automatically; unresolved amounts, projects, duplicate identity or reconciliation enter visible review. |
| Receipt reasoning | Main reasons through composable Uplift operations, evidence and calculations; existing scripts supply reusable capabilities rather than a mandatory pipeline. |
| Business cards | Save every card and report the save. Show uncertainty without blocking capture. Change saved fields only in response to a user prompt within current permissions. |
| Card follow-ups | Treat the response as a normal prompt connected to the saved card, including requests to redo OCR; do not restrict the user to canned correction commands. |
| Rolodex | Local contact directory first, shared with the household by default. Google Contacts synchronization is deferred. |
| Wiki | Automatically record clear facts in the appropriate private/shared knowledge context; keep uncertain inferences as candidates. |
| Diagnostics | Run only when explicitly requested by the operator. Explain failure and a proposed fix; do not apply it. |
| Credentials | Use Bitwarden for external secret storage. Prior design selected automation Secrets Manager entries, with execution on the trusted local host. |
| Computation | Prior context work deferred arbitrary tool/turn/concurrency caps. Preserve useful continuation, cancellation and no-progress detection. |
| Build and testing order | Build the whole planned system in integration slices; run deployment/startup checks between slices and functionality testing after the complete build. |

Prior owner intent also permits ordinary personal mail sending without a blanket approval for every message. That future product intent does not change today's read-only Gmail grant or authorize sending a particular message without a request or standing rule.

## Skills and accurate execution

A skill supplies a purpose, instructions, examples, schemas, resource bindings and meaningful restrictions. It should not be a growing list of exact request phrases. Main interprets the request, loads relevant skill context, and composes tools. Deterministic integration code validates account, resource, authority and effect identity.

A skill is functionally accepted only when a request through the actual interface commits the intended state, independently reads it back where possible, reports its evidence, and survives an uncertain response or retry without duplicating effects. Those behavior cases run in the consolidated campaign after all planned build slices; intermediate checkpoints establish deployment/startup only. Distinguish tool acceptance, durable queue acceptance, provider commitment and verification. Model prose alone is not a completion receipt.

Capabilities must expose useful errors: invalid arguments, unavailable integration, authorization failure, uncertain provider outcome, missing input or model-output failure. Do not describe every failure as missing credentials, context loss, or a model limitation.

### Email and household calendar

The assistant reads its HardyAI mailbox and manages its own household calendar. Use the configured bot OAuth account and resource binding, not a guessed account name. OAuth lifecycle belongs to the connector; a vault password is not a replacement for provider consent.

Household events are authoritative in the household calendar. Inviting Alex or Natasha sends an invitation to the specified personal calendar identity; the resulting acceptance and personal-calendar display remain provider/user state. Creating an invite must not silently become a direct write to another person's calendar.

Resolve dates, year, timezone, all-day boundaries, recurrence, occurrence-versus-series changes and recipients from context or a focused question. Verify the saved event and its intended attendees. Repeated explicit requests and uncertain retries need operation identity and destination reconciliation. Respect standing recipient rules without adding an extra approval to each already-authorized invitation.

Direct edits to personal calendars, mail sending, mailbox labeling/deletion and new third-party recipients are separate grants. Do not infer them merely from the existence of a password or the ability to read the mailbox. Restore the existing OAuth grant as separate operational work; it is outside the immediate context/continuation package.

### Shopping lists

Reuse household-capture's stable IDs, atomic writes, duplicate handling, recoverable completion/removal and readback. Personal and shared lists keep distinct owners. Shopping-list content is not copied into a new wiki task list or kitchen-only database.

The app and kitchen screen display a projection of the same canonical lists. Mutations from an authenticated app use those same operations; a display-only kitchen client cannot modify them. Show freshness and offline state instead of presenting an old snapshot as current.

### Ad hoc analysis and Python visuals

Jarvis can gather authorized data, write a short Python program, execute it, inspect the output and revise the program. Publish useful artifacts such as a table, PNG, SVG or interactive report to the task and selected display.

Reuse supported OpenClaw execution/sandbox facilities and a maintained Python environment before proposing a custom runner. Generated programs should receive task-scoped input references and the capabilities they need, without the vault's plaintext credentials. Distinguish analysis from an external mutation. Keep source, inputs/provenance, outputs and execution outcome with the task.

Do not make package installation or unrestricted provider access an implicit consequence of asking for a chart. Agree the initial analysis packages during implementation and use existing cancellation/resource handling for hung programs.

Authorized adult root conversations use stock OpenClaw search and fetch for
public sources. Main sends only the public terms needed for the lookup, treats
retrieved material as untrusted evidence, and cites the sources it used. When
calculation is needed, Main can hand relevant verified material to its offline
analysis worker as scoped input. The existing audience and tool authorization
checks own access. OpenClaw owns provider requests and caching. The private
SearXNG instance sends queries to its enabled upstream engines.

## Conversation and automatic continuation

A conversation can contain several tasks, and a task can span several model turns or worker sessions. Preserve an explicit binding between the conversation, owner, current task, current phase and any unanswered question.

The parent owns the user goal, latest corrections, scope and completion criteria. Native OpenClaw tool execution and subagent completion supply continuing turns. Substantial phases can use fresh workers with compact handoffs. A durable goal keeps the objective present; it does not independently schedule another execution.

Each handoff includes the goal, latest correction, authority, accepted facts, evidence/artifact references, completed effects and their IDs, pending effects, open questions and exact next step. Large tool responses stay in artifacts with bounded excerpts. Current-task recovery must not depend only on semantic memory search.

When information is missing, persist the question against the task/phase/resource it concerns. An answer should resolve that question and resume the same task. A reply may also redirect, cancel, explain, or start a different task; interpret it semantically. Do not force a fixed response grammar. If several outstanding questions make the target ambiguous, ask which one rather than attaching the answer to the newest timestamp blindly.

When a new topic interrupts a task, retain its paused state. Returning to it must restore the goal and committed work. A worker completing, yielding, or emitting a final message does not automatically mean the whole user task is finished.

Keep the current 32K model profile initially. Track actual per-call headroom, output finish reason, compaction, refresh and no-progress failures; cumulative processed tokens are not available context. Investigate truncation from the configured output allowance before changing it. Preserve completed actions across compaction and resume.

## Brain dumps and delayed work

V1 uses a dedicated household Discord channel as the shared brain-dump entry point. Channel identity supplies the mode and audience; no prefix is required there. Authenticate each author and preserve their capability grants. A reply to a pending question continues its bound task before a fresh dump is considered; ambiguous references are clarified. App entry modes or a “brain dump:” label elsewhere are later conveniences, not V1 requirements. Ordinary private conversations retain their private audience.

Separate the input into actionable events, list items, delayed work, useful non-task facts and unresolved questions. These categories guide composition, not phrase-specific routing.

Execute clear items within the current grant. Leave only uncertain items waiting for clarification; do not hold the whole dump hostage to one missing date. Return one coherent report linking each saved event, list item, scheduled task and memory update, plus remaining questions.

Scheduled work uses OpenClaw's existing scheduler/task infrastructure, with an explicit timezone, owner, original goal, due time, capability scope and delivery destination. Recheck grants when it runs. Retain durable outcomes, cancellation and bounded native recovery. Do not build another cron daemon or rely on an in-memory reminder.

A brain dump can produce both actions and knowledge. Calendar owns an appointment, the list store owns a shopping item, the scheduler owns delayed execution, memory-core owns durable knowledge sources, and the wiki owns source-linked topic synthesis. Link them rather than storing competing copies.

## Automatic memory wiki

The wiki has two complementary views: dated episodic observations and enduring topic pages, such as family members, AYSO, household equipment and projects. It captures important information even when no task follows from it.

Reuse OpenClaw memory-core, Markdown sources, its existing SQLite search/index, and the bundled memory-wiki plugin where verified. Slice 2 enabled isolated agent-scoped wiki storage and typed source/topic primitives, including a separate shared knowledge scope; the implemented remember facade now binds the current source and owns topic merge plus daily journaling. Auto-compilation alone does not establish factual synthesis. Natural capture/recall/correction/forget acceptance remains separately tracked in [current status](current-status.md). See [managed memory](memory.md) for current ownership and limits.

Clear user-stated facts can be recorded automatically. Preserve source, date, audience and certainty. Uncertain inference remains a labeled candidate, not a quietly promoted fact. Preserve native origin/trust classification: mail, web pages, OCR observations and agent inference remain attributed sources, not user-confirmed facts or directives. A correction supersedes an old claim with provenance; conflicting statements remain visible until resolved. Avoid treating generated diary summaries as independent evidence for themselves.

Private diaries and topic pages remain private. Personal writes use the admitted agent's corpus; household writes require an actual shared conversation and use the configured neutral household corpus. An actor's household access grant does not authorize publishing private conversation content. The current memory contract has no private-to-household publication grant; that workflow remains deferred. Shared conversations cannot read or write a personal corpus. Privacy metadata alone is not enforcement; current identity, audience and resource policy still apply.

SQLite should provide the requested reference/search layer through existing native memory/wiki state. It is a rebuildable index/projection of authoritative sources, not a second editable memory database. Exact contact identifiers use the Rolodex, and exact list items use the list store.

Retrieval finds a relevant source/page, reads enough evidence, and answers with its date/uncertainty when material. Do not inject the entire wiki into every prompt. A fact shared only once still needs a direct capture path; frequency-based dreaming must not discard explicitly important facts.

“Forget this” must define and report its actual effect across source notes, active recall, wiki claims, compiled snapshots and indexes. Native memory forgetting alone is not proof that a separate wiki copy vanished. Set backup/history retention policy separately and never promise deletion from unrelated backups.

## Business-card OCR and Rolodex

This is the first OCR product slice. Receipts reuse it only where the extraction interfaces and quality needs match.

Accept front/back business-card images and supported PDFs from the app, Discord or an authorized source reference. Persist the original intake and its owner/source receipt, then perform local extraction with evidence. The typed Documents adapter accepts authorized PDF, JPEG, PNG and WebP artifacts and publishes immutable extraction references; its cache paths and legacy URL launcher are not model-selected input paths. Transport and natural workflow acceptance remain separately tracked in current status.

Every card is saved to the shared household Rolodex by default, and its save report names that destination only after persistence. Sharing the card does not publish unrelated source-conversation history. The durable source-card/intake record is independent of extraction success: a card with zero readable fields still saves and receives a receipt. Save recognized name, organization, title, email, phone, website and other supported observations, with the original source and field uncertainty. Missing or unreadable fields remain missing or uncertain. Saving a card does not label its contents as externally verified or authorize contacting the person.

Clear scans and ordinary corrections may use authorized tools without a native goal. Propose initial values through fields or field/value observations without duplicating them. Explicit fields, including an empty object, choose the saved selection. Exact quotes may bind omitted observation source IDs only to one authorized, hash-verified extraction; ambiguous or explicit wrong references fail safely. An observations-only OCR redo patches those fields and preserves untouched fields/evidence; manual corrections still use an explicit patch or replacement.

Do not block capture for a mandatory review. Do not silently repair saved fields, merge records, rescan in the background, or reinterpret a card later. A user response is an ordinary prompt bound to the card/contact revision. It can ask for another OCR pass, provide corrections, distinguish two people, add context, or request another permitted action.

Keep the original and extraction/correction history. A redo produces an inspectable new extraction; do not discard prior evidence. Mutations must identify the affected contact/card and current revision. A new card that resembles an existing contact may carry a match suggestion; do not silently overwrite or merge the existing contact.

Retrying the same intake must return its existing receipt without creating an accidental duplicate. A distinct submitted card still gets its own saved source, even when it concerns an existing person.

The local Rolodex is the sole initial contact authority. Reuse the historical ContactProvider search/upsert contract and correction/proposal semantics where suitable. A canonical mutable contact store did not exist in the prior implementation; record this as a justified new local Contacts domain backed by the selected application SQLite/migration authority; see the [local Rolodex decision](ADR-001-local-rolodex.md). Keep vendor-owned OpenClaw tables untouched and expose a narrow application interface.

Support search by name, organization, role, email and phone, exact lookup for identifiers, source-card readback, and owner/shared scope. Wiki person pages may link to contact IDs and add contextual knowledge; they must not become a second authoritative address book. Google Contacts sync is deferred and would be an explicit projection with conflict/deletion rules.

## Uplift receipts integration

Adapt the existing Uplift_Finance implementation into a reasoning-led toolkit. It retains authority over immutable originals, content hashes, OCR layers, receipt/line-item records, exceptions and PDF/XLSX reports. Main chooses how to inspect, extract, reason, calculate, resolve project context, revise and verify using those capabilities. A new vendor or request must not need another scripted workflow or top-level intent. Jarvis keeps references and results rather than a competing financial ledger.

Expose composable operations for source evidence, local OCR, project context, duplicate candidates, calculation, versioned candidates, validation/acceptance, review and reports. Retain project/account ownership, idempotency and evidence. Main may use short Python programs for analysis while the owning interface commits ledger effects. The existing Windows convenience runner is not a production dependency; execution runs on Ubuntu.

The current real OCR adapter uses a cloud provider. The agreed integration default is local processing; a cloud exception requires explicit approval. Validate a local adapter against receipt totals, dates, vendors, line items and project mapping. Do not equate business-card accuracy or successful PDF text extraction with accounting accuracy.

Existing Gmail intake uses a modify grant and marks processed mail read. That mailbox/effect scope is separate from the assistant's household read-only inbox. Prefer an explicit attachment handoff or clearly grant the receipt inbox behavior; do not silently inherit those permissions.

The agreed [receipt reasoning and acceptance policy](receipt-acceptance-policy.md) distinguishes processed execution from provisional and accepted financial state. Clear receipts accept automatically after source-grounded checks and readback. Jarvis may resolve issues autonomously using authorized evidence and context; unresolved amounts, projects, duplicates or reconciliation become visible review items. Existing HTML review and parser accepted/match flags do not implement that policy. Preserve revisions/corrections and use accepted-only final reports.

## App and kitchen display

Keep one household control/application interface with owner-aware views and canonical task/run links. The Android app should show conversation, clarifications, ongoing work, cards/contacts, lists, wiki topics and task artifacts as implemented slices. Phone speech-to-text can submit text through the service boundary; authorized image artifact intake is a separate implemented path. Handset and physical-display acceptance remain separate from that API capability.

Use the legacy Raspberry Pi kiosk/view-message specification as a reference. The archive contains build instructions, not a completed display application. Raspberry Pi plus a browser is the proposed V1 screen client; an Arduino implementation is not assumed.

The kitchen device receives a household-scoped, read-only projection and its own revocable device identity. It must not receive the Gateway owner token, vault secrets or private transcripts. Display shared lists/calendar cards and explicitly published visuals or reports. Show loading, error and freshness states.

A request such as “put that on the kitchen screen” resolves “that” from the current task artifact and checks its audience before publication. A private diagnostic, receipt or personal diary is not household-public merely because it has an artifact URL.

## Bitwarden and integration credentials

Use the prior selected external-storage design: a dedicated automation Secrets Manager project with scoped machine access. Bitwarden owns secret values; protected host configuration holds the unavoidable bootstrap credential. Execution remains on the trusted local host.

Reuse supported OpenClaw SecretRef exec resolution and the Bitwarden CLI/SDK before inventing a broker or secret database. The trusted connector resolves selected immutable secret IDs and returns operation results, not plaintext passwords to the model. Store only non-secret connection metadata locally: label, account/resource aliases, secret IDs, grants, health and rotation outcome.

Password Manager vault access and Secrets Manager machine access are different mechanisms. Browser-only logins can use deliberately delegated credentials; do not silently unlock the entire personal vault. MFA, passkeys, CAPTCHA or fresh consent can still require a person. API/OAuth integrations should use their supported credentials rather than browser passwords where available.

Provider refresh-token replacements need durable writeback to the authoritative secret store before hard success. Migrate one integration at a time, prove restart/rotation/revocation behavior, then retire superseded local plaintext copies. Credentials must stay out of prompts, wiki, logs, transcripts and generated artifacts.

This follows the owner's trusted-host model and is not a hard isolation claim while general host execution remains available.

## Explicit diagnosis without repair

A proposed trigger is “Jarvis, diagnose this,” with an equivalent operator app action. The trigger is intent, not authentication. Bind it to the affected task/run or ask a concise targeting question.

Create a diagnostic task with an enforced operational read-only tool surface covering the parent, every worker and every continuation. A parent cannot apply a diagnostic worker's proposed fix using its usual tool privileges. Reuse the current diagnostics capability, native tool policy and task artifacts. Provide a narrow redacted evidence reader; leaving unrestricted shell execution available would defeat the no-repair rule.

Evidence can include lifecycle, tool validation, redacted provider errors, checkpoint metadata, context/headroom, compaction, non-secret configuration, versions and source references. Logs and documents remain untrusted data. Preserve each adult's privacy; operator status does not automatically expose another adult's transcripts.

The report states what failed, observed evidence, hypotheses/confidence, the smallest proposed fix and a verification/rollback approach. It may publish the report artifact. It cannot patch code, edit skills, change policy or credentials, install software, restart services, change schedules, or replay mutating work. Fix implementation requires a separate subsequent instruction.

Do not add automatic periodic diagnosis in V1. Background failures may produce ordinary operational status, but the explanatory log-analysis task begins only on explicit request.

## Ownership and extension rules

| Datum or effect | One authoritative owner | Projections |
| --- | --- | --- |
| Agent execution and continuation | OpenClaw session/task/subagent runtime | Household status and task views |
| App identity and accepted submissions | Household control SQLite/migrations | Device/profile cards and run links |
| Phase handoff and evidence | Current task goal/checkpoint/artifacts | Compact worker prompts and progress |
| Calendar/email provider state | Google through the owning connector | Receipts, bounded observations and display cards |
| Lists and captured notes | Existing scoped household-capture stores | App/dashboard/kitchen views |
| Durable memory sources and promotion | Scoped native memory-core authority | Native recall indexes and provenance-linked source reads |
| Topic pages, syntheses and source-linked claims | Scoped memory-wiki authority | Compiled digests, native SQLite plugin state and authorized topic views |
| Contacts and accepted fields | New local Contacts domain | Search index, wiki contact references; future Google sync |
| Original card/document bytes | Authorized document intake/artifact authority | OCR observations and bounded previews |
| Receipt originals and financial records | Uplift_Finance | Jarvis job references, review cards and report links |
| Secret values | Bitwarden | Non-secret connection references/health |
| Scheduled work | Existing OpenClaw scheduler/task runtime | Due/status cards and notifications |
| Diagnostic findings | Private diagnostic task artifacts | Operator report view |

Do not create a second queue, task engine, memory service, list store, contact authority or credential store. A genuinely new boundary needs a concrete incompatibility, owner, migration/retention behavior, operating cost and rollback plan. Prefer configuration, supported extension or a narrow adapter.

## Remaining design work

The product choices above are confirmed. Technical and interaction details still to settle include shared-wiki concurrency, initial standing calendar rules, contact editing roles, initial receipt report profiles and project rules, kitchen layout/input hardware, and diagnostic trigger/target selection.

These are scoped design questions, not reasons to defer context/continuation repair or to require approval for every ordinary authorized action. Consult the [source map](design-source-map.md) before adapting historical code or assuming a feature already exists.
