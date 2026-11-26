# Managed household memory

Updated November 4, 2026. This describes the managed memory implementation and
its boundaries. [Current status](current-status.md) owns deployment, model and
acceptance evidence. Passing source/lifecycle contracts does not establish that
natural conversation reliably captures, recalls, corrects or forgets knowledge.

## Sources and projections

| Data | Authority and purpose |
| --- | --- |
| Captured statements | Immutable scoped Markdown under the configured agent's `memory/household-sources/` tree. Each source keeps quotation, origin, certainty, date and authenticated provenance. |
| Topic pages and daily journals | Native memory-wiki syntheses in the managed `syntheses/household-topic-*.md` namespace, with source-linked claims and visible candidates. |
| Recipes | Canonical recipe references in `syntheses/household-recipe-*.md` in the same native vaults. Imported recipes record the original scoped note ID and body digest. |
| Search, compiled pages and embeddings | Existing native compiler/index projections. They are rebuildable and do not become another editable fact store. |
| Correction, forgetting and recovery metadata | Content-free retirement markers and lifecycle receipts beside the existing sources. These track effects and projection recovery, not a second memory database or queue. |
| Conversation/task state | Native sessions plus existing task checkpoints. Requests, responses and task summaries are not automatically independent evidence for household facts. |

Contacts owns exact Rolodex identifiers and the list domain owns list items.
Wiki pages may link to those authorities without creating competing copies.

## Ordinary automatic capture

Main identifies useful lasting human-shared knowledge, selects a topic within
the authenticated source audience, and distinguishes a clear fact from inference
or uncertainty.
The `household_memory_remember` operation accepts an exact current source quote
and interpreted claims. The domain attaches authenticated source references,
preserves prior topic claims and body content, appends the daily journal using
the configured household timezone, and checks native readback. It returns compact
receipts; Main need not copy source IDs or reconstruct page/hash state for an
ordinary capture.

A confirmed source establishes what the authenticated human said. A normalized
claim can use different wording with an exact supporting evidence quotation.
Code checks source identity, scope, quote existence and revisions; Main remains
responsible for faithful meaning. An unrelated quotation or model confidence
does not prove an interpretation. Inference and uncertainty remain candidates.
Mail, web pages and OCR observations retain their origin and cannot become
instructions or acquire human authority merely by being indexed.

The thematic page and journal are projections of the same source. A journal
records what was shared or requested; a request does not prove its action was
delivered. Secrets, credentials, trivial exchanges and disposable tool chatter
are excluded. Ordinary capture requires no separate native goal, transcript
processor or background diary service.

Lower-level source navigation, synthesis and annotation remain available for
deliberate curation and rebuilds. Explicit whole-page synthesis still requires
the complete managed page and its current hash. Read bounds, serialization and
preimage checks prevent unsafe blind replacement, but do not provide native
atomic cross-writer CAS. Concurrent updates to the shared corpus remain an
acceptance concern; additional writers must not be assumed safe from a unit test.

## Bounded page growth

The remember facade keeps each generated topic/journal body within 20,000
characters and 350 lines. When another entry does not fit, the same native wiki
owner creates a deterministic continuation part. A single large capture can span
parts; original source/claim metadata remains intact and every part is indexed
by the existing native compiler. The compact receipt identifies the root and the
parts containing this source. Main does not choose filenames, measure journals
or maintain a rollover ledger.

Continuation discovery is derived from the managed native filenames. Source and
claim markers identify already committed parts after an interruption; the same
operation completes missing topic/journal projections without duplicating those
entries. Existing attributed pruning handles a source across every part, so a
correction or forgetting operation preserves unrelated entries. Root pages and
human notes are not rewritten merely to add a navigation pointer. Native search
and the returned lookups expose continuation content. Whole-page manual synthesis
retains its explicit size/readback bounds.

These are implemented source contracts; deployment and executed acceptance remain
owned by current status. The adapter serializes its own operations and checks
preimages, while external concurrent native writers still lack atomic CAS.

## Private and shared knowledge

Personal scope resolves to the admitted agent's configured workspace and vault.
Household scope resolves only to the configured neutral household knowledge
agent. It never falls through to a private corpus. Content writes are pinned to
the authenticated source audience: private conversations write personal memory;
shared household conversations write household memory. The memory owner enforces
this before source, topic, journal or native-provider changes for remember,
source_save, source_supersede, synthesize and annotate, including candidate data.
An `allowedScopes` grant permits access; it does not authorize publication of a
private source. Model-selected scope, claimed sharing flags and quotation
grounding cannot broaden that audience.

The current contract has no explicit private-to-household memory publication
grant. Such writes return `memory_shared_write_requires_shared_conversation`
with a not-sent outcome; V1 household capture requires an actual shared
conversation. A private-conversation publication workflow remains deferred.
Existing authorized household reads, content-free compilation and scoped
forgetting under current destructive approval remain available. Shared sources
cannot read or write a personal corpus. Current identity and resource policy
still apply, and sharing one fact does not publish unrelated conversation history.

