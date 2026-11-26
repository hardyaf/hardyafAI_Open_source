# Native task hooks and local analysis

The original three-slice 0.5 baseline is deployed. Ordinary services are restored with the original model, shared canonical domain authority and disabled scheduling; the implemented 0.6 candidate is not yet promoted. [Current status](current-status.md) owns the latest release/check totals and acceptance; the protected deployment receipt owns immutable release identity. Partial effects do not accept complete task delivery. The [simplification record](bookkeeping-simplification-implementation.md) describes subsequent interface changes. Dated counts below remain historical component evidence; current status owns the latest results.

## Ordinary configuration authority

Native plugin and control now point to the same canonical domain configuration. The former R7 staged file was semantically identical to canonical content, but retaining a second active path could have caused later permission drift. The existing generator accepts `--domains-active-path`, defaulting to its output for isolated candidate pairs and accepting the canonical domain path for ordinary preparation. Collision/outside-home rejection preserves inputs. Promotion passes and verifies the canonical path for both consumers.

The ordinary 0.5 baseline delta recorded here is limited to that authority pointer, global `tools.updatePlan=true`, and `progress_card` appended to main/Natasha adult allowlists. Canonical domain/control bytes, ordinary models, Google/Discord/authentication/sandbox/identity policy and 11 disabled jobs remain unchanged. Native CLI validation and ordinary readiness passed. This repairs availability/authority configuration; it does not certify model-led completion or promote the failed Qwen comparison.

## Native bridge

`plugins/household-domains/native-task-hooks.mjs` registers supported public native hooks and V2 typed tools. Root composition supplies `isManagedAgent(agentId,sessionKey)`, synchronous `catalog(context?)`, `execute`, `admitNativeTurn`, `registerNativeChild`, `getTaskContext`, `prompt`, `finalize`, `guard` and `bootstrapAccess`. Optional `end` and `afterTool` observe existing native settlement/receipts. Bridge-instance telemetry is transient; exact one-use invocation proofs are projected into the existing native execution-grant row. Root SQLite admission and native execution remain durable authority. `catalog()` without context must return the static complete tool name list during plugin registration, even before resources initialize.

The global trusted policy id is `hardy-household-task-boundary` and must be declared in the plugin manifest's `contracts.trustedToolPolicies`. It covers deferred, retained and raw tools, with root policy checking current source identity, same task lineage, native control, private/shared audience and sticky diagnosis on every call. The bridge preserves native V2 `assertInvocationCurrent`, exact current run, exact toolCallId and argument fingerprint. It never fabricates identity from model text.

Enable `plugins.entries.hardy-household.hooks.allowConversationAccess: true` and `allowPromptInjection: true`; the helper rejects missing permissions. `before_model_resolve` and `agent_turn_prepare` call idempotent source admission before policy/tool construction. The ordinary `before_prompt_build` stage rechecks exact current-user input and restores conductor instructions, domain context and tool exposure. Pinned SDK 2026.9.8's authorized prompt stage discards system-context and `toolsAllow` fields, so it cannot carry this projection. Native `hookInvocation` lifetime checks fence the ordinary projection before and after asynchronous work; they do not grant effect authority. A bounded per-run pending/rejection latch denies tools and older-source fallback across hook errors/timeouts; rejected prompts expose no tools, trusted policy rejects actual/deferred invocations, and exact V2/source/effect guards independently recheck every operation. A rejected turn can produce a refusal but has no operational authority.

Do not register global `before_agent_run`, `before_dispatch`, `before_message_write` or `reply_dispatch` hooks as a replacement run gate. Pinned native 2026.9.8 lists these as restart-unsafe in `chat-send-handler-EwrCzZoZ.mjs` and rejects atomic goal start/resume whenever the applicable hook is present. The real campaign exposed this incompatibility; removing the global run hook restores the supported native goal path while retaining every source, policy, native allowlist and per-call effect fence. Regression tests prove absent unsafe registrations and denial under missing, failed and pending admission. No native code is modified.

Native source observation does not grant authority. `before_model_resolve` has
prompt and attachment fields. `agent_turn_prepare` adds prepared history and
queued injections. `before_prompt_build` has optional `currentUserMessage` and
`currentUserMessageId` fields. Stock embedded Discord turns on 2026.9.8 and
2026.9.9 omit these fields and trusted input provenance. An explicitly empty
current message is valid exact input. Root must match mapped native Discord
channel, account, destination and sender, or an authenticated app source, or an
owning scheduled-job grant. Missing provenance never establishes human origin.
Content, role tags, quoted documents and a native user trigger grant no
authority. A continuation uses its existing native lineage.

