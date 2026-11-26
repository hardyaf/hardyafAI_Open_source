# Household design decisions

Updated November 4, 2026. This log records product intent; [current status](current-status.md) records what exists. Mechanisms remain proposals until implemented and accepted.

| ID | Decision | Consequence |
| --- | --- | --- |
| D01 | Continue stock OpenClaw in this project. | Reuse native sessions, tasks, successor turns, compaction and scheduling; keep the retired native engine inactive. |
| D02 | Clear brain-dump actions execute; uncertainties clarify. | Bind questions to the task/item and report partial completion truthfully. |
| D03 | Invite only named recipients or an agreed recipient rule. | Managing the household calendar does not mean automatically inviting both adults. |
| D04 | Local OCR is the default; cloud exceptions require approval. | Uplift's current cloud adapter cannot silently become the household default. |
| D05 | Save every business card and report it. | Uncertainty is stored visibly and does not block saving. |
| D06 | Saved card fields change only in response to a prompt. | No silent auto-correction, merge or background reinterpretation. |
| D07 | A card response is a normal prompt. | Redo OCR, corrections, context or a new request use ordinary conversation and an exact card/contact binding. |
| D08 | Local Rolodex first, Google Contacts later. | Select one local contact authority; wiki pages link to it. |
| D09 | Automatically retain clear facts; keep uncertain inference as candidates. | Wiki curation preserves source/date/audience and handles correction/forget. |
| D10 | Explicit operator-requested diagnosis cannot apply a fix. | Enforce operational read-only tools; a later repair needs a separate instruction. |
| D11 | Bitwarden is the external secret store. | Reuse native secret resolution; connectors receive selected credentials and the model receives results. |
| D12 | Preserve prior choice to defer arbitrary tool/turn caps. | Track headroom/progress, retain cancellation and native resource safeguards. |
| D13 | Ordinary personal email sending should not need blanket per-message confirmation. | Prior owner intent; actual sending still needs a granted capability and requested/standing recipient/body authority. |
| D14 | Private and shared audiences remain distinct. | Adult private information and diagnostic artifacts do not become household-public by being indexed or displayed. |
| D15 | V1 brain dumps use a dedicated household Discord channel. | The channel is shared entry context; replies continue pending task/question bindings. |
| D16 | Scanned cards default to the shared household Rolodex. | Name that destination in the save report; do not share unrelated source conversation history. |
| D17 | Clear receipts accept automatically; unresolved uncertainties enter visible review. | Processed is execution progress; provisional and accepted describe a persisted revision's financial disposition. |
| D18 | Uplift integration is reasoning-led. | Main chooses composable operations and may analyze/revise with Python; deterministic code owns grants, validity, transactions and acceptance receipts. |
| D19 | Build all planned functionality before functionality testing. | Group overlapping work into three integration slices with deployment/startup smoke checks, then run one consolidated functionality campaign after the complete build. |
| D20 | Build in three integration slices, starting with Slice 1. | All three build/startup slices are now deployed; functional acceptance is tracked separately in current status. |
| D21 | Reduce unnecessary bookkeeping and rigidity while retaining real authority and effect-integrity boundaries. | Main owns semantic interpretation and replanning. Existing application/domain owners should automate internal references, evidence association, progress and completion mechanics; concrete changes follow the complexity audit. |
| D22 | Evaluate a stronger local Main, with Qwen3.8 27B as the next candidate, alongside protocol simplification. | Use fixed preserved cases and supported provider compatibility before promotion. Provider/model changes and the fixed-case comparison are recorded in current status; an installed model alone is not a promotion decision. |
| D23 | Implement the eight concrete reliability gaps using the existing owners. | Questions/side topics, Discord media, native notices, read-only evidence, memory growth, calendar comparison, fresh OCR and credential lifecycle extend the current system rather than replacing OpenClaw. |
| D24 | Routine skill loading and mechanical references belong to trusted code. | First use injects the authorized current contract before effects. Selection remains optional; hidden compatibility verification/finish tools do not add model ceremony. |
| D25 | A fresh adult display request authorizes eligible exact household outputs. | Completed or other-chat owned household outputs need no duplicate confirmation. Private, financial, diagnostic, child and scheduled publication retain their exclusions. |
| D26 | Ordinary questions and analysis do not need an artificial goal. | Bind semantic replies to durable question/source authority; analysis uses exact existing request/child/artifact receipts. One formal native goal per conversation remains the V1 limit. |
| D27 | Recoverable list removal needs no second approval. | A current authorized removal request plus owner receipt suffices; destructive external effects retain their own policies. |
| D28 | Diagnosis may retain bounded passive operational evidence. | Existing private artifacts hold redacted metadata bound to the exact source/run; diagnosis remains explicitly requested and cannot repair itself. |

The reminder queue policy is provisionally `finish_accepted`: authorization is
rechecked before new native message preparation, and an immutable notice already
accepted by the native outgoing queue may finish. Scheduling stays disabled.
The installed native SDK cannot recheck authority on each durable replay;
`recheck_each_attempt` therefore prevents activation. This is an explicit product
limit, not a claimed revocable queue or permission to turn scheduling on.
See [scheduled-notice authorization](scheduled-notice-authorization.md).

## Open product questions

- Initial standing calendar/attendee rules.
- Contact editing roles and explicit exceptions to the shared-household default.
- Initial receipt report profiles, project mappings and any explicit exception rules; state semantics are settled in the [receipt policy](receipt-acceptance-policy.md).
- Initial kitchen views and whether the physical client needs touch/input.
- Diagnostic phrase/action and default target selection.

## Technical validation required

- Native memory-wiki per-agent/private and shared-corpus routing without using privacy metadata as access control.
- Consecutive child/parent phases and interruption recovery using native goal/registry ownership.
- Supported secret-resolution fields and provider refresh-token writeback.
- Headless local receipt OCR quality and Uplift correction/review behavior.
- Image intake and field evidence for card photos.
- Analysis environment, task artifact delivery and display-safe formats.
- Current app admissions and event privacy repairs.

Keep these questions explicit. Do not turn a proposed mechanism into a deployed claim or use a missing detail to add approval to every routine authorized action.

## November 16: narrow Fitbit sync control

Use signed self-scoped device controls over native systemd sessions. The official Google Health app owns physical sync; the original AVD owns login/bond state. Standalone controls use device-bound receipts in the existing application database because native domain effect receipts require a conversation/source prompt. Do not fabricate a chat or add a queue. A started session is not proof of synced data. API views require separately consented read-only Google Health grants through the existing trusted Bitwarden connector. See [Fitbit control](fitbit-sync.md) and [data access](fitbit-health-data.md).

The HTTP service/UI release version is independent of the native OpenClaw boundary contract. Keep the strict native compatibility comparison and its existing 0.7.0 contract for this HTTP-only feature; advancing it would require a coordinated native rollout.

The optional HTTPS listener is a transport over the same HTTP application and nonce ledger. Browser device keys remain scoped to the existing personal profile. Protected PEM loading and owner-installed public trust avoid distributing the deployment SSH key to family computers.
