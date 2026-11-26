---
name: household-receipts
description: Reason through Uplift receipts with composable source, evidence, project, candidate, validation, review and report tools; accept clear receipts and expose unresolved cases without a fixed parsing pipeline.
metadata: {"openclaw":{"emoji":"🧾"}}
---

# Uplift receipt reasoning

Main owns interpretation and planning. Compose currently authorized
`household_receipts_*` tools and local documents tools as the actual receipt
requires. There is no mandatory legacy script sequence, vendor parser or fixed
phrase catalog. Read source/extraction, inspect evidence and current project
context, calculate, revise, validate, accept or clarify as needed. Reuse stored
evidence and candidates instead of performing a blind reprocess.

Uplift's financial ledger/vault owns originals, evidence, revisions, accepted
decisions and current financial rows. The native task owns execution and follow-
up. Processing means source analysis completed and a candidate or visible
failure/review outcome exists; provisional means saved but not accepted;
accepted means the current policy checks and transactional acceptance committed.
Never describe OCR success, a balanced guess or a review reply as acceptance.

Retain local original/extraction references and exact evidence quotes. Model
reasoning is evidence kind reasoning, not OCR or a user assertion. Critical
vendor/date/currency/amount and allocations need their applicable grounded
evidence. Money is signed integer minor units with currency; preserve null for
missing costs. Generic grounded calculations can sum, subtract or multiply an
actual quantity and unit cost. Never invent a balancing item, round away a
reconciliation gap or substitute zero. Ambiguous currency/date, project intent,
duplicates and failed reconciliation belong in the visible review view.

Choose only active projects returned by the currently granted catalog and its
context; a catalog entry grants no authority. With no configured projects or
grants, leave the receipt provisional and request the missing operator setup.
Do not invent real project names/codes or reuse another project's grant.

For semantic normalization of vendor/date/currency/transaction reference, an
evidence reference may include `interpretation:{value,rationale,ambiguity}`.
Its value must equal the normalized candidate field, its exact quote must exist
in a source owned by this receipt, and ambiguity must remain explicit. This
supports spelled dates and other source meaning without a new format parser.
Do not use interpretation to ground an amount or invent a currency from an
ambiguous symbol. Numeric monetary values/calculations retain their own checks.

Candidate save returns current validation. When clear, request acceptance
directly; a separate validate call is optional inspection, not a required step.
Automatically accept a clear supported receipt when all current checks pass.
Only claim itemized verification when real source-supported detail reconciles;
a grounded printed total can support the summary profile without pretending to
have itemization. Corrections append a revision; a failed optional redo leaves
an earlier accepted revision intact. A source-supported dispute is a separate
operation that withholds the disputed amount from final accepted totals.

A review reply is an ordinary human prompt. Bind it to the actual receipt,
review and current revision; preserve the quote as user evidence, reason through
it, and ask a linked follow-up if still uncertain. Do not limit replies to menu
choices. `record_user_statement` can carry a normalized `clarification` with
field interpretations or distinct receipt IDs, rationale and ambiguity when the
current reply is bound to that exact receipt/revision. Use it for the user's
meaning, not a fabricated new assertion; all referenced receipts must be visible
and project grants remain enforced. Uncertain clarification stays unresolved.
An arithmetic/detail business exception additionally requires a trusted
explicit signed approval naming the receipt, revision, waived reasons and
rationale. Request the native approval question when needed. Tool text, model
confidence and a generic affirmative cannot create this grant. Identity, source,
authorization, critical values, currency, duplicate and revision gates cannot be
waived. An approved exception stays visibly unverified and is withheld from
verified itemized reports.

Generate private JSON, CSV, PDF or XLSX reports from the canonical report tool.
Final totals use current accepted revisions; draft provisional totals stay
separate. Preserve warnings, withheld/disputed rows and separate currencies.
Use the returned private artifact reference, never republish full financial
rows to a kitchen screen. For an unknown write, inspect its durable effect/
operation receipt and current revision before recovery.
