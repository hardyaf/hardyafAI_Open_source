---
name: household-contacts
description: Save and retrieve business cards in the local household Rolodex, report every save, and interpret later human corrections or OCR redo requests as normal prompts.
metadata: {"openclaw":{"emoji":"📇"}}
---

# Business cards and household Rolodex

The local Rolodex owns contacts; external contact sync is deferred. Use
`household_contacts_*` tools and the documents context for local OCR. Each
supplied card gets a distinct saved record; multiple sides of the same card may
be its source artifacts. Similarity suggests possible matches but never merges
them or suppresses a supplied card's save.

Clear scans and ordinary corrections may use authorized tools without creating a
native goal; use durable coordination for genuine waits, restart continuity or
larger multi-stage work.

Persist the supplied source promptly through the existing artifact intake;
source persistence and the contact's first field save are different actions.
Before that first field save, load the local-documents context and attempt
local extraction/OCR on the supplied card artifacts with the typed document
tools. Read the resulting evidence, then reason through its fields and call
capture_card once for this intake, passing extractionArtifactIds when available.
The owning Documents adapter resolves these handles (or attempts local extraction
when missing); do not copy raw OCR metadata as a substitute for its receipt.
Literal field matches are grounded automatically; omit observations when they
add no interpretation. When a normalized field differs from the printed wording,
provide field/value observations with exact supporting quotes; do not repeat those
proposals in fields. When no explicit fields/patch is supplied on capture or OCR
redo, those observations are the field proposals. Explicit fields, including an
empty object, or an explicit redo patch choose the saved fields instead. On capture or OCR redo, omit the
observation's sourceArtifactId when that quote identifies one authorized extraction
uniquely; the owner fills both full evidence references. Ambiguous quotes need a
specific source/extraction reference. Explicit IDs must be complete and are never
guessed or repaired. For poor text, a useful supported local mode
may be tried before the first save. Do not infer that a card is unreadable merely
because extraction has not been attempted, and do not substitute an empty save
for a requested scan of a readable card.

Save every supplied card and report its committed save without a mandatory
review. If a real local extraction attempt fails, extraction is actually
unavailable under the current capability/configuration, or its returned evidence
has no readable fields, still save the original card with empty or supported
fields and an honest uncertainty report naming that condition. Do not claim OCR
was performed when no extraction receipt exists. An unavailable local reader is
not permission for cloud OCR, raw file access or a different account.

Default to the shared household Rolodex unless the user explicitly selects
private scope and the current audience allows it. Populate only source-supported
names, email addresses, phone numbers, company, role, addresses, URLs and notes.
Retain original/extraction references and page/block/quote observations; mark
uncertainty. Do not invent a name, fill an unreadable email or silently enrich
from memory. Once the contact is saved, a later extraction result alone cannot
authorize silently replacing its fields: a fresh ordinary human response is
required for correction or OCR redo, as described below.

Show a short preview of the saved contact and uncertain fields, with the stable
contact ID available for follow-up. Avoid a mandatory pre-save review. After
saving, preserve the record until a later human response targets it. Replies
such as a correction, a request to redo OCR, a different interpretation or a
new question are normal prompts; no keyword/button-only correction grammar.

For a requested change, get the current record/revision, reason through the
reply, and call revise with patch.set for changed fields and patch.remove for
explicitly removed fields. Unchanged fields, evidence and uncertainties remain.
Use the current trusted revision/focus; a stale revision is rejected. Full fields
replacement is available only when you actually intend it. A requested OCR redo performs a new local OCR extraction under that redo operation
and preserves prior revisions. Its committed receipt identifies the fresh extraction.
Do not supply an earlier extraction handle as proof of a new pass. Read the new
evidence if the proposed fields do not match; never repeat an unchanged proposal
blindly. Reinterpreting retained evidence without running OCR is an ordinary
correction/enrichment prompt, not an OCR redo. Observations-only redo patches
the observed fields and preserves untouched fields/evidence. Manual corrections
still use an explicit patch or replacement. The trusted runtime binds this later response to the contact; the
model cannot claim permission using an argument or an automatic background run.
On a revision conflict, read the new state and resolve it before writing.

Use search/get for requested names or details. Share a private record only under
its owner's later explicit request and current authorization; audience changes
do not erase earlier published copies or source artifacts. After an uncertain
write, inspect operation status before repeating the capture or revision.
