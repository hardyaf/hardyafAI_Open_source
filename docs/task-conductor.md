# Multi-stage task conductor

Jarvis uses a generic OpenClaw workspace skill to decompose complex requests
without maintaining a separate workflow for every document, calendar, note,
list, or future integration.

## Trigger

The `task-conductor` skill applies when a request:

- turns a document, attachment, URL, or large text source into external
  changes;
- spans multiple services, stores, accounts, or integrations;
- contains a destination or identity ambiguity that can change the result;
- contains several dependent actions; or
- requires independent verification of persisted state.

Simple reads and direct single-purpose actions remain in the main session.

## Execution model

The main Jarvis session acts as conductor. Substantial gather, act, and verify
phases can run in fresh OpenClaw worker sessions. Workers receive only their
phase assignment, the minimum relevant context, applicable skill, authority
boundary, and a task-ledger path. They do not inherit permission to broaden the
request.

The conductor uses semantic milestones rather than numerical tool-call, turn,
or concurrency limits. This is intentional for the initial rollout; behavior
will be observed before adding restraints.

## Recovery ledger

Active ledgers are Markdown under:

```text
/home/codex/.openclaw/workspace/.openclaw/task-ledgers/active/
```

Completed and non-resumable failed ledgers move to sibling `completed/` and
`failed/` directories. A ledger stores the goal, authority, confirmed
destinations, evidence references, stable action IDs, verification, next phase,
and failure class. It must never contain credentials, authorization codes, or
large raw tool output.

The ledger is operational recovery state, not long-term household memory. It
allows a fresh worker to resume only the unfinished phase after malformed model
output and prevents blind repetition of external writes.

## Verification and failure classes

The verification phase reads the real destination and compares identity,
destination, count, important values, persistence, and tool execution with the
plan. Jarvis reports failures as one of:

- input/data;
- configuration/integration;
- model/orchestration; or
- hardware/resource.

This keeps working permissions or integrations from being blamed for a model
continuation mistake.

## Files

- Policy: `/home/codex/.openclaw/workspace/AGENTS.md`
- Skill: `/home/codex/.openclaw/workspace/skills/task-conductor/SKILL.md`
- Ledgers: `/home/codex/.openclaw/workspace/.openclaw/task-ledgers/`

No upstream OpenClaw source is modified.

## Acceptance evidence

Validated on OpenClaw 2026.9.8 with `ollama/gpt-oss:20b` on 2026-10-05 UTC.

- Policy-selection run `29ec3ca4-1c49-4644-b3b8-ad66aa26d3ac` selected
  `task-conductor`, identified the unresolved calendar destination, proposed
  fresh gather/write/verify contexts, and applied no numerical limits.
- Worker round-trip run `515934a5-d6ea-4f3c-947a-a4d719733eab` discovered
  `sessions_spawn`, started child run
  `0febd917-ec04-4979-88f4-c429a93b0e97`, yielded, received
  `conductor-worker-ok`, and resumed the parent session.
- No external service or household-data mutation was permitted or attempted.

The worker test used ten tool calls and encountered two recoverable
model-orchestration mistakes: an empty initial tool search and an incorrect
first skill-read path. It processed 103,587 cumulative tokens across repeated
model calls; the largest reported final call was 16,529 tokens, below the
32,768-token context window. This is the initial efficiency baseline. No
tool-call, turn, or concurrency restraint was added.
