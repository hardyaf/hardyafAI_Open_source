# Slice 3 domain behavior and ownership

Updated November 4, 2026. This describes source behavior and ownership.
Deployment, runtime activation and functional acceptance are reported by the
living implementation plan/status; source and contract tests do not establish
natural-agent workflow acceptance.

## Reuse decisions

| Capability | Decision and boundary |
| --- | --- |
| Selected skill context | Adapt existing domain-owned Markdown skills. `skills/household-domains.json` maps authorized domain IDs to relative skill contexts; it is a context projection, not another capability registry. Catalog schemas and current grants remain authoritative. |
| OCR/cards | Reuse local documents artifacts and existing ContactsService/revisions. Every card saves and reports, even with zero fields; later ordinary human prompts authorize targeted corrections/redo. No Google Contacts sync or automatic enrichment. |
| Mail/calendar/lists/schedules | Compose existing typed domain tools over configured native/provider authorities. Skills no longer ask Main to call raw CLI or edit store files. |
| Memory sources/wiki | Adapt existing source Markdown and native wiki compiler/index. Native 2026.9.8 `wiki.apply` supports create_synthesis/update_metadata but has no deletion RPC; a bounded managed-page adapter reads, merges, prunes or invalidates only its owned synthesis namespace. No second memory DB, search index or queue. |
| Receipt review | Adapt ReceiptsBridge with a trusted later-human review binding from task admission. Uplift remains financial authority; ordinary responses remain prompts. |
| PDF/XLSX | Add document projectors behind existing `report.generate`, reusing maintained ReportLab/openpyxl in the managed Python environment. No alternate financial query/report authority. |

## Source navigation, correction and forgetting

`household_memory_source_list/read/references` expose scoped source metadata,
exact captured quotes and managed topic relationships. Search returns only
`syntheses/household-topic-*.md` results. Get and annotate require an exact managed
lookup; transcript, broad memory corpus and unmanaged-page fallback are absent.
Private scope maps to the admitted agent workspace/vault; household scope maps
only to the configured neutral household agent. There is no private fallback.

A user-stated source is confirmed only if its text is an exact quote in current
verified human evidence. Inference/external observations remain candidates.
Synthesis claims keep source evidence; Main is responsible for faithful semantic
interpretation, while code enforces existence, scope, provenance class and
candidate status. Existing page updates use complete-body hashes and serialized
preimage checks. Raw native mutation paths must remain unavailable to household
Main. Adapter serialization is not a native cross-writer CAS; changing unmanaged
pages outside the adapter requires separate operator coordination.

`source_supersede` requires an exact quote from a later verified human source
and the old fingerprint. It validates the human origin before saving a
replacement, preserves an explicit non-indexed JSON history, retires the old
Markdown source, prunes attributed entries/claims/references while preserving
unrelated topic and journal entries, compiles the native wiki and refreshes
the native memory index. Opaque legacy/review/human prose is conservatively
invalidated with explicit rebuild-required receipts. Main curates the replacement
using remember with sourceId set to the returned replacementSourceId plus the
same current-human quote/claims. The owner reuses that confirmed source and
maintains both topic and daily journal without a duplicate capture or manual
journal/hash work. Main rebuilds only affected opaque pages from surviving
evidence. Superseding a statement is not silently
rewriting its original evidence.

`source_forget` requires current destructive approval, exact source ID/scope and
fingerprint. It removes the active captured source, its owned superseded history
and attributable managed entries, then runs the same native projection refresh.
Opaque dependent pages require conservative invalidation and an explicit
rebuild disclosure; this is not a promise to preserve arbitrary legacy prose.
Unrelated fully attributed entries and their sources remain intact.
The installed native compiler's exact Related marker section and generated link
grammar are recognized as a mechanical projection. They are preserved unless
stale retired-source links require dropping that projection before native regeneration.
Human prose or malformed/duplicate Related markers retain conservative
invalidation; an arbitrary note is not discarded as generated metadata.

Before any retirement, a pending lifecycle receipt is committed under
`memory/household-sources/.household-state`. Markers/receipts carry identifiers,
fingerprints, opaque topic hashes and progress, without fact text or topic
titles. Retired source IDs cannot be resurrected by repeating their original
operation. Partial refresh blocks wiki recall/synthesis. The owner supports idempotent
reentry, but unknown transport effects require reconciliation before retry;
actual restart recovery remains unaccepted. Success requires compile and reindex.
The central effect boundary must admit explicit idempotent recovery of these
owned local operations without enabling blind retry of provider effects.

