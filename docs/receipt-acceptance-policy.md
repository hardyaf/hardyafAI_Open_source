# Receipt reasoning and acceptance policy

Updated November 3, 2026.

Status: agreed product direction. Slice 2 deployed the integrated Uplift data/validation/acceptance/review/report primitives; agent reasoning, review conversation and functional acceptance remain Slice 3/final-campaign work. No existing financial data were migrated. The donor scripts remain legacy reference and do not acquire these guarantees; see [Slice 2 evidence](slice-2-domain-capabilities.md).

## Reasoning-led execution

Main owns receipt interpretation and bounded planning. Give it authorized project/account context, source evidence and composable tools. It chooses what to inspect, which extraction to use, what to calculate, what additional context to retrieve, whether a candidate needs revision, and when it can accept or must ask.

Reuse Uplift's existing scripts and functions as individual capabilities and reference implementations. The mandatory orchestration is not the existing pipeline order. A new vendor, layout, wording or combination of existing operations should not require a new workflow branch or intent.

The useful surface includes source/receipt lookup, bounded source reads, local OCR, project catalog/context retrieval, duplicate candidates, calculation/analysis, versioned candidate submission, validation, accepted-state commitment, review lookup/response and report generation. Expose schemas, provenance and useful errors. Keep raw database access, provider credentials and unrestricted filesystem paths behind their owning adapters.

Jarvis may write and execute short Python programs to inspect evidence, normalize data, reconcile amounts or build a review visual. Programs use task-scoped artifacts and approved capabilities. They do not silently edit the authoritative ledger.

Existing parser output is one observation the model may use. The model can revisit source evidence and produce a better grounded candidate. Deterministic code enforces current identity/resource grants, schema, supported monetary arithmetic, revisions, idempotency, policy gates, transactions and receipts. Semantic interpretation remains Main's judgment; the gates check its structured evidence and deterministic conditions rather than replacing interpretation with vendor-specific rules. Model confidence or a persuasive explanation alone cannot grant acceptance.

Local OCR remains the default. Cloud processing is available only under an approved exception. Reasoning may choose among permitted approaches; it cannot broaden data access or processing permissions.

## Meaning of the states

Processing progress belongs to an attempt; financial acceptance belongs to a persisted receipt revision. These are separate dimensions. A human-review wait is not a failed execution or a reason for a worker to retry forever.

| Label | Precise meaning | Treatment in reports |
| --- | --- | --- |
| Received | Original source and intake receipt are durably saved. Extraction may not have run. | Listed as pending; excluded from accepted totals. |
| Processing | An owned job/agent phase is extracting, interpreting or checking the source. | Pending with visible progress. |
| Processed | The extraction/interpretation/checking attempt completed and its candidate, evidence and outcomes were saved. This is a processing outcome, not financial approval. | Also show its acceptance state. |
| Provisional | Saved candidate has an unresolved blocking issue or awaits a required business choice. | Excluded from accepted totals; visible in review/draft output. |
| Accepted | A specific persisted revision passed its declared acceptance profile automatically, or passed after an authorized review decision. Store the policy version, evidence and accepting actor. | Included at its verified reporting level. |
| Excluded | Confirmed duplicate, non-receipt, out-of-scope or deliberately excluded record, with reason and retained source. | Excluded from expense totals; disclosed in the intake/review summary. |
| Superseded | A prior revision was replaced by a committed correction. | Preserved for history, never counted again as a current receipt. |
| Processing failed | Execution could not complete because of a tool, integration or resource failure. Retain its source and error class. | Report the failure explicitly; never label it accepted. |

A failed optional OCR redo leaves the previously accepted revision intact. Only substantive new evidence of a blocking dispute opens review of that revision; an execution failure alone does not invalidate it.

“Reviewed” records an action/decision; opening an image or review page does not accept a receipt. Folder names, job success, parser document classification and arithmetic match flags do not imply acceptance.

Accepted means usable for the declared internal Uplift report/profile. It does not mean paid, reimbursed, tax-approved or matched to a bank transaction. Record bank reconciliation separately if that integration is later implemented.

## Automatic acceptance

Jarvis should resolve an issue autonomously using permitted evidence and calculations before involving the owner when that is practical. Automatically accept when all required checks pass; do not add mandatory review for every receipt.

The acceptance gate requires:

1. A committed immutable source, stable intake/receipt identity and traceable current candidate revision.
2. Supported document type, legible or transparently derived critical fields, clear currency/date meaning and source references for the monetary values.
3. A valid authorized project allocation supported by the user's instruction, an agreed rule, or unambiguous reasoning from authorized project context and source evidence. A project hint or model guess is insufficient; retain the rationale and references.
4. No unresolved duplicate, contradictory critical value or material unsupported assumption.
5. Reconciliation under an explicit versioned monetary rule, using decimal/minor-unit arithmetic and source-supported subtotal, tax, fees, tip, shipping, discounts and refunds as applicable.
6. No unexplained residual or fabricated balancing line. A derived value must have a real formula and source inputs; inventing an “Unclassified Balance” to force equality is not evidence.
7. Completeness for the declared report profile, with no unresolved blocking review reason, followed by atomic commit and readback.

Reconcile at the currency's supported precision. An explicit printed rounding adjustment can be represented; an unexplained difference enters review. Do not silently inherit the legacy floating-point tolerance as the new policy or relax tolerance to make a receipt pass.

Source-grounded receipt-summary acceptance and verified itemized-cost acceptance can have different completeness requirements. Declare the profile. An accepted summary must not manufacture missing line items or appear in an itemized report as verified detail. Missing values remain missing; zero is a real value only when supported by the source.

