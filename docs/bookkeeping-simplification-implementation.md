# Bookkeeping simplification implementation

November 4, 2026. Authorized follow-through to the [complexity audit](bookkeeping-complexity-audit.md). [Current status](current-status.md) owns the deployed version, model comparison and workflow results. This record describes the implemented boundary; component checks do not establish complete household acceptance.

## What changed

Ordinary authenticated actions can compose authorized typed domain tools without creating a native goal, formal outcome plan or progress card. The existing source admission and effect receipt remain mandatory. Longer work stays with native OpenClaw goals, children and continuation. Main can describe actual outcomes at completion instead of synchronizing a second formal plan throughout execution.

- **Task coordination:** selected domains return exact scoped schemas. Coordination tools remain discoverable in native Tool Search, with a compact schema bundle in task context. Repeated unchanged selection avoids checkpoint churn. Main may revise plan wording and same-authority strategy. It may correct or retire an unverified draft with planRevisionReason in existing checkpoint history; internal owner/human pins preserve established requirements and uniquely proven targets. The immutable original request remains authoritative.
- **Effects and completion:** omitted operation IDs derive from authenticated source, tool and business arguments; explicit IDs remain supported for recovery/approval/distinct identical operations. Committed receipts associate automatically when unique. Optional outcome hints are coordination metadata, stripped before domain dispatch. A post-commit association failure reports the committed operation rather than inviting replay. One task.complete call declares outcomes, resolves current-goal owner evidence and coordinates native completion; pending results remain visibly incomplete.
- **Progress and continuation:** the real progress_card tool accepts an empty object; trusted code supplies a truthful projection. Cosmetic labels/freshness no longer gate domain writes. Unplanned progress remains unfinished until actual outcomes are verified. Stock native callbacks, yield, children and goal control remain the continuation mechanism; no private callback, self-message queue or extra productive-turn cap was added.
- **Memory:** content writes follow the trusted conversation audience. Access to household memory is not publication authority: private-to-household source/topic/journal writes are rejected before memory access. Existing household reads, content-free compilation and approved forgetting remain available. Cross-audience publication is deferred; V1 shared facts originate in a shared conversation. Remember binds the current human source automatically, accepts normalized claims with exact supporting quotes, preserves fact/candidate distinctions and updates topic plus household-date journal through the existing owner. Compact receipts replace copied pages and manual source/hash maintenance. Correction/forget removes attributed entries and preserves unrelated entries. After supersession, remember can reuse the returned replacement source under exact current-human provenance, maintaining both topic and journal without another capture. The exact native Related projection is mechanical only outside human Notes; stale retired-source links are dropped before native regeneration. Opaque legacy/human prose is conservatively invalidated with explicit rebuild-required disclosure; this is not a universal preservation promise.
- **Cards:** Contacts accepts patches that preserve untouched fields/evidence and current trusted revision/focus. Documents owns real extraction handles, source hashes and local-reader failure evidence. Quoted observations may omit repeated source IDs when one authorized/hash-verified source-extraction pair supports them. When fields is omitted, observation field/value proposals supply it mechanically; explicit fields remain authoritative. Observation-only OCR redo patches those fields and preserves unrelated values. Ambiguity or explicit incorrect identifiers never trigger guessing or repair. Same-intake identity detects changed retries instead of making duplicate field records. Every card remains saved/reported; fields change only after a later human prompt, with no silent merge or enrichment.
- **Receipts:** Main can submit evidence-grounded nonmonetary interpretations and focused human clarification facts, using existing Uplift candidate/review operations. Exact money, arithmetic, source/grant/revision checks, duplicate uncertainty and transactional acceptance remain deterministic. Optional validation stays optional; acceptance still validates.
- **List display:** read projections separate writer/date/status metadata from item text, preserving literal user annotations and the existing due-date presentation. Canonical list files and item IDs remain unchanged.

Task context restores current-goal owner evidence without changing checkpoints. Proof from another historical goal is rejected; committed effects from an earlier cancelled source of this same goal remain eligible. Completion rechecks current business state even when a receipt digest is unchanged. Missing own proof returns typed pending feedback and current owner facts without persisting invalid proposals. Wrong source/scope/permission and verified proof mismatches still fail. The actual scoped write catalog rejects impossible committed-read requirements; read observations never supply operation IDs. Pending native children block terminal handoff before native completion. Exact response-loss recovery uses the existing source/session/goal control receipt.

## Reuse and data ownership