This is scoped live-memory forgetting, not global erasure. Original conversation
and task artifacts, unmanaged/untracked copies and external backups are retained
outside the promise. Native `memory forget` is a distinct session-lineage purge;
its installed documentation explicitly excludes arbitrary freeform file edits
and complete transcript/archive/backup erasure. It is not exposed as a broad
household tool. Product curation must not recreate a forgotten fact from old
chat history without a new explicit human restoration request.

## Trusted receipt review evidence

`TrustedReceiptReviewBinding` is supplied by the composition/admission boundary,
never a model argument:

```ts
{ receiptId, revision, sourcePromptId, quote,
  approvedException?: { waivedReasons, reason } }
```

`sourcePromptId` is the raw admitted submission ID. The verified evidence
sourceRef retains the existing `user:<submissionId>` convention. Both ordinary
`review.respond` text and `record_user_statement` quotes must occur exactly in
the current human prompt. A supplied binding must match this current prompt,
quote, actual receipt/review and current revision. A reply records evidence and
requests reasoning; it never moves the acceptance pointer by itself.

Exception facts are emitted only from the trusted binding after root verifies
an explicit signed approval question and its target/revision/waived reasons.
The model cannot mint an exception flag or reinterpret a generic affirmative as
an approval. Uplift independently rechecks review permission, committed evidence,
target/revision and its narrow waiver allowlist during acceptance. Nonwaivable
identity/source/grant/critical-value/currency/duplicate gates remain in force.
Exception acceptance stays unverified, retains warnings and is excluded from
verified itemized reports.

## Report projections

`report.generate` supports JSON, CSV, PDF and XLSX over the same current accepted
financial projection. Draft provisional rows/totals are separate, missing values
remain blank/null, disputed entries and unsupported itemization are withheld,
and currencies never combine. PDF/XLSX include summary, accepted, allocations,
provisional, withheld and optional itemized sections. Money remains exact integer
minor units with explicit currency; spreadsheet cells are literal text, including
formula-looking vendor data. No binary float recomputation, executable formula,
external hyperlink or remote document fetch is introduced.

The owned transport remains bounded to 4 MiB. Accepted row content is capped
before document generation, individual cells are bounded, and binary output is
at most 2 MiB before base64. Oversized output returns a typed limit failure;
there is no silent truncation of monetary rows. Main must narrow the report or
choose a suitable supported representation. ReportLab/openpyxl imports are
lazy; unavailable renderers return `receipt_report_renderer_unavailable`.

Node validates binary encoding, declared length, allowlisted MIME and signature
before publishing an immutable private artifact. A report output is a projection,
never new accepted state and never a kitchen financial feed. Root ArtifactStore
owns private artifact access and the XLSX MIME boundary.

## Data ownership and rollback

| Datum | Authority | Projection/retention/deletion |
| --- | --- | --- |
| Captured memory source | Existing agent memory Markdown tree | Immutable quote; correction retires with explicit JSON history, scoped forgetting removes body/history. |
| Managed topic | Existing native wiki synthesis file | Derived from captured sources; correction/forget prunes fully attributed entries and preserves unrelated content. Opaque dependent pages are invalidated with rebuild disclosure; native compiler/index projections refresh afterward. |
| Retirement receipt | Same source-tree private lifecycle metadata | Content-free IDs/hashes/status; blocks partial recall and records owner recovery. Unknown effects require reconciliation; actual restart recovery remains unaccepted. No independent facts/index. |
| Contact/source/revisions | Existing contacts domain and artifacts | Save every card, later human correction CAS; scope and revision history preserved. |
| Receipt review/acceptance | Existing Uplift ledger/vault | Responses append; accepted financial state changes only through Uplift transactional acceptance. |
| Receipt approval binding | Existing trusted task question/checkpoint authority | Current human origin and signed target approval; no approval store added to Uplift bridge. |
| PDF/XLSX report | Private artifact projection of Uplift report | Immutable access-scoped output; does not modify source/acceptance. Existing artifact retention applies. |

