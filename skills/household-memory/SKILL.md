---
name: household-memory
description: Save and retrieve recipes in Knowledge, remember grounded facts and inference candidates, and handle provenance, corrections and scoped forgetting.
metadata: {"openclaw":{"emoji":"🧠"}}
---

# Optional memory guidance

The existing source corpus and wiki own durable household knowledge. Search/get and source tools support retrieval; remember is a convenience for grounded claims, and save_recipe stores recipe references. Compose them as useful. Useful lasting facts may be remembered when appropriate; automatic capture on every turn is not required.

Human quotes and source IDs preserve provenance. Distinguish assertions, inference, external observations and uncertainty. A request proves what was requested, not that its effects happened. Current personal/household scope governs reads and writes; shared context cannot read private sources. Existing explicit publication capabilities determine sharing rather than a guide or model assertion.

Lower-level synthesis/annotation tools support deliberate curation. Their expectedContentHash prevents overwriting newer edits; preserve relevant sources and human notes. Supersession retains correction history and names any pages needing rebuild. remember can reuse a returned confirmed replacementSourceId when adding corrected claims. Source forgetting removes the owned corpus material described by its receipt, not original conversations, backups or unrelated artifacts. The private owner uses current permissions without a separate approval ceremony; other profiles retain their current approval policy. A partial refresh is not successful forgetting.

Recipes can include title, alternate names, quantities and steps, or reference an existing same-scope note. Retrieval can search by title/ingredient and read the selected result. Choose the sequence that resolves the request; no fixed search/capture/journal ritual is required.