| Data or operation | Decision and authoritative owner | Consistency and deletion |
| --- | --- | --- |
| Goal, sessions, children, continuation, schedules | Reuse stock OpenClaw | Native owner controls lifecycle; no alternate engine or queue. |
| Identity/source/grants, exact invocation and effect receipt | Adapt existing admission/execution/effect owners | Rechecked per call; derived IDs never grant authority. Failed/unknown/committed receipts survive retries. |
| Plan/questions/evidence references | Adapt existing TaskFlow artifact/CAS pointer | Immutable handoffs, current revision, source/goal/audience fencing; no second task ledger. |
| Progress and selected schemas | Adapt existing native tool and scoped loader | Rebuildable/ephemeral projections, never business proof or permission. |
| Facts, topic/journal and search | Adapt existing source Markdown/native wiki | Source-linked entries; exact source retirement prunes managed entries, refreshes native index and reports opaque rebuilds. |
| Card/original/extraction/revision | Adapt Contacts, ArtifactStore and Documents | Each owner keeps its own authority; no raw lookup ID becomes permission. Patches preserve unmodified data. |
| Receipt candidate/review/accepted financial state | Adapt existing Uplift authority | Atomic revision acceptance and accepted-only reports; no Jarvis financial ledger. |
| HTTP API and clients | Reuse unchanged public API contract | Service implementation version is independent of API schema version. APK reuse requires complete Android source-map equality. |

No new queue, task store, credential store, approval broker, memory database or contact authority was introduced. Application schema remains 4 and Uplift schema remains 1. The deployed service/plugin version is 0.6.0 with 87 native plugin tools; the unchanged HTTP API contract remains version 0.5.0. Guarded Ubuntu promotion and current ordinary readiness are recorded in [current status](current-status.md) and the protected deployment receipt. YAML is pinned to 2.9.1 in the Ubuntu-generated dependency lock.

## Code and contract map

- [TaskFlow](../services/household-control/src/task-flow/), [application coordination](../services/household-control/src/domain-runtime/task-application.ts) and [root composition](../services/household-control/src/domain-runtime/runtime.ts): direct action path, proof, completion and native projection.
- [Native plugin](../plugins/household-domains/) and [conductor skill](../skills/task-conductor/SKILL.md): supported native hooks, exact invocation and compact selected context.
- [Memory adapter](../services/household-control/src/domains/) and [memory skill](../skills/household-memory/SKILL.md): provenance, one-call curation and source lifecycle; see [memory ownership](memory.md).
- [Contacts](../services/household-control/src/domains/contacts/) and [Documents](../services/household-control/src/domains/documents/): field patch/extraction boundaries and regression coverage.
- [Uplift integration](../integrations/uplift/) and [receipt skill](../skills/household-receipts/SKILL.md): interpretation/clarification primitives and financial acceptance.
- [Capture skill](../skills/household-capture/): read projection and literal-item preservation.

The public source manifest is the exact file list for a prepared release; protected receipts retain source/config/test hashes without embedding private inventory in tracked documentation. Existing oversized composition remains compatibility debt; these changes reuse its explicit ports rather than adding a new domain responsibility there.

## Native lifecycle corrections

The native goal API returns an operation envelope such as updated with the actual goal status nested inside it. The adapter validates echoed operation/action/session/goal identities and returns the real business status. It never assumes that a requested action succeeded. This fixes an uncertain acknowledgment after an actually completed goal.

Response-loss recovery accepts an already-complete source only for the exact existing owner control, root/run/session/source/goal and unchanged current authorization. The narrow deferred dispatcher recognizes only the native completion name and its canonical plugin ID; unrelated terminal-source tools remain denied. No native mutation or business effect is repeated when the goal is already complete.

A current terminal parent/successor turn under the exact expected native goal is now observable by delivery reconciliation. A finished turn does not establish goal success: missing proof becomes a visible incomplete failure, and a real pending question remains waiting. Stale rows, unrelated goals, child lineage and active/queued continuations retain their fences. This removes phantom running requests without another scheduler or queue.

## Verification and remaining work

The assembled Ubuntu backend, Uplift and capture suites passed using the installed native SDK. [Current status](current-status.md) owns the final exact counts. Source/import and actual plugin/schema checks passed with 87 tools. Checks cover source-audience publication denial, observation-only card interpretation, draft-plan recovery, read-proof rejection, delayed outcome declarations, current-goal evidence, response-loss completion, pending children, privacy/cancellation/diagnosis boundaries, patches, local extraction linkage, receipt grounding, and correction/forget preservation. Current status records the later model-run evidence and any subsequent affected reruns.

Keep original failed attempts and partial effects. A failed case is not made clean by deleting its writes or restoring an old database. Use fresh fixed inputs for a required rerun, compare both models on identical case definitions, and reconcile uncertain effects before retrying. Natural-agent success remains separate from these component checks.

Deferred: further consolidation of duplicated native settlement reads after race characterization; removal of legacy verify/finish surfaces; dormant obsolete workspace instruction mirrors before any re-enablement; held OAuth/vault and real project onboarding; complete family/device/recovery and workflow acceptance. No provider credential or grant was broadened by simplification.

## Operations and rollback

Use protected consistent state/config backups and the exact clean-source manifest. Source, skill and plugin changes deploy together on Ubuntu. Keep scheduling disabled and historical jobs retained/disabled until scoped acceptance establishes otherwise. Retain the prior Ollama container/image and model configuration for provider rollback.

Rollback source/config/provider selection while preserving current domain databases, sources, revisions, artifacts and effect receipts. Do not restore old business data over newer contact corrections, financial acceptance or forgotten sources. Reconcile any uncertain operation through its owning receipt before repeating it. Temporary isolated test overrides must be removed before ordinary runtime restoration; fixture state is evidence, not data to promote.
