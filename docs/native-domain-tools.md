# Native domain tools: Slice 2

Status: implementation source prepared November 3, 2026. This record describes adapter boundaries, not functional acceptance. All new unit/contract and semantic cases remain deferred until the complete three-slice build. The application composition and deployment record determine actual registration/readiness.

## Reuse and ownership

| Area | Decision | Authority and boundary |
| --- | --- | --- |
| Lists and captured notes | Reuse | Existing household-capture Python/Markdown store, stable IDs, lock, atomic updates and readback. The wrapper does not create another list database. |
| Household Google integration | Adapt | Existing pinned gog CLI, bot account and configured household calendar. Protected configuration selects account/client/calendar; model content cannot choose them. |
| Dates and time zones | New narrow primitive | Provider accepts explicit instants; local wall times can be nonexistent or ambiguous at DST boundaries. The resolver returns actual candidates instead of a phrase-specific date router. No durable state. |
| Memory sources | Adapt | Immutable explicit-source Markdown files inside each selected native memory-core workspace tree. No additional database, embedding index or background queue. |
| Wiki | Reuse | Bundled memory-wiki owns pages, structured claims, compile state and native search. Agent-scoped vaults preserve private agents; a non-conversational household-knowledge scope owns shared knowledge. |
| Scheduling | Reuse | Native cron owns job identity, declaration convergence, revisions, runtime and history. Wrapper owns no timer/worker/queue. |
| Operation receipts and authorization | Reuse | Injected application effect authority and current invocation grant. Domain adapters never accept credentials or arbitrary provider payloads. |

Each adapter receives explicit ports. The native RPC port requires the original trusted invocation context on every request so authority can be checked after connection waits. The fixed-argv runner receives a current-authority callback, cancellation signal, effect/read distinction, timeout and output bound. No shell, arbitrary binary, calendar selector, account, agent selector or filesystem path appears in the model schemas.

## Implemented tools

`domains/native-domains.ts` exports the four domain classes, their descriptors and narrow contracts. Metadata remains domain-owned rather than accumulating behavior in the router.

- Lists: read, capture, complete, restore, remove, captured-note search/recent and display projection. Personal reads are unavailable in a household-audience invocation. Exact removal requires trusted destructive approval. Display output is a snapshot, not another list store.
- Email: search and sanitized message read through the configured bot account. Commands enforce read-only and Gmail-no-send. No mailbox read-state change, send, auth-repair or attachment-file path operation is exposed.
- Calendar: local time resolution, arbitrary explicit date-window search, event read, operation-marker lookup, create, edit and delete. Writes use the single configured household destination. Attendees must each belong to the trusted current recipient grant; no default family invitation. Recurrence edit/delete scope is explicit. Create/update perform provider readback; mismatches remain visible. Delete returns provider acknowledgment without inventing readback verification.
- Memory: exact-quote source save, source read, wiki status/search/get, managed synthesis/annotation and native compile. A current source ID alone cannot promote model text to user-confirmed: its saved text must be an exact quote in the trusted verified source. Paraphrase and inference remain candidates at source capture. Main can synthesize grounded claims from retained evidence.
- Scheduling: scoped native job list/get, declaration, revision-bound update/cancel and approved removal. Declaration keys bind profile, conversation and logical operation. Default creation is disabled, uses no scheduled tools and has no output delivery. Activation is unavailable until the composition provides real scheduled-run authorization; a saved disabled declaration is not a working reminder.

The bot may invite personal email recipients under a granted request while the canonical event remains on the household calendar. This tool surface does not write directly to personal calendars or synchronize Google Contacts.

## Data lifecycle and projections

| Datum/effect | Owner | Retention, consistency and deletion |
| --- | --- | --- |
| List/note content | Existing canonical scoped Markdown | Existing lock, atomic replace and read-after-write behavior. Completion/removal stay recoverable. API output derives from that source. |
| Calendar/mail provider state | Google under configured bot grant | Reads are untrusted evidence. Application operation receipts and provider markers relate effects without becoming a second calendar. Unknown write outcomes must be reconciled; a zero marker lookup is not permission to resend. |
| Explicit knowledge source | Native memory-core Markdown source tree | Immutable operation-bound file, fsynced file/directory, fingerprint replay conflict and symlink refusal. Scope chooses either the active private agent or the shared native knowledge scope. Native indexing stays derived/rebuildable through its existing lifecycle. |
| Topic and claims | Native memory-wiki | Sources are referenced, not replaced. Native compile owns derived SQLite state. Wrapper reads only local wiki corpus, with no transcript fallback. Raw native private-tool editing remains a separate trusted-operator compatibility surface. |
| Schedule definition/history | Native cron | Stable declaration key and owner, exact config revision for updates. Cancel disables and retains history; physical removal requires current destructive approval. No duplicate scheduler ledger. |

Explicit-source retention/forget across sources, wiki claims and native indexes must be completed with the later task/curation lifecycle before whole-product forget acceptance. This adapter does not claim that hiding a wiki page erases its source. Existing native deletion boundaries remain authoritative.

## Concurrency, uncertainty and remaining integration

Native wiki apply has no compare-and-swap parameter. Managed topic updates therefore require a complete bounded preimage hash including native update metadata and serialize per topic in one injected adapter instance. Partial page excerpts cannot authorize a full-topic overwrite. This protects calls through the adapter; raw external native writes can still race between the preimage read and apply. Keep managed sources/topics protected from ordinary raw edits and record this upstream limitation in final acceptance. No shadow memory revision database was introduced.

New calendar operations use a deterministic private provider property and the application effect ledger. Generic unknown provider outcomes are never reclassified as safe-to-retry merely because response parsing or readback failed. Existing named-operation replay must return the durable receipt; provider reconciliation is a separate read.

Functional tests were written for schema boundaries, DST gaps/overlaps, pinned Google routing, recipient grants, unknown writes, list privacy/path redaction, exact-quote source trust/replay, symlink refusal, shared wiki routing and inactive/owner-filtered native scheduling. They were not run in Slice 2. Structural deployment checks should import these modules and validate plugin/tool schemas without invoking their workflows, provider writes, models or real scheduled jobs.

OAuth and Bitwarden bootstrap remain unconfigured/deferred where documented. Readiness must report executable/configuration availability separately from usable provider authentication. No credentials were inspected, resolved or copied by these implementations.

## Changed files and rollback

Owned source is under `services/household-control/src/domains/{lists,google,memory,scheduling}`, with `native-contracts.ts`, `native-validation.ts` and the `native-domains.ts` export facade. Deferred contract tests are in `test/native-domain-boundaries.test.ts`.

[`prepare-domains.py`](../deploy/hardybot/prepare-domains.py) prepares private domain grants and a merged native candidate configuration without activation. It preserves existing family/provider settings, pins the configured bot resources, separates shared/private wiki scopes and refuses conflicting existing owned settings. Candidate checks use staging output paths; regenerate from the canonical deployed source before activation. Python paths retain virtualenv invocation semantics after their executable targets are validated. No data import, provider call, model turn, scheduling activation or credential lookup occurs in this preparation step.

These adapters add no application schema migration. Back up the existing canonical list/memory/wiki roots and native scheduler state before enabling writes. Disable their tool registrations or resource grants to roll back exposure; preserve accepted effects and immutable sources. Rolling back code does not cancel an existing native job, undo a calendar event or erase knowledge. Use the owning operation deliberately rather than deleting a state directory.
