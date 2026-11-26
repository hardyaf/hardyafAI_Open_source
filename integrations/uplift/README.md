# Uplift receipt authority bridge

Implemented acceptance policy 2 supports source-linked semantic interpretation,
current human clarification, and private PDF/XLSX projections while retaining
storage schema 1. Nonmonetary interpretation uses an exact source quote plus a
normalized value, rationale and explicit ambiguity; see
[source linked interpretation](#source-linked-interpretation) and the owning
[validation contract](uplift_finance_bridge/validation.py). Numeric reconciliation,
project permissions, revision checks and atomic acceptance remain enforced.

Component checks have run; model-led receipt workflows remain unaccepted. See
[current status](../../docs/current-status.md) for the actual check results and
functional campaign status, and [domain boundaries](../../docs/SLICE-3-DOMAIN-BOUNDARIES.md)
for source lifecycle, report ownership and explicit limitations.

This package owns receipt financial state **inside the configured Uplift
SQLite ledger and immutable vault**. The household database contains no
financial rows. OpenClaw owns reasoning, task execution, scheduling and
continuation; this package exposes composable primitives, not a fixed parser
or processing pipeline.

## Reuse and adaptation

The donor Uplift `ledger.connect` pattern and `ingest_documents` shape from
`sql/schema.sql` were inspected and individually adapted. No donor financial
data, originals, secrets, store profiles, mailbox state or runtime database was
copied. Existing `ingest_documents` rows remain intact. Existing legacy
transactions/receipt rows are not deleted, rewritten or presumed accepted.

The former `replace_transactions`, `replace_receipt_details`, parser side
effects, cloud OCR, mailbox intake and unfiltered legacy reports are not called.
The new additive `uplift_*` tables are the selected Uplift acceptance/revision
boundary, not a parallel Jarvis financial store. When pointing this package at
an existing Uplift ledger, back it up consistently first. Legacy acceptance
backfill is an explicit future operation; schema initialization does not do it.

| Datum | Authoritative owner | Lifecycle |
| --- | --- | --- |
| Original bytes/content hash | Uplift vault plus existing ingest identity | Immutable hash-named private file; verified on intake/source read/acceptance. Alternate-source replay never overwrites originals. |
| Evidence and candidate | Uplift evidence/revision tables | Immutable content/provenance and CAS parent revision. Corrections append; no destructive reprocessing. |
| Accepted decision | Uplift acceptance history | Policy/profile/actor/evidence retained, including visibly unverified explicit business exceptions. |
| Current financial rows | Uplift financial projection and receipt accepted pointer | Transactionally replaced after acceptance; prior accepted revisions are superseded but preserved. Exclusion removes only the current projection. |
| Review | Uplift durable exceptions view/responses | Open reasons bind to a revision; normal replies remain prompts and never imply acceptance. No worker/queue is created. |
| Processing | Native task with Uplift attempt-event references | Processing/processed/failed is independent of acceptance. Failed optional redo leaves an accepted revision intact. |
| JSON/CSV/PDF/XLSX report | Projection of current accepted Uplift revisions | Explicit draft mode keeps provisional totals separate. No zero substitution, implicit currency conversion or unverified itemized claims. |

## Transport and deployment

Requirements: Python 3.11+ and its standard library for financial operations and
JSON/CSV reports. PDF/XLSX projections use the maintained pinned ReportLab and
openpyxl packages in `requirements.txt`, reused through the managed document
Python environment. They never invoke cloud OCR. Build/runtime checks execute
on Ubuntu; missing optional renderers return a typed unavailable result.

From this directory, with trusted protected absolute paths set:

```bash
python3 -m uplift_finance_bridge --init
python3 -m uplift_finance_bridge --readiness
python3 -m uplift_finance_bridge --describe
```

`UPLIFT_DATABASE` selects the single Uplift financial database;
`UPLIFT_VAULT_ROOT` selects its private immutable originals root. Do not point
either at the household application database or an arbitrary client path.
Use owner-private directories and files; the bridge rejects symlinks/hardlinks
for authoritative files and unsafe group/other permissions. Root composition
owns process lifecycle, timeout, cancellation and resource/output limits.
Initialization rejects a nonempty unrelated database rather than adding
financial tables to another application's authority.

The first two commands initialize/reopen schema and report structural readiness;
they invoke no model, OCR, mailbox, financial intake or provider. Initialization
is additive schema version 1 and does not create a project catalog/grant. An
empty catalog reports `projectCatalogConfigured: false`.

Normal invocation reads one JSON request, at most 36 MiB:

```json
{
  "version": 1,
  "operation": "candidate.save",
  "operationId": "stable-central-effect-id",
  "context": {
    "actorId": "authorized-person",
    "projectCodes": ["granted-project"],
    "canManageProjects": false,
    "canReview": true
  },
  "params": {
    "receiptId": "receipt-reference",
    "expectedRevision": 0,
    "candidate": {"documentType": "receipt", "profile": "summary"}
  }
}
```

The caller constructs `context` from current verified identity/resource policy;
the model cannot supply it. Writes require a stable `operationId`. A repeated
actor/id/request returns the committed receipt; changed input conflicts.
Current receipt/project grants are rechecked, including operation readback.
Read operations do not take a packet-level operation ID. `operation.get`
takes the target ID inside `params`.

The process returns `{version:1,ok:true,result:...}` or
`{version:1,ok:false,error:{code,status}}` and exits nonzero on errors. Errors
contain no raw exceptions, input text, paths or credentials. Responses are
bounded to 4 MiB. Give the child a minimal explicit environment containing only
its path/locale/runtime and Uplift configuration, never Gateway/BWS tokens.

`operations.json` is the typed tool catalog. It marks effects as read/write and
marks `evidence.record` **internal**. The native plugin/household dispatcher
must omit internal operations and recheck trusted context on every invocation.

The public `source.intake` input is `{artifactId}`. The trusted adapter resolves
that artifact under its original owner/conversation/task/audience, then injects
`params.source = {artifactId,contentBase64,sha256,filename,mimeType}`. Raw source
paths and arbitrary bytes are not public tool inputs. Accepted source formats
are PNG/JPEG/WebP/PDF, at most 25 MiB, checked by signature and content hash.

## Evidence and acceptance

`evidence.add` records reasoning only. To save real extraction, the trusted
adapter calls internal `evidence.record` with
`context.evidenceOrigin = {kind,sourceRef,sourceSha256?,facts?}`. Allowed trusted
kinds are `local_ocr`, `user_statement`, `project_context` and `standing_rule`.
The context must come from the extraction/user/rule authority, not model input.
OCR requires the exact receipt source hash and cannot provide asserted facts.
Project context requires the current granted catalog revision and exact text.
User/rule structured facts are restricted to receipt fields, project binding,
explicit duplicate distinction or a specific business-exception approval.

Candidates refer to committed evidence IDs and exact quotes. Critical fields
need source/user/rule evidence. Agent reasoning alone cannot become truth.
ISO currency meaning and date interpretation must be clear; ambiguous dates
remain provisional unless authorized evidence disambiguates them. Supported
currency precisions are explicit in `validation.py`; unsupported currencies
remain visible and unaccepted.

Money is signed integer minor units, never binary floating point. Summary
acceptance can use a grounded printed total (`source_total_only`), or reconcile
its source subtotal/adjustments. Itemized verification additionally requires
source-supported amounts, exact item/subtotal/adjustment agreement and real
detail. Missing costs remain null. Generic sum/difference/quantity calculations
require grounded inputs and exact results; no invented balance category exists.
Known synthetic balancing observations cannot be accepted as verified evidence.

Project allocations must refer to active currently granted projects and carry
explicit user/rule binding or rationale grounded in current project context
and source evidence. Allocated minor units must sum exactly to the receipt.
The catalog is not an authorization authority: managing it never grants access.

`candidate.save` appends a provisional revision and validation/review results;
`candidate.accept` recomputes current checks under an immediate transaction and
commits acceptance/history/current projection/idempotent result together, with
readback. This separation lets Main reason and compose without forcing legacy
pipeline order or adding mandatory review to clear receipts.

Alternate scans with the same vendor/date/currency/total require an explicit
identity resolution. Distinct grounded transaction references or a specific
trusted user decision can settle them. Similarity does not delete a source,
merge records or authorize another accepted expense.

An optional business exception requires `canReview` plus a committed
`user_statement` whose trusted `facts.approvedException` exactly matches
`{receiptId,revision,waivedReasons,reason}`. Only declared arithmetic/detail
reasons can be waived; identity, source, grants, critical values, currency,
revision and duplicate gates cannot. The result is `unverified_exception`,
with retained warnings; itemized verified reports withhold it. The model cannot
turn its own confidence into such a record.

An explicit source-supported dispute preserves the prior acceptance but forces
review status and withholds the disputed amount from final accepted totals.
A failed redo alone does not create that dispute. Acceptance of a new revision
resolves previous open review rows; a review reply alone changes no amount or
acceptance pointer. Exception response text remains an ordinary continuation
prompt for the agent in Slice 3.

## Checks, debt and rollback

The package includes executed contract tests for transactional replay, stale
revisions, source identity, synthetic balance rejection, evidence trust, revoked
project grants, failed redo preservation, alternate scans, missing prices and
review binding. The original Slice 2 checkpoint deferred functionality; the later
component campaign ran it. See current status for the measured suite total.
These checks do not accept a model-led receipt workflow or live financial data.

PDF/XLSX rendering and private native output publication are implemented behind
the same report operation. The domain-owned receipt skill composes source,
evidence, project, candidate, validation, review and report tools. Later human
quotes are grounded by the trusted household bridge; explicit exception facts
require a root-verified signed approval binding for the current target/revision.
These source behaviors remain subject to the consolidated acceptance campaign.
Unsafe legacy report entry points remain disconnected. No live financial data or
real project configuration has been migrated.

There is no deletion/purge or destructive reprocess endpoint. Retention/forget
must use an explicit owned financial policy and preserve required accepted
history. A partial/orphan immutable object after a failed intake is not a receipt
and never grants acceptance; surface storage/hash errors for operator recovery.

Disable the bridge at the composition boundary to roll back availability.
Keep the Uplift database/vault backup and subsequent accepted state. Do not run
old destructive writers or unfiltered report readers against the integrated
authority. Do not downgrade/drop additive tables or restore an old database
over newer accepted work. Code rollback must preserve the financial decision
history; a separate deliberate migration is needed to export/backfill legacy
records.

## Source linked interpretation

Acceptance policy version 2 keeps storage schema 1 and adds an optional
`interpretation` to existing evidence references: normalized string `value`,
semantic `rationale`, and `ambiguity` (`clear` or `uncertain`). This path supports
non-monetary vendor/date/currency/transaction-reference normalization when the
exact quote exists in trusted receipt source evidence. It cannot ground numeric
money or override a contradictory explicit currency code. Candidate JSON retains
the interpretation, and validation reports which fields used it. Existing
references remain valid; no new evidence ledger or processing queue exists.

Current focused human replies can supply normalized clarification fields and
distinct-receipt interpretations through the application bridge. The bridge
binds the actual human source, exact quote and current receipt revision; checks
all referenced receipt/project permissions; and retains uncertainty. It cannot
manufacture another speaker or an exception approval. Financial exceptions still
require their separate exact signed approval. Save already returns validation;
acceptance always revalidates transactionally, so an extra validate call is
optional.
