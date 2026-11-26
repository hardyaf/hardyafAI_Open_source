# OpenClaw ecosystem review November 4 2026

This is the retained audit snapshot before the authorized reliability work. See
[the implementation record](household-reliability-implementation.md) for the eight-gap
and restriction follow-through, and [current status](current-status.md) for actual
deployment and acceptance. Findings below are not a current missing-code list.

## Recommendation

Keep stock OpenClaw and adapt specific interaction, recovery and context-management concepts through the existing Jarvis owners. The reviewed forks do not justify a runtime migration. Several independent projects offer useful examples, but none supplies the complete family, privacy, financial and durable-task contract in our design.

The best immediate references are native OpenClaw for approval/delivery integration, NanoClaw for trusted question responses, Nanobot for delivery/recovery semantics, and Homeclaw for reducing skill-selection paperwork. Lossless Claw deserves an isolated context-recovery comparison. Home Assistant, Moltis and IronClaw provide useful supporting patterns.

This is a targeted static comparison of seven verified GitHub forks plus selected plugins and independent implementations against the household design and build audit. It is not an exhaustive review of every GitHub fork, a security certification or a Jarvis/Qwen compatibility test. Repository code and installers were not executed, and no runtime was changed. Commit-pinned links identify the inspected implementation; README reliability claims were not treated as acceptance evidence.

## Start with native OpenClaw

Our installed release is 2026.9.8. Its public tag resolves to `fc23bc864e4553c2d215e479eeec47b67a0bf943`. The pinned source already documents:

- Plugin permission requests through `plugin.approval.*`, including a `before_tool_call` approval result, channel/UI routing and resolution callbacks. This is the first integration seam to examine for our app-only approval envelope. Exec approvals and plugin approvals are different gates; neither automatically supplies the exact household question/resource binding.
- Native automation result delivery with `announce`, `webhook` and `none`, explicit conversation/session routing and separate ambiguous-delivery handling. Our wrapper's unconditional `delivery.mode = none` is not a native scheduler limitation.

