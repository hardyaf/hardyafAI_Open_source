# Household capture and list display

> Deployment host/account identifiers are redacted. Example addresses use
> `example.invalid`; paths use `$HOME`. Set actual connection, account and
> storage values from protected operator configuration.

**November 3 design update:** preserve this store as the canonical list/note
owner. The planned brain-dump workflow composes it with Calendar, native scheduling
and wiki curation; it does not add a second list database. See the
[brain-dump design](household-assistant-design.md#brain-dumps-and-delayed-work).

The deployment uses the first-party household-capture workspace skill for
natural-language notes and lists. It is a supported OpenClaw workspace
extension; the upstream OpenClaw application remains unmodified.

## Storage boundary

- Shared household lists: $HOME/.openclaw/shared/household/LISTS.md
- Shared household notes: $HOME/.openclaw/shared/household/notes/
- Jarvis personal lists and notes: the main workspace's LISTS.md and notes/
- Natasha personal lists and notes: the Natasha workspace's LISTS.md and notes/

The shared store is outside either private agent workspace. Both agents may
access it for explicit household requests without gaining access to the other
agent's private files.

Markdown remains authoritative. The skill serializes mutations with a file
lock, uses atomic replacement, assigns stable IDs, suppresses duplicate open
items, and rereads every mutation before reporting success. Completion and
removal are recoverable; a removed item moves to the Removed section.

## Conversation model

No command syntax is required. Useful phrases include:

- "Add milk and furnace filters to the household shopping list."
- "My tasks: call the dentist Tuesday and send the school form."
- "Note that the replacement filter is model ABC-123."
- "Stream dump: buy bread, wait for the plumber quote, and note that the
  shutoff is behind the basement shelves."
- "Show the household list."
- "Find my note about the replacement filter."
- "Mark the furnace-filter item complete."
- "Refresh the household dashboard."

The agent separates stream text into shopping, task, waiting, and note items.
Calendar events remain in the selected Google Calendar and durable profile
facts remain under the existing memory policy, preventing cross-store drift.
Captured-note lookup uses a deterministic scoped search before broad semantic
memory. It returns the stored note ID and body rather than asking the model to
reconstruct them.

## Dashboard

The skill emits an OpenClaw native report for show_widget. It is a read-only
snapshot of canonical Markdown and uses a stable widget name, so refresh
replaces the existing dashboard card. Personal data must never be placed on
the household dashboard.

The live report is attached to the pinned main-agent session named Household.
It is available from the Control UI sidebar or dashboard gallery. Refreshing
the report reuses the household-lists widget name and therefore updates the
existing card rather than creating another dashboard.

The report is an on-demand snapshot. Say "Refresh the household dashboard"
after changing a list; no recurring refresh job was added.

The Gateway intentionally permits exec on the gateway host and has no paired
exec nodes. Agent policy and the skill both require host gateway (or the
configured default) and one corrected retry if a model incorrectly requests
host node.

## Operator checks

From either agent workspace:

    python3 skills/household-capture/scripts/capture.py paths
    python3 skills/household-capture/scripts/capture.py show --scope household
    python3 skills/household-capture/scripts/capture.py show --scope personal
    python3 skills/household-capture/scripts/capture.py search-notes --scope household --query 'replacement filter'
    python3 skills/household-capture/scripts/capture.py dashboard --scope household

Run the source tests from the repository or either deployed skill directory:

    python3 -m unittest discover -s skills/household-capture/tests -v

## Planned app and kitchen projections

The current widget is an on-demand snapshot. The planned app/kitchen views read
the same canonical IDs and show freshness/offline state. Kitchen output is
household-scoped and read-only by default; personal lists/notes are not included
merely because an agent can read them.

Clear brain-dump list actions execute within the current grant. Bind only
uncertain items to clarification rather than asking the user to approve the
entire breakdown. Ordinary language answers continue the affected task.

V1 mixed brain dumps enter through a dedicated shared household Discord channel.
The channel supplies entry mode/audience, while the author retains their own
grants. A clarification response continues the pending task rather than being
classified automatically as another independent dump.
