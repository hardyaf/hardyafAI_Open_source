---
name: household-memory
description: Save and retrieve recipes in Knowledge, remember grounded facts and inference candidates, and handle provenance, corrections and scoped forgetting.
metadata: {"openclaw":{"emoji":"🧠"}}
---

# Grounded household memory

Captured source Markdown and the native wiki are authoritative. Keep personal
and household audiences separate; shared context cannot read a private wiki.
Use the selected exact `household_memory_*` schemas. Do not create another diary,
SQL fact store, vector index or transcript processor.

Content writes follow the authenticated source audience: use `personal` in a
private conversation and `household` in a shared household conversation. Access
to household memory is not permission to publish a private source. This applies
to remember, source_save, source_supersede, synthesize and annotate, including
candidate claims. Scope choices or claimed sharing flags cannot authorize it.
`memory_shared_write_requires_shared_conversation` means nothing was published:
use an actual shared conversation for V1 household capture. Explicit publication
from a private conversation is deferred. Existing authorized household reads,
content-free compilation and currently approved scoped forgetting remain
available; a shared source cannot write to a personal corpus.

## Ordinary capture

Automatically remember useful lasting human-shared facts about people,
preferences, programs and household decisions. No associated task or native goal
is needed. Skip secrets, credentials, disposable tool chatter and trivial turns.

Prefer `household_memory_remember`: supply scope, a useful topic, an exact current
human sourceQuote and interpreted claims. A clear fact may use normalized text
with an exact supporting evidenceQuote when wording differs. Preserve meaning;
an unrelated quotation cannot support a claim. Mark inference, external
observations and uncertainty as candidates. The application checks quote/source
identity; you remain responsible for semantic interpretation.

The domain attaches current human provenance, preserves existing topic claims
and human notes, appends the daily journal using the configured household date,
and checks native readback. Do not separately repeat source capture, page/hash
reconstruction or journal maintenance after a successful remember receipt.
Report committed, partial and failed curation accurately. A user request is
evidence of what was requested, never proof that the action happened.

## Saved recipes

When the user asks to save a recipe, use `household_memory_save_recipe` with a
clear title, useful alternate names, ingredients with quantities and steps if
available. This is a recipe reference, including when Jarvis drafted it. Only
save it on request. Use the current conversation's scope. To file an existing
reference note as a recipe, supply the exact same-scope `referenceNoteId` and
omit ingredients and steps. The owner imports the saved body and records its
origin. A title conflict requires a different title or version.

When asked for a saved recipe, search Knowledge with `household_memory_search`
and `kind: recipe`. Search a short title, alternate name, or ingredient. Use a
small result limit for a known recipe. Read the returned path with
`household_memory_get` before giving amounts or instructions. If several
recipes match, ask which one the user means. Use the note search only when
looking for an older reference that has not yet been filed in Knowledge.

## Retrieval and deliberate synthesis

Use search/get and source_list/read/references for relevant existing knowledge,
conflicts and provenance. Recall stays within managed topics, recipes and the current
scope; there is no transcript or unmanaged-page fallback. Keep contradictions
and useful questions visible rather than replacing uncertainty with a guess.

The lower-level source_save/synthesize/annotate tools remain for deliberate
curation and rebuilds. Current human source IDs are attached automatically.
For explicit full-page synthesis, read the complete body/hash, preserve prior
sources/claims and use expectedContentHash; null means a genuinely new topic.
Respect read bounds and use clearly named additional parts when necessary.

## Later correction and forgetting

For a later human correction, identify/read the exact old source, then use
source_supersede with its fingerprint and the new exact verified quote. The old
source retires and explicit history remains outside indexed Markdown. The domain
prunes source-attributed entries and their claims/references while preserving
unrelated topic and daily-journal entries automatically. After successful
supersession, call `household_memory_remember` with sourceId set to the returned
replacementSourceId, the same current-human sourceQuote and your corrected claims.
It reuses that confirmed source and maintains both topic and daily journal; do
not capture another source or manually reconstruct journal pages/hashes. The
reused source must match the current human evidence exactly. Do not reuse
contradicted assertions. A same-turn assertion is not a later human correction.
Opaque legacy prose or human notes cannot be safely pruned:
their pages are invalidated and the receipt names required rebuilds. Rebuild only
those affected opaque pages from surviving authorized sources.

For forgetting, identify the exact source/scope and obtain current destructive
approval before source_forget. Completion covers owned active/history source
bodies and source-attributed managed entries, with native wiki/index refresh.
Check the receipt's removed/pruned and rebuild-required counts; do not claim
unrelated content was preserved when an opaque page required invalidation. Original
conversations, task artifacts, unmanaged copies and backups remain outside that
promise. A partial refresh is not successful forgetting. Do not recapture a
forgotten fact from old history without a later explicit human request.