Disable a tool/context at composition to roll back availability. Keep source
tombstones and pending receipts; restoring removed facts or rolling back native
files requires a deliberate operator recovery, not automatic redeployment of an
old projection. Financial rollback never restores an older ledger over newer
accepted work or reconnects destructive donor writers. Provider OAuth, vault
bootstrap, real receipt project data/grants and schedule activation remain
separate operator configuration; no sample project or private data was imported.

Contract coverage includes trusted review quotes/target revisions,
literal exact-money spreadsheet projections, readable PDF sections, destructive
forget authorization, native-refresh failure/restart, later-source correction,
history forgetting and managed recall restrictions. These deterministic contracts
are separate from native model workflows and actual restart recovery. Current
runtime and acceptance results belong in the living implementation plan/status.

## Source-backed daily journal and application projections

Normal verified human memory curation maintains managed `Daily journal YYYY-MM-DD`
entries for important captured facts or requests alongside thematic knowledge
pages. It reuses the same scoped source evidence and full-page hash update,
preserves previous body/provenance/candidate labels, and describes a request as
a request until actual delivery evidence exists. This is a source-backed day
presentation, not a background summary of every transcript or a second diary
store. Native dreaming and active-memory injection stay disabled. The native get
response omits full source/claim frontmatter, so the remember facade reads the
existing native-managed page through the bounded owner adapter and checks its
full preimage before merging. It preserves prior metadata, claims, references and
body content; Main need not reconstruct journal provenance or hashes. Explicit
lower-level whole-page synthesis still requires the complete current page/hash.

The display application exposes only a signed dedicated display device's fixed
household list/upcoming-event snapshot and active explicit publication content.
Publication needs a fresh trusted human grant, current exact scoped output and
byte hash; diagnostics/financial data are not eligible through root grants.
The projection uses application-owned `display_publications` references and the
existing immutable household artifact copy, with no duplicate content store.
Readonly handset views similarly call fixed owning-domain read methods, require
current profile/grant/scope/device authorization, and need no active native run.
Contact source access is derived from current ContactsService authorization.

`prepare-slice3.py` produces protected candidate files only. It reuses existing
grants/helper profiles, accepts explicit private identity/channel rules, derives
agent wiki vault paths from the installed native normalization, and uses the
managed document Python environment for report renderers. Installed 2026.9.8
primary schemas verify `agents.defaults.contextInjection: never` and
`startupContext.enabled: false`, which suppress named workspace/bootstrap and
startup daily-memory injection even when the plugin is absent; original
workspace files remain untouched. Selected plugin context operates separately.
Family native tool allowlists enumerate household contracts and safe native
orchestration/search, excluding raw host/provider/history tools and the
child-only output publisher. Workshop autonomous mode is off, native dreaming
and heartbeat are off, and active-memory injection is disabled.

Cron dispatch remains disabled by default. Explicit scheduling activation
requires a complete protected inventory with zero enabled historical jobs, after
official native owner reconciliation has disabled/removed its automatic jobs.
No direct native scheduler database edits are used. Admitted future jobs retain
their exact trusted tool snapshot and config revision, intersected with current
actor/private/shared grants; fresh-human-only operations cannot be granted by
that snapshot. Repeated observations of one immutable Discord message do not
create new human authority. Existing goal-aware run reconciliation, not stale
agent-end events, settles successor runs. These source additions require the
same consolidated Ubuntu acceptance campaign; source preparation is not a pass.


## November 4 ordinary interface refinements

Clear card scans and ordinary later-human corrections may use authorized domain tools without a forced native goal. Goals remain appropriate for genuine waiting, restart or larger staged work. An original goal-based stress case and a natural ordinary-card case are separate acceptance evidence.

Contacts can derive proposed fields from validated observation field/value pairs when the separate fields object is omitted. Explicit fields, including an empty object, remain authoritative. An observations-only OCR redo patches the observed fields while preserving untouched fields/evidence; manual corrections still require an explicit patch or replacement. The owner resolves omitted observation source IDs only from a unique authorized, hash-verified extraction with the exact supporting quote; wrong or ambiguous references are not repaired. This removes duplicate field and identifier bookkeeping while retaining original sources and first-save/later-human revision policy.

Memory content writes require the trusted conversation audience for their target scope. A private source cannot create household sources, topic prose or journal entries simply because its actor may read household memory. Content-free compilation and currently approved forgetting are separate. See [managed memory](memory.md) for the exact V1 boundary and unsupported cross-audience publication.