Sources: [plugin permission requests at the installed tag](https://github.com/openclaw/openclaw/blob/fc23bc864e4553c2d215e479eeec47b67a0bf943/docs/plugins/plugin-permission-requests.md), [automation delivery at the installed tag](https://github.com/openclaw/openclaw/blob/fc23bc864e4553c2d215e479eeec47b67a0bf943/docs/automation/cron-jobs/delivery.md).

Use those native facilities while retaining our current identity, protected approval route, audience, exact operation and effect receipt. Durable household clarification can remain in the existing question/checkpoint owner. A channel approval callback must not turn a model-authored boolean into human authority.

The latest stable release observed was [2026.10.10](https://github.com/openclaw/openclaw/releases/tag/v2026.10.10), published November 2 Eastern (November 3 UTC). Its existence is not an upgrade recommendation: our native plugin and source-lifetime hooks need a targeted compatibility check. The useful approval/delivery seams above are already documented in our pinned release. Search results for the former upstream TaskFlow runtime are stale: its old documentation path is absent in that tag and the [pinned SDK guide](https://github.com/openclaw/openclaw/blob/fc23bc864e4553c2d215e479eeec47b67a0bf943/docs/plugins/sdk-runtime.md) identifies the former Tasks surface as removed. Preserve current native goal/session ownership rather than designing against that old API. This removed upstream API is distinct from our application-owned task-flow questions and checkpoints.

## Ranked concepts to borrow

### NanoClaw for questions and approval responses

NanoClaw persists a question identifier, checks the responding actor and channel context, claims a pending decision before invoking its owner and wakes the original session. Durable-provider reconciliation compares stored questions with the provider's current pending state. These are good examples for making a Discord response usable without asking Main to copy approval identifiers.

Adapt this interaction contract into our existing question/approval authority. Preserve the configured protected approval destination and original task/resource/operation. The inspected implementation uses typed/card responses; it does not prove unrestricted freeform approval anywhere. Recovery is conditional: its non-durable provider branch honestly reports that restart ended the original request.

Sources: [question surface](https://github.com/qwibitai/nanoclaw/blob/6ea946b7c74d694eb7d20f8e11cad49e3274028f/src/channels/ask-question.ts), [response handler](https://github.com/qwibitai/nanoclaw/blob/6ea946b7c74d694eb7d20f8e11cad49e3274028f/src/modules/approvals/response-handler.ts), [provider reconciliation](https://github.com/qwibitai/nanoclaw/blob/6ea946b7c74d694eb7d20f8e11cad49e3274028f/src/gateway-approval-coordinator.ts).

MIT; inspected commit `6ea946b7`. Independent implementation, not a GitHub fork. Its documented local Ollama path uses Claude Code/Anthropic compatibility, so it is not a replacement for our native Ollama transport. Do not borrow its four-unscripted-runs-per-day scheduling restriction.

### Nanobot for scheduled delivery and interrupted tools

Nanobot binds scheduled work to the originating session and delivery target. Delivery has explicit pending/sending/sent/failed/unknown states; an interrupted send is not blindly repeated. Recovery retains completed tool results and marks unresolved calls interrupted/unknown instead of executing them again. These distinctions fit our existing effect and delivery boundaries.

Use this as a state/test reference when exposing native announcement delivery. Keep execution completion separate from recipient delivery. Its outbox is not a reason to create another queue beside our current ledger and native delivery owner. Its missed schedules are not replayed, its iteration-limit continuation waits for another user request, and its shared project-memory model does not meet four-person privacy.

Sources: [bound scheduled runner](https://github.com/HKUDS/nanobot/blob/ce3aa50e70f6550d7be19f73f2cfa2ba6fb66880/nanobot/cron/bound_runner.py), [delivery state](https://github.com/HKUDS/nanobot/blob/ce3aa50e70f6550d7be19f73f2cfa2ba6fb66880/nanobot/channels/outbox.py), [tool recovery](https://github.com/HKUDS/nanobot/blob/ce3aa50e70f6550d7be19f73f2cfa2ba6fb66880/nanobot/session/recovery.py), [documented recovery limits](https://github.com/HKUDS/nanobot/blob/ce3aa50e70f6550d7be19f73f2cfa2ba6fb66880/docs/automations.md).

MIT; inspected commit `ce3aa50e`. Independent implementation. Its Ollama integration uses an OpenAI-compatible transport; Jarvis equivalence was not tested.

### Lossless Claw for context recovery

This OpenClaw context-engine plugin keeps original messages, creates linked summary levels and assembles a bounded prompt from recent messages plus summaries. Expansion tools can recover original details. The useful concept is recoverable, source-linked compression, with measured active-context budgets. It addresses lost conversational detail; task authorization and completion still belong to our existing owners.

A limited experiment should compare built-in context handling and the plugin on one forced-compaction task with recoverable facts, a human correction and a committed effect. Judge resumed completion and duplicate prevention, not a claim of perfect memory.

Important integration limits: the plugin retains another SQLite conversation store; it must not silently become a second canonical family memory authority. Its non-delegated retrieval accepts explicit conversation IDs and an all-conversations mode, so our family authorization must constrain any exposed retrieval. Declare transcript retention, correction and deletion behavior. The package declares minimum OpenClaw 2026.9.2 but lists specific tested versions 2026.9.4/5, which is not proof of compatibility with our 2026.9.8 hooks or Qwen setup.

Sources: [context assembly](https://github.com/Martian-Engineering/lossless-claw/blob/c3745b0e6ee5e23dcce8c55cca5c3f9e8ec51d62/src/assembler.ts), [compaction](https://github.com/Martian-Engineering/lossless-claw/blob/c3745b0e6ee5e23dcce8c55cca5c3f9e8ec51d62/src/compaction.ts), [retrieval scope](https://github.com/Martian-Engineering/lossless-claw/blob/c3745b0e6ee5e23dcce8c55cca5c3f9e8ec51d62/src/tools/lcm-conversation-scope.ts), [compatibility declaration](https://github.com/Martian-Engineering/lossless-claw/blob/c3745b0e6ee5e23dcce8c55cca5c3f9e8ec51d62/package.json).

MIT; inspected November 2 commit `c3745b0e`. A plugin, not an OpenClaw fork. It does not solve our topic/journal rollover by itself.

### Homeclaw for household context and simpler skills

Homeclaw is the closest household product comparison. Its loop activates a tool's matching skill automatically; its context builder separates personal and shared information and supplies compact relevant household data. Relationship-aware contacts provide a useful reference for linking our Rolodex IDs with wiki knowledge about people.

Adapt automatic skill/context loading through our existing loader, with required context available before consequential execution. Do not copy its confirmation mechanism: the inspected guard records a tool as confirmed while asking for permission, allowing a repeated model call to pass without a fresh human response. Its memory description also encourages shared password storage, contrary to our Bitwarden boundary.

Sources: [loop and lazy skills](https://github.com/Jayphen/homeclaw/blob/abc69644db2ea3c650972de4437d078646a76efc/homeclaw/agent/loop.py), [household context](https://github.com/Jayphen/homeclaw/blob/abc69644db2ea3c650972de4437d078646a76efc/homeclaw/agent/context.py), [contacts](https://github.com/Jayphen/homeclaw/blob/abc69644db2ea3c650972de4437d078646a76efc/homeclaw/contacts/models.py), [tool policies](https://github.com/Jayphen/homeclaw/blob/abc69644db2ea3c650972de4437d078646a76efc/homeclaw/agent/tools.py).

Independent Python runtime; inspected June 10 commit `abc69644`, version 0.33.6. Pyproject declares MIT, but no root license/detected GitHub license was observed. Verify licensing before source reuse; retain the design concepts meanwhile. Its contact/memory stores and runtime should not replace ours.

### Moltis and IronClaw for proportional policy and recovery

Moltis separates permission level from how often to ask. It also resolves approval notifications to the originating channel and separates cron delivery errors from agent completion. Borrow the policy distinction and media-adapter shape; its pending approvals use an in-memory map, so do not infer durable human waits.

Sources: [Moltis permissions versus prompting](https://github.com/moltis-org/moltis/blob/8a12400dc10551dfb9a6b568414b91a343ef2d5d/crates/tools/src/approval.rs), [channel approval routing](https://github.com/moltis-org/moltis/blob/8a12400dc10551dfb9a6b568414b91a343ef2d5d/crates/gateway/src/approval.rs), [bounded inbound media](https://github.com/moltis-org/moltis/blob/8a12400dc10551dfb9a6b568414b91a343ef2d5d/crates/channels/src/media_download.rs). MIT; October 23 commit `8a12400d`; independent Rust implementation.

IronClaw provides a related eligible-auto-approval policy that preserves missing grants and explicit denials. Its restart recovery distinguishes settled child results, appended results and attention still awaiting scheduling. Borrow the recovery cases and explicit policy classification, with the full authorizer traced before porting. Retain our existing native registry and permission owners rather than importing its journal/capability/credential stack.

Sources: [eligible auto-approval](https://github.com/nearai/ironclaw/blob/b0b999d96781516ee05e6ba961d6f3ead900da96/crates/kernel/ironclaw_approvals/src/auto_approve.rs), [recovery edges](https://github.com/nearai/ironclaw/blob/b0b999d96781516ee05e6ba961d6f3ead900da96/crates/loop/ironclaw_turn_runner/src/subagent/await_edge/boot_recovery.rs). Apache-2.0; inspected default-branch commit `b0b999d9` is dated September 10 despite November 4 repository pushes. Independent implementation; push time alone does not establish the contents of a release.

### Home Assistant and Clawdia for the app and kitchen

Home Assistant's trusted conversation/device/user envelope, permission-checked typed LLM API and canonical to-do subscriptions are mature architectural references. Adapt them through our existing conversation identity and list/event projections. Conversation IDs alone do not establish durable task recovery, and another Home Assistant task/list backend is unnecessary for these concepts.

Sources: [conversation envelope](https://github.com/home-assistant/core/blob/718d339224d99326c7cbb7bb92bcd85366f74656/homeassistant/components/conversation/models.py), [authorized LLM API](https://github.com/home-assistant/core/blob/718d339224d99326c7cbb7bb92bcd85366f74656/homeassistant/helpers/llm.py), [canonical to-do subscriptions](https://github.com/home-assistant/core/blob/718d339224d99326c7cbb7bb92bcd85366f74656/homeassistant/components/todo/__init__.py). Apache-2.0; inspected November 4 Eastern dev commit `718d3392`.

Clawdia contributes useful touch-oriented rows, assignee chips, source badges and day/week organization. Its MongoDB stores, global bearer key and PIN-based access are not a fit for our domain/device ownership. Borrow original UI ideas only; its shared shopping checkmarks are local component state, not proof of durable multi-device completion.

Sources: [Clawdia to-do UI](https://github.com/ririgriff/clawdia-home-kiosk/blob/f777da49e206fe149da88be9267e716e6639a81a/components/TodoList/index.tsx), [shopping UI](https://github.com/ririgriff/clawdia-home-kiosk/blob/f777da49e206fe149da88be9267e716e6639a81a/components/ShoppingView/index.tsx). Independent implementation; May 4 commit `f777da49`; license not identified.

## Verified OpenClaw forks

The following repositories are actual GitHub forks. Dates identify observed repository pushes or commit-feed head dates, as labeled; they are not maintenance guarantees. None is a replacement recommendation.

| Fork and source pin | Observed activity | Useful concept | Exclude from adoption |
| --- | --- | --- | --- |
| [dzianisv/openclaw](https://github.com/dzianisv/openclaw/tree/fb6bc737cf03b93bb89bd27266fb57de4d7c42bc) — MIT | August 4 push | Thinking-only replies, missing usage data, oversized history and interrupted-session regression cases. | Automatic startup replay is based on transcript tails and a fresh batch key, not our domain-effect reconciliation. |
| [DenchClaw](https://github.com/DenchHQ/DenchClaw/tree/f14eb4c239002d7b28673c60955b689b9d69db22) — MIT | June 11 push | Parent/child UI, tabs, reconnect and visible work state. | Old JSON registry integration and treating ended non-error runs as completed; current CLI/cloud direction is not our local stack. |
| [optimized-claw](https://github.com/ashneil12/optimized-claw/tree/bf730fe9f75d8b380c589a890e3a72a405e7bac1) — MIT | March 28 push | Structured diagnostic fields and compact progressive skill disclosure. | Automatic repair/skill evolution and broad tool exemptions. |
| [LocalClaw](https://github.com/sunkencity999/localclaw/tree/10fa0e9265d0632eb225568ce2db5d5050a8f18c) — MIT | February 21 push | Readable local-model readiness/routing information. | Keyword routing, automatic cloud escalation and executing tool calls parsed from prose. |
| [EdgeClaw](https://github.com/OpenBMB/EdgeClaw/tree/5e461861b370f5677d2eb6b35499764632989279) — MIT | April 15 push | Context-budget inspection ideas. | The inspected compactor produces a count/timestamp placeholder with a fixed reduction estimate; tool governance uses substring/default-allow decisions and extra approvals. |
| [SybilClaw](https://github.com/rdevaul/sybilclaw/tree/41c26071270ee50de283f126dba21c58aca6d779) — MIT | July 2 head | Shared assistant personality with person-specific and household facts; useful family UX/design reference. | Bootstrap memory-file/prefix selection does not establish authorization across every file/memory tool. Its advertised ContextGraph is still an early design, with expected implementation paths absent at this pin. |
| [NOVA](https://github.com/NOVA-Openclaw/nova-openclaw/tree/16eac5e192115670e9b15c308957a0d9093c7976) — MIT | November 3 head | Explicit agent/session identity passed into a memory adapter. | The inspected fork supports a separate nova-mind system; synthetic bootstrap references are not proof of that system's memory or household correctness. |

Representative source: [dzianisv recovery tests](https://github.com/dzianisv/openclaw/blob/fb6bc737cf03b93bb89bd27266fb57de4d7c42bc/src/gateway/server-startup-stuck-session-replay.test.ts), [Dench registry projection](https://github.com/DenchHQ/DenchClaw/blob/f14eb4c239002d7b28673c60955b689b9d69db22/apps/web/lib/subagent-registry.ts), [structured diagnostic journal](https://github.com/ashneil12/optimized-claw/blob/bf730fe9f75d8b380c589a890e3a72a405e7bac1/src/logging/error-journal.ts), [LocalClaw prose executor](https://github.com/sunkencity999/localclaw/blob/10fa0e9265d0632eb225568ce2db5d5050a8f18c/src/agents/pi-embedded-runner/text-tool-calls.ts), [EdgeClaw compactor](https://github.com/OpenBMB/EdgeClaw/blob/5e461861b370f5677d2eb6b35499764632989279/extensions/clawxgovernor/src/assembler.ts).

Additional pinned evidence: [Sybil bootstrap selection](https://github.com/rdevaul/sybilclaw/blob/41c26071270ee50de283f126dba21c58aca6d779/src/agents/workspace.ts), [Sybil ContextGraph design](https://github.com/rdevaul/sybilclaw/blob/41c26071270ee50de283f126dba21c58aca6d779/docs/sybilclaw/context-graph-architecture.md), [NOVA bootstrap adapter](https://github.com/NOVA-Openclaw/nova-openclaw/blob/16eac5e192115670e9b15c308957a0d9093c7976/src/agents/bootstrap-files.ts), [NOVA identity adapter](https://github.com/NOVA-Openclaw/nova-openclaw/blob/16eac5e192115670e9b15c308957a0d9093c7976/extensions/agent-identity-env/index.ts). The Sybil observation is a limitation of the inspected evidence, not a reproduced privacy vulnerability.

## Additional references and exclusions

- [Graphiti](https://github.com/getzep/graphiti/blob/fb60e59d4a208c99e7d0186ee6335d2a257f17f2/graphiti_core/edges.py) distinguishes supporting episodes, observation time and valid/invalid time. This is a useful later enhancement inside our memory lifecycle, after rollover and ordinary correction are reliable. Do not add a graph-store authority or use a partition ID as family authorization. Apache-2.0 at the inspected November 3 commit.
- [The Family Claw](https://github.com/zagrodzka-maria/the-family-claw/blob/161c1c11118c84d0049f574a468497740bea0049/extensions/group-orchestrator/index.js) illustrates one primary family responder. Its in-memory rounds, global coordination Markdown, regex routing and custom Gateway messages are unsuitable. Suppressing replies after processing does not prevent duplicate business actions. Independent configuration/plugin example; April 6, seven commits, license not identified.
- [Physiclaw](https://github.com/CommanderZed/Physiclaw/tree/a2d86f840036d82199b290ca0fb425c15b88ba94) is OpenClaw-derived but GitHub marks it independent, not a direct fork. Its air-gapped direction does not itself solve our durable household interaction gaps. Apache-2.0; February 21 snapshot.
- Hermes provides a useful small [clarification surface](https://github.com/NousResearch/hermes-agent/blob/main/tools/clarify_tool.py), including explicit answered/skipped/undelivered outcomes. However, the inspected [Gateway waiter](https://github.com/NousResearch/hermes-agent/blob/main/tools/clarify_gateway.py) stores entries in module-level dictionaries and waits on thread events. Borrow UI/result distinctions, not that mechanism as restart-safe persistence. This was a targeted current-source comparison, not a full Hermes audit; MIT.

## Integration map and work order

| Work | Existing owner to adapt | Borrowed concept and acceptance |
| --- | --- | --- |
| Questions and approvals | Existing application task-flow questions/checkpoints, native plugin approvals and trusted Discord adapter | Channel-neutral question/result shape, exact actor/question/action binding and honest restart disposition. Test freeform clarification separately from consequential approval. |
| Scheduled results | Existing native scheduler/delivery and application effect/delivery receipts | Capture the destination once; distinguish execution from delivery; never blindly resend unknown outcomes. No additional outbox authority. |
| Skill loading | Existing catalog/loader and execution-grant context projection | Load only the matching authorized context mechanically; remove another selection ritual while retaining schema/permission checks. |
| Context recovery | Existing native context/session owner | Linked summaries and expandable source detail. Any plugin store needs explicit ownership, privacy, retention and migration/deletion rules before adoption. |
| Diagnostics | Existing native events/effects and redacted diagnostic evidence | Structured subsystem/error/context fields, occurrence counts and targeted failure cases; no automatic repair. |
| Household memory | Existing captured sources, native wiki and claim lifecycle | Compact scoped context and later temporal validity. Indexes/summaries remain derived from their named sources; no second fact store. |
| App and kitchen | Existing household API, device grants, canonical lists/calendar and output publication | Clear waiting/active/completed views, household grouping and subscriptions. No new editable kiosk database. |

Start by exposing native approval/delivery features and simplifying questions/skill loading. Then add the targeted context/restart cases and evaluate Lossless Claw only if the built-in path still loses necessary details. UI and temporal-memory enhancements can follow the current implementation gaps. Use the existing consolidated campaign and re-run affected cases rather than introducing another rollout process.

No reviewed project establishes our financial receipt policy, fresh OCR redo, journal rollover, Bitwarden writeback or four-family acceptance as a ready-made drop-in. Retain the current Uplift, Contacts, memory and identity owners. These recommendations concern concepts and narrow adapters; this review changes no runtime or domain implementation.