### Discord source evidence and queue upgrade

OpenClaw owns Discord ingress, the exact message ID and original content, the
native run and the reply queue. Jarvis reuses its submission and artifact owners
for the bound request, and its existing execution grant for household effects.
The staged bridge defers incomplete early Discord observations and requires
`external_user` provenance, an exact current message ID and exact current text
by final prompt admission. A media binding must match that same provider ID.
The bridge never uses the assembled prompt or the preceding submission as
current source evidence. This preserves the existing app, scheduled and internal
lineage paths.

In loopback on stock 2026.9.8 and 2026.9.9, `message_received` had the provider
message ID and original content without a run ID. The supported prompt hooks
had the run and route without an exact current message. A fresh session can have
no prepared history. A later persisted message is too late for admission.
Adjacent turns can have identical text, so order and text matching cannot prove
the source. The unsafe global hooks above would also break durable goal restart
on the pinned runtime.

A private test-only native overlay on both versions projected the current
OpenClaw input recorder's exact Discord message ID, original text and
`external_user` provenance into the existing prompt hook fields. Synthetic
Discord and a loopback model proved the hook handoff and a simulated tool call.
With the real Jarvis plugin, both overlays settled three distinct mapped
requests in one native session. The two identical messages and the new topic
each had their own source record and original-text artifact, tied to the exact
provider message ID, sender and native run. An unmapped sender created no
source record or artifact. The stock 2026.9.9 control produced no verified
household source for these turns. All three loopback configurations sent each
of the four synthetic replies referencing its own exact provider message.
The messages arrived sequentially. Short natural-language follow-ups, overlapping
delivery and real model interpretation remain open. The unmapped-author test
shares a synthetic channel session, so earlier native transcript entries remain
visible to the model. Channel access and session routing own transcript isolation.