Managed recall searches and reads the selected wiki corpus and its managed topic and recipe
paths. It has no broad transcript, unmanaged-page or private-store fallback.
Facts mentioned once have an explicit capture path; frequency-based dreaming is
not required to retain something important.

The household configuration generated by Slice 3 disables competing automatic
producers: named workspace bootstrap/daily startup injection, Active Memory,
dreaming and automatic transcript recall. Historical workspace files may remain
as reference material, but their old routing instructions are not the current
managed-memory contract. The selected skill and typed application boundary own
current execution. See [native integration](NATIVE-TASK-HOOKS-AND-ANALYSIS.md)
and the [memory skill](../skills/household-memory/SKILL.md).

## Recipe references

The memory domain reuses the existing native wiki writer, scoped Knowledge
readers, effect receipts, compiler and SQLite snapshot. An explicit save in an
authenticated conversation creates one recipe page from a title, alternate names,
ingredients and optional steps. Recipes are reference material. Lookup metadata
uses candidate claims so it carries no confirmed household-fact status.

Importing a legacy reference note requires current access to Lists and Knowledge
in the same audience. The existing capture owner reads exactly one dated note
by ID. Knowledge preserves its body, stores the source ID and hash, and becomes
the owner of the recipe. The old note remains as a historical source. Repeating
the same save reuses the page. A conflicting title needs a new name or version.
No transcript content is imported. Recipe pages do not use the fact source's
correction and forgetting lifecycle.

Native compile refreshes the SQLite snapshot on save. Search accepts a recipe
filter and short title, alternate name or ingredient queries. The pinned native
wiki uses its compiled digest to shortlist candidate Markdown pages and can
fall back to file reads when the shortlist is too small. Returned results are
bounded. The filter is applied to those results and does not enumerate the full
recipe collection. Hardy Home's existing Knowledge view reads the same pages.

## Correction and forgetting

A later verified human correction can supersede an exact source under its
fingerprint. The original retires into explicit non-indexed history, and the
replacement retains its new human provenance. A same-turn model reinterpretation
cannot impersonate a later correction.

After successful supersession, `household_memory_remember` can reuse the returned
replacementSourceId through its optional sourceId input and maintain both topic
and daily journal. Reuse requires an active confirmed source in the same scope,
its exact sourceQuote and the same current authenticated human references. It
does not capture a duplicate source or admit an older human statement as current.

Source retirement prunes fully attributed remembered entries, their claims and
source references while preserving unrelated topic and daily-journal entries.
The adapter preserves their certainty and native metadata. The native compiler's
exact marker-bounded Related link projection is recognized as mechanical and
preserved during pruning unless a retired-source link requires dropping that
mechanical projection before native regeneration. Human Notes remain opaque. Opaque legacy prose,
review annotations or human notes cannot always be attributed safely; those
dependent pages retain conservative invalidation with explicit rebuild-required
receipts. Main curates the replacement fact and rebuilds only the affected opaque
pages from surviving authorized evidence. It must not claim unrelated content
was preserved when the receipt reports invalidation.

Forgetting requires current scoped destructive approval and the exact captured
source/fingerprint. It removes that active source, its owned correction history
and attributable live wiki content, then refreshes native projections. This is
scoped live-memory forgetting. Original conversation/task artifacts, unmanaged
or untracked copies and external backups remain outside the promise. Native
session-lineage forgetting is a separate operator action; it does not establish
that arbitrary wiki files disappeared.

Pending lifecycle receipts are durable before retirement or projection effects.
They retain opaque page references rather than fact text or topic titles.
Interrupted projection refresh remains visible and blocks stale managed recall.
The owner lifecycle supports idempotent reentry using the same authorized
operation and recorded markers. A transport effect marked unknown still requires
owner reconciliation before reentry; it must not be blindly retried. Actual
restart recovery remains unaccepted. Cancellation does not reverse committed
effects. A failed or partial refresh is not successful forgetting, and an old
operation cannot resurrect a retired source.

## Recovery and historical evidence

Backups cover source Markdown, native wiki state and the existing lifecycle
metadata. Roll back source/skill/configuration together while retaining facts,
corrections and receipts created afterward. Restore into isolated copies for
verification; replacing live state with an older backup would discard new work.
Indexes can be rebuilt from their authorities without introducing another store.

The October 4, 2026 baseline used daily memory files and native recall tiers,
including Adult's escalation-based Active Memory. Those settings are historical
and are not instructions to reactivate competing producers. During an indexing
measurement, Ollama reported approximately 12 GB for GPT-OSS and 11 GB for the
8B embedder, with 23,061 MiB of 24,576 MiB GPU memory in use. That observation is
historical, not a capacity guarantee for current model/provider settings.
See the [baseline](baseline.md) and [acceptance history](acceptance.md); current
model selection and workflow limits belong to current status.
