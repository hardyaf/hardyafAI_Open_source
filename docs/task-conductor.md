# Task conductor and native continuation

Updated November 4, 2026. This describes the revised coordination boundary. [Current status](current-status.md) owns deployment and acceptance; the [complexity audit](bookkeeping-complexity-audit.md) preserves the baseline findings.

## Current owners

Stock OpenClaw owns sessions, goals, parent/child runs, yield/wakeup, execution and scheduling. The household application owns authenticated admission, source binding, scoped capability projection, delivery status and effect receipts. Domain services own actual business state. TaskFlow coordinates checkpoints, selected context, questions and outcome evidence over those existing owners.

The task checkpoint is an immutable scoped artifact referenced by the existing conversation_checkpoints CAS pointer. There is no current Markdown task-ledger directory, second task engine or application self-prompt queue. The old October ledger description is superseded.

## Current model interface

The [task-conductor skill](../skills/task-conductor/SKILL.md) and [typed task catalog](../services/household-control/src/task-flow/catalog.ts) define the executable interface. Main interprets the request, loads matching skills and exact typed schemas, then performs permitted work. Longer work uses native goals/children and compact checkpoints when useful. Outcomes may be declared in the single completion call after delivery; owner receipt association and truthful progress projection are application mechanics.

Ordinary source-bound authorized actions and memory curation need no native goal or formal plan. Complex work remains native-goal owned. `task.context` restores current owner facts without changing a checkpoint; `task.complete` checks proof and coordinates native completion. Read results are observations, not committed operation receipts. A readback can inform the answer without another formal outcome or an invented operation ID. See the [implementation record](bookkeeping-simplification-implementation.md) for retained boundaries and compatibility surfaces.

The original human/native request stays immutable. Unverified model outcome drafts and resource hints can be corrected or explicitly retired with `planRevisionReason`, recorded in the existing checkpoint history. Omitted outcomes stay required. Once actual owner proof or fresh human steering binds a requirement, internal authority and unique-target pins survive strategy changes and proof invalidation. Main cannot release those requirements through a draft correction; material target/acceptance changes or retirement require fresh scoped human steering. No new ledger is involved.

Workers receive their current phase assignment. The original objective is a boundary/reference, not a replacement child assignment. Root identity, audience, permitted capabilities and diagnosis restrictions carry through trusted native lineage. Parents own overall completion; a child's successful announcement alone is not evidence that the user objective was fulfilled.

## Continuation and human replies

Native unfinished-plan continuation is armed by the actual current-run `progress_card` callback. Call the real tool with `{}` when unfinished work needs another native turn; trusted code supplies truthful progress, including an unfinished projection before formal outcomes exist. Progress does not authorize business effects. A progress-card RPC alone cannot arm the callback. Do not hide effects from native settlement or add an alternate self-prompt loop.

Native `sessions_yield` is direct-only and must use its visible typed function; it has no ToolSearch ID and must not be searched or wrapped with `tool_call`. Parent child-completion waiting omits `waitFor`; message mode waits for a separate external continuation. Same-agent children use `completionTarget: parent`, and native settlement wakes the original parent.

The native finalizer refuses unsafe revision rewinds after potential deterministic effects. Productive work uses supported continuation and child settlement. A durable question explicitly finalizes the current run while the goal remains pending for a human reply. A normal reply may answer, clarify, redirect, cancel, request another OCR attempt or introduce a new topic; it is not limited to fixed response commands.

Preserve the original goal/source binding, current correction and verified effects across fresh workers, compaction and restart. Reconcile unknown effects before another write. A run ending is distinct from the original goal being complete.

## Context and output

Use active prompt/headroom measurements and artifact-backed sources with compact handles/results. Cumulative processed tokens are a diagnostic, not the active context size. The ordinary baseline uses 32K context; deployed model details belong to current status.

The model metadata advertises an output limit, but inspected successful calls exceeded that advertised value. Its presence does not establish the actual request cap or prove truncation caused a failure. See the [measured runtime record](model-runtime-known-issues.md). The owner deferred arbitrary productive tool/turn caps; preserve native resource safeguards, cancellation and stopping repeated no-progress behavior.

## Verification and reporting

Actual domain state and receipts establish delivery. Main declares the requested results and uses exact owner-issued operation/resource IDs or scoped output handles. It must not fabricate an operation for a read or combine several resource IDs into one. A saved plan, successful child announcement, contact record or confident final prose does not by itself establish all requested outcomes. Preserve destination, source, field provenance, reconciliation and acceptance distinctions. Questions and partial/failed work remain visible.

When explicit proof is unavailable, `task.complete` returns pending `evidence_required`, bounded rejection codes and current verified owner candidates. Impossible read-tool operation requirements receive a typed outcome issue. Invalid proposals do not alter the checkpoint. Main can correct unverified drafts with a recorded reason and use actual proof without repeating effects. Source/scope/permission failures remain hard errors; accepted proof still has to match current tool, business state and resource. No pending result completes the native goal.

The [TaskFlow implementation](TASK-FLOW-IMPLEMENTATION.md) documents checkpoints, current-source checks, evidence and rollback; [native hooks](NATIVE-TASK-HOOKS-AND-ANALYSIS.md) document supported integration details. The [simplification record](bookkeeping-simplification-implementation.md) describes implemented changes; the complexity audit retains the baseline findings.

## Historical component evidence

October 5 native experiments demonstrated skill selection and a parent/child spawn/yield/resume round trip without household mutations. The round trip required ten tool calls and recovered from two model navigation mistakes. Its largest parent prompt was 16,510 tokens; cumulative processing was approximately 129,408 tokens. Those measurements describe that experiment, not a current output cap or complete household-task acceptance.

Initial November campaign attempts produced real parent/child list effects and original-parent wakeup without accepting complete goal delivery. Progress/evidence failures, card extraction skipping and automatic-memory failures remain in the measured runtime record. [Current status](current-status.md) owns later model outcomes; passing component tests alone do not certify natural model execution.