On both overlays, Lists discovery returned no results for the first request
in a new session. Later requests found the tool and read the personal list
through the real Jarvis tool after the normal skill-load retry. A separate 2026.9.9
overlay moved the same verified source to `before_model_resolve`. Lists read
then passed on all three mapped turns, including the first fresh request.
The unmapped turn still had no household authority. All four synthetic reply
bodies arrived, but the second had no matching Discord reply reference and
the native runtime emitted a delivery-uncertainty notice. The fixture waits
for agent completion between requests, which can precede Discord delivery.
The source evidence and list reads stayed correct. Outbound reply settlement
needs a separate acceptance case.
The overlay is evidence for a supported native fix and has no production
deployment path under the [stock runtime plan](household-assistant-implementation-plan.md).
A supported runtime must expose that same evidence before Jarvis can admit
Discord household actions. Inspection of the official 2026.11.1 package and
release source found the same omission in the built-in runner. Its
`before_agent_run` gate runs after prompt preparation and still receives no
exact current message identity.
[Tagged prompt construction](https://github.com/openclaw/openclaw/blob/v2026.11.1/src/agents/embedded-agent-runner/run/attempt-prompt-build.ts#L150-L175),
[hook forwarding](https://github.com/openclaw/openclaw/blob/v2026.11.1/src/agents/embedded-agent-runner/run/attempt-prompt-helpers.ts#L45-L82) and
[run gate payload](https://github.com/openclaw/openclaw/blob/v2026.11.1/src/agents/embedded-agent-runner/run/attempt-before-agent-run.ts#L23-L50).

OpenClaw 2026.9.9 also ships an independent queue change in the separately
installed Discord adapter. Stage core and adapter together. Both the installed
2026.9.7 and official 2026.9.8 adapter lack that change. The candidate core,
matching adapter and gateway client/protocol staged together pass the component
checks. Queue release alone supplies no source evidence.
[OpenClaw release](https://docs.openclaw.ai/releases/2026.9.9) and
[upstream Discord queue change](https://github.com/openclaw/openclaw/pull/159265).

`subagent_spawned` event `runId` identifies the child; hook context `requesterSessionKey` identifies its parent. Root validates native owner state and adds its existing per-execution ACL projection before child tools can execute. If publication is delayed or fails, all child household tools remain denied until the owning native lineage can be proven. The bridge does not create a child registry or queue.

`agent:bootstrap` scrubs all bootstrap records synchronously before a fallible policy lookup. Only a proven private family execution can restore its original files. Shared, unknown and restricted helper contexts receive no personal USER/MEMORY/daily bootstrap. Root supplies current audience policy; later managed memory tools enforce the same audience. This avoids copying a family member's private bootstrap into a shared native session or replacing OpenClaw's complete system prompt.

### Short follow-up and overlapping Discord turns

On the private early-source 2026.9.9 test copy, local Qwen3.8 27B completed
four synthetic turns in 48 seconds. It acknowledged the initial message,
recalled the fictional name after a literal `lol`, switched to an arithmetic
topic and handled a correction. Each inference received the exact current
Discord message ID and text and the available prior turns. The simulator
accepted all four replies with the corresponding provider message references.
The sequential test waits for the exact agent run and the provider receipt
before posting its next input.

A separate transport fixture held an inference response open and injected two
more Discord messages. On 2026.9.9 stock and the private early-source copy,
native steering gave the model the newest text and provider ID, but it reused
the original run. The later reply also used the original Discord reply
reference. The evidence separates current model input from a stale reply
reference and missing independent household source. An isolated fake model
drove the overlap to make the ordering repeatable.

Setting the native per-channel `messages.queue.byChannel.discord` to
`followup` separated the two overlapping messages. Each got an exact current
model input, independent native run and one persisted reply. The private
early-source copy also kept separate Jarvis source artifacts. With stock
Discord adapter 2026.9.9, both queued replies omitted the provider reply
reference. The generic queued route supplies the native inbound ID, while
the Discord adapter lacks the resolver for turning it into an implicit
reference. Direct Discord replies already have their own reference owner.
[Native queue modes](https://docs.openclaw.ai/concepts/queue).

A second private adapter change uses that native inbound ID for ordinary
same-channel queued replies with `replyToMode: all`. Explicit references
and thread, `first`, `batched` and `off` behavior keep their existing paths.
The combined isolated candidate passed all five source, model input, output,
delivery and reference checks. Two messages arrived while inference was held.
Each stored one reply with the correct Discord message reference and native
outbound ID, and the simulator recorded zero uncertainty notices in that run.

Private upstream source drafts for the exact-message and reply-reference changes
apply individually and together to the pinned main and 2026.11.1 source bases.
The exact-message helper passed four focused stable tests. The runtime adapter
overlay passed twelve resolver assertions. Full upstream builds and runtime
acceptance of the draft source bases remain open. The rollout plan calls for a
stock release carrying the supported hooks and adapter behavior, followed by
the same source and reply checks on that release.

The earlier false delivery-uncertainty notice matches a separate upstream race.
New ingress can observe a prior reply before the provider acceptance is recorded
and send a warning about that already visible reply. OpenClaw has merged a fix.
The fix is in official 2026.11.5-beta.1 and main, while official stable
2026.11.1 and the September pins tested here lack that commit.
[Reported race](https://github.com/openclaw/openclaw/issues/154416) and
[merged delivery fix](https://github.com/openclaw/openclaw/pull/154417).

## Gateway and agent-worker resource ownership

`plugins/household-domains/native-runtime.mjs` is the pure composition helper shared by the thin plugin entry. Registration synchronously supplies safe static descriptors and executable wrappers before gateway services or worker hooks start, without constructing an owner or reading protected resources. Static schema/tool discovery is metadata, never authorization. Actual invocation/admission resolves the graph through one cached asynchronous `ensureOwned` operation per plugin process; concurrent hooks/tools share that initialization rather than constructing independent runtimes.

This adapts the existing composition boundary. Native agent workers do not run the gateway's service-start lifecycle. The real third campaign attempt admitted a native goal/run but could not construct current task context because the worker had no owner graph; it produced no execution grants or domain effects. Worker-local initialization fixes that lifetime mismatch using the same protected configuration and existing application database, ArtifactStore and native execution authorities. Gateway initialization status alone does not prove that an actual worker has initialized successfully.

| Resource | Lifetime/owner | Authority and retention |
| --- | --- | --- |
| Static descriptors and executor wrappers | Plugin registration | No owner I/O; execution still resolves current source and policy. |
| One owning resource graph | Cached composition helper per process | Existing DB/artifact/native authorities; no second engine, store, queue or schema. |
| Gateway resource lifetime | Existing registered service | Service start retains the graph until service shutdown/reload. |
| Worker resource lifetime | Active-run leases plus `agent_end` release | Transient process-local accounting, not durable work or authorization. |

Worker hooks/tools acquire the current run lease; `agent_end` releases it even when source admission was rejected. A worker graph closes only when no active run remains and the gateway service does not own its lifetime. A late end/release for run A cannot close run B's active resources. Shutdown/initialization generation checks close stale late initialization rather than reviving stopped resources. Releasing resources does not settle or authorize an older rejected source.

The same graph is used by native child registration, prompt/finalize hooks, actual tool calls and current-source guards. The existing native goal, run, session and checkpoint remain authoritative. Diagnosis mode, private/shared routing, trusted global tool policy, V2 invocation identity and every per-effect recheck remain unchanged. Missing/revoked source context still fails closed; lazy construction is not an authority fallback.

Ubuntu verified the combined lifecycle and ordinary-prompt correction with **24/24 focused tests** (12 hooks, 5 owner-lifecycle, 7 boundaries) and **167/167 backend tests**, zero failures/skips/cancellations. Coverage includes metadata/executor discovery before service start, worker-only/shared initialization, gateway versus worker cleanup, late run-A release while B is active, rejected-run release and ordinary prompt projection/lifetime. Subsequent diagnostic-only telemetry passed **25/25 focused tests** (13 hooks, 5 owner-lifecycle, 7 boundaries). The full 167 result belongs to the combined lifecycle/prompt stage; no later full-suite result or productive runtime acceptance is inferred from the diagnostic focused run.

The next actual productive phase admitted a native goal/run, obtained a source grant and reached inference. Its deferred `household_lists_capture` invocation was refused with `trusted_native_invocation_required`, before any domain effect or child. The exact signed operator pause succeeded and the driver ended. This is inspectable failure evidence, not a successful list workflow.

A controlled probe proved that native global policy/hook execution and deferred tool discovery used different bridge instances for the same exact opaque call hash. Content-free bridge/call telemetry distinguished that actual registry split from an argument/key mismatch; raw source, arguments and native IDs were not logged. The refused probe remained cancelled with zero effects/children. Native V2 lifetime/effect assertion is retained, but cannot alone supply exact run/call/argument proof. The approved correction below adapts the existing grant projection; it does not broaden household capabilities. That checkpoint did not certify original-goal completion; subsequent loads and remaining actual limitations are recorded below.

Rollback reverts the thin entry/composition helper and bridge projection together while preserving existing durable state and receipts. The composition-lifetime change itself adds no schema or background worker; the separately described bounded projections extend only the existing grant row. No independent queue or alternative memory/task authority is introduced.

## Exact invocation proof across native registries

The native global policy registry and the discovery registry may construct separate plugin bridge closures in one worker process. A closure-local receipt map cannot carry authorization reliably between them. Reuse the existing `native_execution_grants` authority through `ExecutionAuthorityRepository.invocations`: add only `invocations_json TEXT NOT NULL DEFAULT '[]'` to that table under the existing migration owner. There is no new store, table, queue, task ledger or process-global authority cache.

| Datum | Owner | Bounds and lifecycle |
| --- | --- | --- |
| Pending/consumed exact invocation projection | Existing native execution-grant row/repository | At most 256 live entries, 10-minute freshness; exact call/tool/argument hash/run/source/session lineage. |
| Current invocation/effect lifetime | Native V2 context | Required before proof consumption and each effect; not a replacement for exact proof. |
| Resource/source permission | Existing native/domain admission and guards | Current identity, source, root/parent/goal/mode, device/profile/resource scope rechecked. |
| Effect result/unknown outcome | Existing owning domain/effect receipts | Retained independently; a projection failure never authorizes blind effect retry. |

Only the trusted native tool policy, after allowing that exact current invocation, binds pending proof. The deferred factory checks native V2 lifetime plus current root/source scope and atomically CAS-consumes the matching one-use call/tool/arguments/run/source/session proof before execution. Existing guards recheck current authority at every effect. Consumed proof stays consumed across restart; expired, missing or stale proof cannot be revived by a bare V2 callback. Authorization of a later call requires a fresh trusted policy decision, not cached model/discovery metadata.

Changing the source, native run/session, root/parent, goal, mode or agent invalidates pending invocation proofs. An exact same-identity refresh preserves them. A child whose native session ID was initially absent can receive its first ID only through a current trusted policy and exact run/source/parent/root/goal/mode CAS. A null root session ID or a non-null mismatch is denied; this is not generic session rebinding.

Discovery-only composition instances use per-call resource leases and cleanup rather than waiting for another registry instance's `agent_end`. Concurrent calls share one graph while leased; one call finishing cannot close another active call. Global/gateway ownership retains its existing service/run lifetime. These leases manage resources, not permissions or durable work.

At the invocation-projection checkpoint, verification included **181/181 backend tests**, zero skipped/failed/cancelled, and startup syntax/import checks over **116 source files** on Ubuntu. The native-SDK projection tests execute the actual registered `trustedToolPolicies` phase with the installed SDK, rather than manually imitating only a hook. The projection helper has nine cases including the child-null-SID edge, and discovery-owner coverage includes overlapping calls. The two queued/source-capture role-downgrade regressions also pass: the existing child dispatch gate rechecks explicit message goal-start intent before native admission, not just task mode or UI exposure.

These checks prove component contracts and actual SDK policy plumbing. Subsequent actual runtime evidence and its remaining continuation boundary are recorded below. Rollback leaves the additive column for older readers to ignore and retains actual effect receipts; do not delete/clear authorization or financial/contact history to make a test pass.

## Native parent continuation after yield

The next actual phase committed the parent alpha effect and same-agent child beta effect, then used native yield and woke in a new announce run under the same original goal. Parent continuation correctly exposed `toolsAllow: []` with `native_request_lineage_not_authorized` because the public active-run projection was absent/stale at prompt construction. The exact fixture goal was paused; both committed effects and the child remain retained without replay or rollback. This establishes those runtime steps, not completed phase or analysis acceptance.

The narrow `native-scope` correction accepts an exact current trusted grant tuple (agent, root session, source, session generation, run and original active goal) alongside the existing public-run fallback. SDK/hook lifetime, mutable profile/device, source and control-watermark checks remain required. Real `NativeAdmission` inter-session coverage exercises the positive current-grant path with no public native run ID, plus wrong run/source/root/session/goal, paused-goal and stale-grant denials. Ubuntu backend verification passes **182/182**, zero skipped/failed/cancelled. At that checkpoint, subsequent reloads had reached later native steps without full phase/analysis completion. [Current status](current-status.md) records the later model results; this historical failure is not the current phase verdict.

## Child assignment and actual artifact transport

The subsequent real phase child received its beta assignment, but inherited root-objective/conductor text prompted parent-alpha repetition and recursive beta delegation. Exact root-goal control paused that case; effects and lineage remain retained. The child prompt now uses its current trusted native child task with a distinct conductor, removing root objective/outcomes/next action, automatic fact/brain-dump and parent orchestration text. It retains root/source/audience identity, selected capability contracts and diagnosis restrictions; parent projection is unchanged. No arbitrary depth cap or phase queue was added. Five real application/flow regressions bring Ubuntu backend evidence to **187/187**, zero skipped/failed/cancelled. A later reloaded phase still failed owning progress/completion checks; no complete phase or analysis pass follows from these component tests.

A no-inference signed client ACL run independently exposed duplicate differently cased `Content-Length` headers on artifact downloads. The narrow platform HTTP correction uses the existing canonical artifact headers once. A real HTTP byte/hash regression failed before the change and passes afterward for UTF-8, binary and empty content, retaining private cross-profile denial; affected platform checks pass **7/7**. The original fixture input remains committed, without another upload. Signed privacy/forged-output/publication-route checks pass four cases, including live exact owner download/hash of the retained input; actual private output/explicit publication still remain pending. An HTTP publication-bypass denial does not certify a fresh human native-tool publication grant.

## Completion truth without a source-bound goal

The no-goal memory case exposed a false completed receipt while an unwanted native goal remained active and unbound after the public run ID cleared. Native-end handling and maintenance now require exact current source/grant/goal proof. If the observed turn completes with no source goal binding but a current non-complete native goal, the source fails visibly with `native_goal_binding_missing`; session recency cannot grant ownership. Neither path adopts/cancels that arbitrary goal or replays effects. Legitimate ordinary follow-ups beside an old completed goal or no goal remain valid.

Maintenance rereads current receipt status/binding/run/timestamps after asynchronous native observation. Newer terminal decisions and replacement runs win. The legacy abort path requires fresh native context before calling an unbound source complete, otherwise it remains safely cancelled; HTTP targeted controls and abort targets are unchanged. Eight new store regressions and five native-end regressions are included in the full **229/229** backend result; affected store suites passed **24/24**, and source checks passed **126**. This repairs truthful accounting, not the model's unwanted goal creation or task-delivery failure.

## Shared contributions

Task artifact reads require the same original owner/conversation/task/native goal and current household visibility, or exact private owner. A different household actor needs explicit trusted `contribution:{actorProfileId,canWrite:true}` to mutate the shared task. Root's task-artifact write adapter validates that grant before calling the existing owner-scoped ArtifactStore writer. Ordinary `canReadHousehold` does not grant writes, and ArtifactStore's public owner-only write rule is not widened. Replies retain the actual actor and current admitted source. Resource approval still requires owning-domain policy and a fresh human reply bound to the exact question.

## Analysis

`AnalysisFlowService` admits authorized text/JSON/CSV/Python and PNG/JPEG/WebP artifacts (32 files, 16 MiB total; no artificial native goal) and invokes a fixed `NativeAnalysisRequest` through an injected native spawn port. `spawnNativeAnalysis` uses the public `openclaw/plugin-sdk/agent-harness` `createOpenClawCodingTools` factory, selects the actual native `sessions_spawn` tool and executes only the service-built sandbox-required isolated household-analysis request inside the current guarded parent tool invocation. It does not create an independent restricted session or imitate a parent/yield relationship.

Actual family native configuration uses an explicit safe tool allowlist, excluding raw host/provider/memory tools and the child-only publisher. It remains closed if the plugin cannot load. The typed analysis implementation creates a private clone of the current configuration for tool construction only, replacing only the requester tool policy with the fixed sandbox primitives, native spawn and publisher. It materializes the complete required construction surface so the native child can inherit its needed capabilities, then retrieves and executes only native sessions_spawn. None of those constructed parent filesystem or shell tools is exposed to the model or executed by the launcher. No model argument can supply the policy clone. The native spawn implementation independently reads actual runtime configuration for target allowAgents, controller ownership, sandbox and lifecycle admission.

The helper profile still pins the local model, no-network sandbox image, no host binds, no secrets, no elevated privileges and bounded process resources. Existing NativeExecutionPolicies is reused and extended only for exact `household_analysis_publish_output`. It must not allow other household mutations or delegation in the helper. The real native registry owns parent cancellation, child lifecycle and settlement wakeup. Conflicting global/provider allowlists may legitimately refuse the fixed launcher; missing required constructed tools fail closed and must be fixed through reviewed configuration, not a fallback host execution path.

The helper publishes actual `outputs/<basename>` files using trusted native workspace metadata, not arbitrary host paths. A configured native sandbox root, exact helper agent/session/run, `sandboxed:true`, current policy and same-root native child relationship are all required. Publisher opens regular single-link files under the verified workspace's outputs directory, anchors the directory through its descriptor, rejects symlinks/changes/unsupported media and caps each file at 25 MiB. ArtifactStore separately checks MIME signatures. Immutable output manifests bind each file/hash to the request and child. `analysis.result` verifies the announced successful native child and each scoped manifest/hash; it neither polls nor trusts final prose as output evidence.

Root must provide `AnalysisFlowPorts.child` from actual native owner reads: exact child key/run, target helper id, parent session, original root task, sandbox-required state and current native success/failure. Unknown identities are rejected. No model-supplied parent or synthetic success can substitute. Native analysis inputs and output manifests use existing immutable artifacts and domain effect receipts; no analysis job table, queue or worker service is introduced.

`analysis.publish_report` writes bounded plain text directly to the existing artifact output authority and is usable for diagnosis without Python. Diagnosis denies all other analysis operations. Reports are data, carry current audience/scope and cannot apply operational repairs.

## Deferred acceptance

The first real signed-app campaign attempt exposed a pinned OpenClaw 2026.9.8
wire incompatibility: atomic `session-goal-start` cannot carry ordinary
`workContext`. `normalizeChatSendRequest` rejects that combination before session
preparation or admission. The adapter now omits working context only for atomic
goal start, preserving ordinary-chat context and exact goal/session/idempotency
fields. Actual-adapter protocol tests cover both modes. Only the public
`GatewayClientRequestError` with `gatewayCode: INVALID_REQUEST` and that exact
pinned pre-admission guard message is definitively `not_sent`; other invalid
requests, lookalike errors and transport failures remain `unknown`. This is a
provider protocol compatibility boundary, not human phrase routing. The rejected
fixture was independently confirmed to have no native goal/run/user turn,
continuation, grant or effect and explicitly operator-cancelled with its source
and proof retained; it was never replayed. Affected protocol/delivery suites
passed 11/11 on Ubuntu. The wire correction was loaded and actual parent/child continuation steps were observed. This initial wire checkpoint did not establish complete original-goal delivery; [current status](current-status.md) records later completion evidence.

The 0.6 candidate is assembled and the consolidated campaign remains open. [Current status](current-status.md) owns the later native parent/child and completion results and the remaining actual acceptance cases. Analysis acceptance separately requires actual sandbox confinement, input attachment mapping, Python/chart execution and output import; a general parent/child phase pass does not establish those guarantees. Unit/helper checks alone cannot establish runtime delivery, cancellation, restart or family/device recovery. Retain actual limitations if the installed native path rejects an authority or inherited policy; do not bypass native code or claim deployment success from source inspection.

## Native analysis attachment readiness correction

The typed analysis launcher reads the actual supported native runtime configuration
before invoking spawn. Hidden-subagent admission in SDK2026.9.8 independently uses
that runtime configuration; a private factory clone cannot enable attachments.
The existing native platform renderer and preparation owners now emit the bounded
policy below and refuse conflicting explicit fields rather than overriding them.
Missing fields can be filled in a prepared candidate. No preparation activates it.

```json
{"tools":{"sessions_spawn":{"attachments":{"enabled":true,"maxFiles":32,"maxTotalBytes":16777216,"maxFileBytes":16777216,"retainOnSessionKeep":true}}}}
```

This enables native projection, not artifact authority. The actual family
TaskApplication guard still rejects raw `sessions_spawn` attachments and cross-agent
helper selection. Only typed analysis resolves current authorized immutable inputs.
The private tool-construction clone supplies child primitive inheritance only.
No process-wide runtime snapshot is changed during a call; helper model, sandbox,
identity, grants, OAuth/vault setup and scheduling policy remain independently owned.

Disabled or insufficient attachment support returns a fixed safe `rejectionCode`
before native spawn. Only explicit native refusal is `rejected`; complete accepted
identity is `accepted`. Unrecognized/incomplete/error envelopes and uncertain sends
remain `unknown`, retaining any exact child identity. Native error text is never
forwarded. Report the blocker or inspect existing ownership evidence; do not invent
a goal, raw child, approval or host-script fallback. The first R8 analysis case is
still failed at its original source pin. Component/provider-free evidence and actual
model acceptance belong to current status; this correction alone accepts no workflow.


## Analysis child tool exposure

The fixed helper uses the visible sandbox primitives and the existing typed `household_analysis_publish_output` tool. OpenClaw 2026.9.8 supports `catalogMode: "direct-only"` on the tool object. The publisher alone carries that marker so native Tool Search compaction keeps its exact schema directly available to the helper. Its plugin registration stays optional and the native helper profile must already include it. Family tool grants and the protected sandbox profile retain their existing scope.

R12 retained three native `Tool household_analysis_publish_output not found` results before any publisher invocation. The helper lacked a deferred dispatcher and the model tried bare publisher and invented search names. Its exec attempts also included disallowed ask arguments. The child now receives an exact minimal Python exec example and instructions to report a failed execution or publication. Exec strips an inert `elevated: false` and pins the sandbox. Explicit ask, security, node, alternate host and elevated privilege still fail closed. The native publisher continues to require exact current invocation, admitted sandbox lineage and verified output custody.

## Native sandbox policy and the parent wake

OpenClaw applies a separate sandbox allowlist before catalog compaction. The fixed analysis helper declares its existing seven tools in both allowlists, including the direct output publisher. Explicit denies continue to apply. Family agents retain their existing tool policy. The helper uses the absolute sandbox path in the native attachment notice for input reads and Python.

The parent calls the visible native `sessions_yield {}` directly when the exact child is pending. An ordinary signed request may transfer its running authority to the verified requester-settle or direct announcement run for that child. The submission, source, audience, artifacts and native parent session remain bound to the same request. The old run loses authority when the new one adopts it. This path requires a single exact terminal analysis child and current signed request provenance. The early model-selection hook omits that provenance. For these native wakes, admission waits for the later trusted hook before granting tool access.
