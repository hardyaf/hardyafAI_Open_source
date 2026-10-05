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

## Context allocation

Cumulative token processing is diagnostic only. The governing measurement is
the active prompt and the headroom remaining for expected tool results,
reasoning, output, and OpenClaw's reserve.

The current standard profile remains:

- model context: 32,768 tokens;
- preferred prompt budget before reserve: 24,576 tokens;
- reserve: 8,192 tokens;
- maximum model output: 2,048 tokens.

Each substantial phase should begin in a fresh worker. Complete source material
stays in files or external records; workers pass paths, stable IDs, hashes,
evidence coordinates, and compact normalized results. If a fresh standard
worker cannot fit the phase with the reserve intact, the ledger records
`larger-context-needed` and the source is processed in grounded chunks or routed
to a separately approved larger-context profile.

No dynamic `num_ctx` change, reserve reduction, cloud fallback, tool-call cap,
turn cap, or concurrency cap is part of this policy.

## Recovery ledger

Active ledgers are Markdown under:

```text
/home/operator/.openclaw/workspace/.openclaw/task-ledgers/active/
```

Completed and non-resumable failed ledgers move to sibling `completed/` and
`failed/` directories. A ledger stores the goal, authority, confirmed
destinations, context plan, artifact inputs, progress marker, evidence
references, stable action IDs, verification, next phase, and failure class. It
must never contain credentials, authorization codes, or large raw tool output.

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

- Policy: `/home/operator/.openclaw/workspace/AGENTS.md`
- Skill: `/home/operator/.openclaw/workspace/skills/task-conductor/SKILL.md`
- Ledgers: `/home/operator/.openclaw/workspace/.openclaw/task-ledgers/`

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
first skill-read path. The complete parent-and-child round trip processed about
129,408 cumulative tokens. The parent used 116,746 input and 3,547 output
tokens across nine calls; the child used 8,868 input and 247 output tokens.
The largest individual parent prompt was 16,510 tokens, below the 32,768-token
context window and the 24,576-token preferred prompt budget before reserve.
Cumulative processing is retained as a compute diagnostic; peak active prompt,
remaining headroom, refreshes, and repeated no-progress actions are the
operational metrics. No tool-call, turn, or concurrency restraint was added.

Context-headroom policy run `d223889b-69c5-4e2e-9092-9405165ff8d3`
loaded the revised skill with one successful read and no tool failures. Jarvis
used active reserve as the continuation gate, kept complete results
artifact-backed, stopped identical no-progress retries, and applied no
numerical caps. The final call used a 12,694-token prompt; OpenClaw's pre-prompt
estimate was 15,662 of the 24,576-token preferred prompt budget, leaving 8,914
tokens before reserve. No compaction, external service access, or household
data mutation occurred.
