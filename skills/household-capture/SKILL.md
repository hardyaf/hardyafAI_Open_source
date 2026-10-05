---
name: household-capture
description: Capture, retrieve, display, complete, restore, and safely remove household or personal notes and list items from ordinary conversational stream text. Use for shopping, errands, tasks, waiting items, brain dumps, note-taking, showing lists, completing items, or building the household dashboard. Do not use it to duplicate calendar events or durable profile memory.
metadata: {"openclaw":{"emoji":"📝","requires":{"bins":["python3"]}}}
---

# Household capture

Let the user speak naturally. Do not require commands, tags, special
punctuation, or a fixed sentence order.

The deterministic storage tool is:

    python3 skills/household-capture/scripts/capture.py

Run it from the active agent workspace. Do not edit managed list or note files
directly unless repairing a verified problem.

Every exec tool call for this skill must set host to gateway and use the active
workspace as workdir. Never request host node and never set the node field.
This installation intentionally permits gateway execution and rejects node
execution. If an exec attempt reports that node is not allowed, correct the
host to gateway and retry once in the same turn instead of telling the user the
skill is unavailable.

## Canonical destinations

- Household shopping, errands, and shared tasks: the neutral shared household
  store reported by the paths command.
- Personal tasks: the active agent workspace's LISTS.md.
- Household reference notes: the neutral shared household notes directory.
- Personal notes: the active agent workspace's notes/ directory.
- Calendar events: the explicitly selected calendar only. Do not also add them
  to a list unless the user separately asks for a preparation task.
- Stable preferences, relationships, durable decisions, and durable facts:
  follow the workspace memory policy rather than hiding them in notes.

On Adult's agent, default ambiguous private requests to personal scope. Use
household scope when she explicitly says household/shared, names a shared
list, or adds ordinary household shopping. In a shared household channel,
default ordinary list requests to household scope. Ask only when the choice
would expose private information or materially change the action.

## Stream-text capture

Split text into the smallest useful items:

- shopping: something to buy.
- task: an action or errand.
- waiting: something another person or organization owes or is handling.
- note: reference material that is not an action.

Preserve text inside quotation marks exactly as the item text. Do not shorten,
paraphrase, or remove qualifiers from quoted text. For unquoted stream text,
remove conversational filler but preserve names, quantities, model numbers,
dates, and other meaning-bearing detail.

Resolve calendar language before saving. A dated appointment, meeting, or
time-specific reminder belongs on a calendar. A deadline may remain a task
with a due date. If Tuesday could mean either an event or a task deadline, ask
one short question.

For one or many items, make one capture call:

    python3 skills/household-capture/scripts/capture.py capture --payload-json '{"items":[{"kind":"shopping","scope":"household","text":"milk"},{"kind":"task","scope":"personal","text":"call the dentist","due":"2026-10-06"},{"kind":"note","scope":"personal","title":"Soup preference","text":"Adult liked the low-sodium soup."}]}'

Allowed fields are kind, scope, text, optional title, optional due
(YYYY-MM-DD), and optional confidence (user-stated, confirmed, inferred, or
unknown). Treat the JSON response as authoritative. Report only entries in
saved, existing, or errors. Use the runtime date rather than guessing relative
dates.

## Reading and display

Read state through the tool:

    python3 skills/household-capture/scripts/capture.py show --scope household
    python3 skills/household-capture/scripts/capture.py show --scope personal
    python3 skills/household-capture/scripts/capture.py recent-notes --scope personal --limit 10
    python3 skills/household-capture/scripts/capture.py search-notes --scope household --query 'furnace filter' --limit 10

Present concise Discord-friendly bullets, not Markdown tables. Include stable
IDs only when needed to disambiguate.

For a request to find, recall, or quote a captured note, use search-notes
before general memory search. Treat only returned note text as grounded. If it
returns no matching note, say so; never substitute a different note or invent
an ID. Use scope both only in a private session for the active agent, never in
a shared channel.

For a Control UI dashboard:

    python3 skills/household-capture/scripts/capture.py dashboard --scope household

Pass the returned title, name, pin, size, and report fields to show_widget.
Reuse the stable name to replace the snapshot. The dashboard is a read-only
view of canonical Markdown, not another store. Say when it was refreshed.
Never expose personal notes or lists on a household dashboard.

## Completion, removal, and correction

Complete only by exact stable ID:

    python3 skills/household-capture/scripts/capture.py complete --scope household --id H-20261004-0001

If the user gives text, run show and select a unique match. Ask when more than
one item could match. Completion is recoverable through restore.

Removal is recoverable but destructive from the active view. Show the exact
item and obtain confirmation unless the user already confirmed that exact ID
in the current request. Repeat the ID in --confirm:

    python3 skills/household-capture/scripts/capture.py remove --scope household --id H-20261004-0001 --confirm H-20261004-0001

Restore to the prior section:

    python3 skills/household-capture/scripts/capture.py restore --scope household --id H-20261004-0001

After every mutation, trust the tool's read-after-write verification. If
verification is false, report failure and do not improvise success.