A clear initial candidate can go directly from processing to accepted. A parser issue that the model resolves with better evidence can be cleared through validation without another approval. Preserve the original observation and the evidence for the resolution. Unresolved amounts, projects, duplicate identity or reconciliation stay provisional.

## Visible review

The review queue is a query/view of durable open exceptions in Uplift's authority, not a second background job queue or a receipt database in Jarvis.

A review item identifies the receipt and revision, relevant source image/text, proposed values, blocking reasons, evidence, changes attempted and the smallest remaining question. Group related issues rather than producing repeated notifications. Notify the appropriate authorized user on a meaningful new issue or requested review; do not repeatedly announce unchanged waiting items.

Typical unresolved issues include an unreadable or conflicting amount, unknown project, multiple plausible project allocations, unexplained total difference, synthetic balance, missing required detail, possible duplicate, unsupported refund/invoice interpretation, or uncertain currency/date.

Replies are ordinary prompts tied to the review case and current revision. They may supply a project, correct a value, split costs with explicit allocations, ask for another OCR pass, explain a refund, exclude a duplicate, or request broader permitted analysis. Do not restrict them to approve/reject commands.

After a correction, create a candidate revision and rerun the applicable checks. Closing a review ticket or receiving a generic acknowledgment is not itself acceptance. An explicit authorized exception must identify what was overridden and why, preserve the warning/verification level, and cannot be inferred from an ambiguous reply. Business exceptions cannot bypass identity, grants, source identity, revision/idempotency checks or atomic commitment. A waived arithmetic issue remains visibly unverified; it cannot be relabeled a verified match.

## Corrections, replay and reports

Preserve originals, extraction results, accepted revisions and user corrections. Reprocessing produces a new candidate; it must not delete and recreate current accepted financial rows or overwrite corrected values blindly. Link any proposed change to its prior revision.

Exact intake replay returns the existing receipt/result. An alternate photograph of the same transaction may be a duplicate candidate; similarity alone cannot delete it or post a second expense. Preserve all source references and resolve identity before acceptance.

Commit acceptance, its current-revision pointer, financial projection and receipt transactionally in Uplift. After an uncertain response or restart, read that operation before trying it again. Only one current accepted revision contributes to totals.

Final reports use current accepted revisions at their supported profile. Show provisional/excluded/failed counts separately; provisional monetary values and unknown values must not be folded into accepted totals. Group currencies separately unless an explicitly authorized conversion policy is present.

Draft reports may include provisional rows when clearly labeled and separately totaled. A new blocking correction affecting an included accepted revision must be visible; return draft/review status until resolved rather than silently finalizing a disputed result. Do not substitute zero for a missing price.

No receipt classification or acceptance silently changes Gmail read state, sends a reimbursement, uploads to a third party or publishes private financial data on the kitchen screen.

## Existing implementation gaps

The donor Uplift entry points have the following gaps. The integrated Slice 2 authority avoids those entry points and implements new gated primitives; the complete reasoning-led workflow is still unaccepted:

- The parser can add a synthetic “Unclassified Balance” and then report arithmetic match.
- Parser document_status and CLI accepted counts classify non-rejected documents even when quality issues exist.
- Financial rows are written before the quality disposition is finalized.
- Project hints can derive codes from a subject without confirming a known project assignment.
- Reprocessing deletes/replaces transactions and line items.
- Parsing a new vendor can write shared store-profile configuration as a hidden side effect. Isolate that write from extraction: use per-task parsing settings, or expose publication of shared rules as a separate declared/versioned operation under its own grant.
- Project reports read project rows without this acceptance filter and can treat missing costs as zero.
- Moving originals to a processed folder happens independently of receipt acceptance.

Keep those observations and functions as useful components, but expose them through the reasoning/evidence interface with their real semantics. Do not map a legacy flag directly to the new accepted state. Existing records start unverified/provisional for this policy unless their evidence passes a deliberate versioned backfill check.

## Implementation and acceptance

Reuse Uplift's SQLite/migration/transaction authority for acceptance revisions, exceptions and financial projections. Reuse OpenClaw for agent reasoning, jobs, continuation and task artifacts. Jarvis stores receipt/job references and display projections rather than a second financial ledger.

Implement typed primitives and a reusable receipt skill as part of the full household build. Exercise unfamiliar inputs during the consolidated functionality campaign after all build slices, without adding a new vendor/request workflow. Between slices, check deployment/startup and structural readiness only. The model should demonstrably inspect, reason, calculate, revise and verify over those operations.

Required fixtures include a clear auto-accepted receipt; an OCR error resolved autonomously from its image; missing/ambiguous amounts; grounded project resolution from context; unresolved/conflicting projects; arithmetic mismatch; a synthetic balanced “match”; exact replay and alternate-scan duplicate; refund/credit; valid zero versus missing price; corrected revision followed by redo; a failed optional redo preserving the existing accepted revision; an explicit business exception retaining structural checks and visible uncertainty; multi-currency display; accepted-only versus draft totals; a review reply after reconnect; and interruption during acceptance with no duplicate posting.

A matching total alone must not rescue a synthetic or unsupported candidate. A useful acceptance record shows both the agent's evidence/decisions and the deterministic committed outcome.

Use additive migration and a protected consistent backup. Retain originals and prior accepted revisions. Until legacy entry points honor the revision/acceptance boundary, do not invoke their destructive reprocessing or unfiltered final-report path against the integrated authoritative ledger. Rollback must preserve accepted decisions and prevent old readers from treating provisional data as accepted.

## References

- [Living design](household-assistant-design.md#uplift-receipts-integration)
- [Implementation plan](household-assistant-implementation-plan.md)
- [Design decisions](design-decisions.md)
- [Source map](design-source-map.md#uplift-receipt-workflow)
