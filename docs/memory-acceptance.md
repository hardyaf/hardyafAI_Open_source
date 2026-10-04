# Memory acceptance suite

Run this after memory, model, routing, or GPU-serving changes. Use disposable
markers and remove them afterward. A conversational claim is never proof.

## 1. Agent isolation

1. Put a unique marker in main notes and another in Adult notes.
2. Force-index both agents.
3. Search each marker in its owning agent; require a grounded result.
4. Search each marker in the other agent; require no result.
5. Remove the markers, reindex, and require both searches to be empty.

## 2. Persistence

1. Save a dated, non-sensitive preference through Adult's normal interface.
2. Read the authoritative Markdown file and record its hash.
3. Restart the gateway.
4. Confirm the same hash and a successful memory search.

## 3. Eligible pre-reply recall

This must originate from Adult's real Discord DM; management CLI turns are
session-ineligible.

1. In one DM conversation, give a disposable, unique preference marker.
2. Allow the session transcript to be indexed.
3. Start a later DM conversation and ask for that exact preference.
4. Require a grounded exact answer and an Active Memory log entry that was not
   skipped, timed out, or circuit-broken.
5. Forget/delete the disposable sessions and verify the marker is absent.

## 4. Unknown and contradiction handling

- Ask for an unrecorded fact; require an explicit unknown, not a guess.
- Present two conflicting values with dates; require the conflict and sources
  to be surfaced rather than silently choosing one.

## 5. Canonical destination

- Calendar fact: verify only the selected Google Calendar is authoritative.
- List item: verify LISTS.md (or Google Tasks when enabled), not MEMORY.md.
- Stable preference: verify USER.md with source date.
- Dated observation: verify memory/YYYY-MM-DD.md.
- Longer note: verify notes/.

Search for duplicates across the other stores and fail the case if found.

## 6. Real tool sequence

Run one household task that requires at least two tools, such as updating a
list and reading it back. Verify saved state independently. Record separately:

- configuration/integration errors,
- model selection or sequencing errors,
- hardware/resource failures,
- unsupported-product gaps.

For chat-model comparisons, reuse the same prompts, context, temperature,
context window, and expected state checks. Compare completion correctness,
unnecessary tool calls, latency, and peak VRAMnot prose quality alone.
