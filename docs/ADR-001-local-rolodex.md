# Local Rolodex authority

Date: November 3, 2026.

Status: accepted decision; Contacts data/tool implementation deployed in Slice 2. Agent/UI behavior and functional acceptance remain deferred. See [implementation/evidence](slice-2-domain-capabilities.md).

## Context

Historical Jarvis/HardyAI could extract business-card fields, retain evidence, accept conversational corrections and form contact proposals. It deliberately had no canonical mutable contact directory. Calendar aliases and authenticated identity bindings are not contact records.

The owner selected a local Rolodex before Google Contacts synchronization, shared with the household by default. Every submitted card should save and produce a save report. Later changes require a user prompt, which can ask for redo OCR or any other permitted interpretation; the interaction is not a fixed correction form.

## Decision

Create one local Contacts domain as the authoritative directory for saved contact records and accepted field revisions. Reuse the existing application SQLite connection/transaction/migration mechanism and the provider-neutral ContactProvider search/upsert semantics. Do not add tables to vendor-owned OpenClaw databases, make wiki pages the address book, or restart the retired native runtime.

The domain owns contact policies, revisions, search contracts and receipts. Transport handlers call it through a narrow interface. Composition constructs the storage/provider adapters. Implementing it is new because the prior provider was intentionally absent; extraction alone cannot supply this authority.

The document/artifact boundary owns original card bytes and intake identity. A durable card/source record must be committed even when extraction produces zero readable fields. Contact fields can be sparse; do not invent a name, email or phone to make the row look complete. A save report references committed state or accurately reports processing/failure.

Store source links, field evidence, uncertainty, revisions and current values. Exact intake replay reconciles to its existing receipt. Distinct cards keep distinct source records. Similarity can produce a match suggestion but cannot silently merge or overwrite a contact.

## Mutation contract

The initial scan creates its saved source and initial observations. After the report, change saved fields only in response to an authorized user prompt bound to the card/contact revision. Natural language can correct, enrich, redo OCR, disambiguate, request a merge, change scope or initiate other permitted work.

A redo preserves the original and prior extraction/correction history and produces a new inspectable result. Background curation, a wiki rewrite or a later model guess cannot mutate contact fields.

Use stable operation IDs and version checks. On an uncertain response, read the contact/source receipt before retrying. Return current field values and evidence on readback. Explicit deletion/merge operations must follow the user's actual grant and retain truthful audit/retention semantics.

## Ownership and projections

| Data | Authority | Projection |
| --- | --- | --- |
| Card bytes and intake receipt | Document/artifact boundary | Bounded previews and OCR input references |
| Initial extraction observations | Document extraction result linked to source | Contact-field candidate evidence |
| Current contact fields and revisions | Local Contacts domain | Contact search and app cards |
| Knowledge about a person | Memory source plus source-linked wiki synthesis | Wiki contact-ID links |
| Future Google Contacts copy | Explicit external projection only | Requires conflict, refresh and deletion rules before implementation |

Role/private/shared access must be checked in the application interface on every operation. Default capture goes to the shared household Rolodex and the save report names that audience. Preserve role-based editing and explicit scope-change requests. This does not publish unrelated source-conversation history or automatically put a card on the kitchen screen.

## Migration and rollback

No bulk legacy data migration is authorized. Port only individually selected contracts/code after source hygiene and licensing checks. Use an additive owned schema and consistent backup/restore. Disabling new contact writes must preserve saved originals, accepted fields and corrections.

If future Google synchronization is added, local authority does not change silently. Select direction, conflict resolution, scope, consent, removal and reconciliation explicitly.

## Acceptance

Every accepted card fixture saves its original/source record, including an unreadable card. Recognized fields remain attributed and uncertain where appropriate. Verify lookup, exact replay, missing fields, front/back sources, natural-language correction, redo, ambiguous matches, no silent merge, current revision checks and private/shared access.

This decision supersedes the creation-approval and unselected-authority assumptions of historical HardyAI ADR-002 for the current OpenClaw implementation. Contacts storage is now deployed in application schema 3; dormant historical code is unchanged. Delete, merge and Google synchronization are not exposed by the initial tool surface.
