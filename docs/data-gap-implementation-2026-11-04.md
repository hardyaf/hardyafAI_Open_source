# Household data gap implementation November 4 2026

Status: implementation and focused regression cases written. No local Windows
builds/tests or runtime changes were performed by this workstream. The integrated
Ubuntu campaign and current-status document own executed/deployment evidence.

## Reuse and ownership

| Gap | Decision | Sole authority and derived effects |
| --- | --- | --- |
| Growing memory topics/journals | Adapt existing remember facade, managed-page adapter and native wiki. | Immutable scoped captured sources remain authoritative. Bounded native synthesis parts and indexes derive from those sources; source-aware correction/forgetting applies across parts. No new database, queue or rollover ledger. |
| Fresh OCR redo | Adapt Contacts' existing injected Documents extraction port. | Documents owns extraction artifacts. Contacts owns current revision/history and the later-human request binding. The application adapter derives a redo-operation OCR key; exact retry reuses that operation, while a different redo runs a different extraction. |
| Calendar verification | Adapt existing Google adapter and extract its comparator. | Google Calendar remains event authority. Normalized provider readback determines verified; no new event mirror or permission source. |

## Resulting behavior

Memory automatically creates native continuation parts when a generated body
would exceed 20,000 characters or 350 lines. One large capture can span parts.
Deterministic filename derivation and existing source/claim markers permit
recovery after any committed part. A retry checks all derived parts, preserves
committed entries and writes only missing projections. Receipts expose root and
source-containing lookups. Whole-page synthesis remains bounded. Attributed
forgetting and supersession use the existing managed namespace and pruning owner.
External native concurrent writers still do not gain atomic compare-and-swap.

A requested OCR redo requires an extraction attested for that redo operation.
An authorized old handle cannot satisfy freshness or act as fallback after a new
extraction failure. The adapter uses the supported local OCR mode and a distinct,
idempotent operation key. Fresh extraction artifacts appear in committed contact
receipts/observations. Source hashes, audience checks, expected revision and a
later trusted human prompt remain required. Reinterpretation without new OCR
remains ordinary correction/enrichment; it does not claim a new OCR pass.

Calendar verification compares explicit popup/email reminders after normalizing
units, duplicate entries and ordering. Provider-default reminders cannot prove
explicit overrides. Explicit empty reminders uses the installed provider's
`--no-reminders` flag. Timed writes verify both saved endpoint time zones against
the effective IANA zone; equivalent timestamps alone do not prove recurring wall
time intent. Canonical IANA aliases compare equal. All-day date semantics remain
separate. Missing/mismatched fields return verified false.

## Files

- `services/household-control/src/domains/memory/append-managed-memory.ts`
- `services/household-control/src/domains/memory/managed-pages.ts`
- `services/household-control/src/domains/memory/remember.ts`
- `services/household-control/src/domain-runtime/contact-extraction.ts`
- `services/household-control/src/domains/contacts/types.ts`
- `services/household-control/src/domains/contacts/service.ts`
- `services/household-control/src/domains/contacts/extraction-evidence.ts`
- `services/household-control/src/domains/google/event-verification.ts`
- `services/household-control/src/domains/google/index.ts`
- `services/household-control/test/calendar-verification.test.ts`
- `services/household-control/test/contact-extraction-adapter.test.ts`
- `services/household-control/test/contacts-domain.test.ts`
- `services/household-control/test/contacts-observation-binding.test.ts`
- `services/household-control/test/memory-remember.test.ts`
- `skills/household-contacts/SKILL.md`
- `docs/memory.md`

## Verification and rollback

Focused cases cover normalized/missing/default reminders, timezone mismatches,
provider create/update flags, stale extraction handles, fresh-operation replay,
failed new OCR without fallback, stale adapter provenance, topic/journal rollover,
partial multi-part recovery, full daily journals and cross-part forgetting while
retaining an independent fact. Run those with existing memory pruning/lifecycle,
contact and native-domain boundary cases on Ubuntu, followed by affected real
model workflows in the existing consolidated campaign. Fixtures do not establish
real OAuth, noisy-card or four-family acceptance.

No database schema migration or account bootstrap is added. Preserve newly
written native memory parts and extraction/contact receipts during rollback;
never restore a database to erase newer effects. Old memory writers cannot
manage continuation parts, so reverting that writer requires suspending automatic
curation or retaining this narrow compatibility helper. Credential/provider
setup remains outside this workstream.
