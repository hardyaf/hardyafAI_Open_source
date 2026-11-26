# Bookkeeping complexity audit and simplification plan

November 4, 2026. The findings below preserve the original Slice 3 audit. The owner subsequently authorized implementation; see the [simplification implementation record](bookkeeping-simplification-implementation.md) and [current status](current-status.md) for implemented changes and actual verification. Historical line numbers and measurements describe the audited baseline, not the revised source.

## Conclusion

The model is responsible for too much internal synchronization. It maintains declared outcomes and a second native progress representation, copies receipt and provenance identifiers, navigates several tool layers, and performs separate completion ceremonies. Some checks freeze model-authored wording or recognize document formats where the product calls for semantic reasoning. These are concrete simplification opportunities.

Keep deterministic identity, permission, audience, credential, persistence and effect-integrity boundaries. Move mechanical bookkeeping behind existing typed application interfaces. Let Main interpret the request, choose and revise permitted tool compositions, distinguish evidence from inference, and ask about genuine uncertainty.

This audit covers the active OpenClaw application, plugin, skills, domain adapters, Uplift bridge and operating documentation. It does not assess the retired native HardyAI engine as a candidate runtime. Current deployment and acceptance belong to [current status](current-status.md); model-run observations belong to the [failure record](model-runtime-known-issues.md). Static code limitations below are distinguished from observed workflow failures. No model comparison or functional campaign was run for this audit.

## Original audit findings

### 1 Native progress presentation blocks business execution

**High priority. Implemented behavior and observed failures.** [native-progress-policy.ts](../services/household-control/src/task-flow/native-progress-policy.ts), lines 21 and 56, calls progress a rebuildable presentation, never evidence or a grant. Nevertheless, [task-application.ts](../services/household-control/src/domain-runtime/task-application.ts), lines 195–203 and 219–224, requires it before business writes and native completion. The validator requires exact step count, order and labels, including embedded outcome identifiers; freshness is tied to the newest human source timestamp. A harmless label change or fresh answer can require another model update. Actual progress calls were denied for changed labels and unsupported completed states.

**Adapt:** derive progress from canonical outcomes and evidence. Remove cosmetic equality/freshness as a business-write condition. Preserve the rule that presentation cannot claim unsupported success. Native continuation is a separate constraint: its current-run progress-tool callback arms unfinished-plan continuation; a progress RPC alone does not. First verify a supported native execution seam. If that seam is unavailable, retain the necessary native call with minimal stable identifiers rather than manual full-label synchronization. Do not fake callbacks, hide effects or add a self-prompt queue.

### 2 An ordinary write requires a full task ceremony

**High priority. Implemented interface burden.** [runtime.ts](../services/household-control/src/domain-runtime/runtime.ts), line 235, requires an active native goal for every write except memory/documents. [The conductor skill](../skills/task-conductor/SKILL.md), lines 18–28 and 60–62, adds goal/context restoration, outcomes, domain selection, tool discovery, progress, verification, finish and native completion. An unfamiliar simple action can involve roughly 10–15 bookkeeping/navigation calls across its full lifecycle, excluding domain work and retries. This is a static interaction count, not a measured latency claim; discovered schemas can be reused.

**Adapt:** provide a cheap model-facing path for an ordinary authorized action. Existing application code should create/bind any required native goal and associate its outcome internally through supported interfaces. Reuse source admission and effect receipts. Durable coordinated work still retains checkpoints, human waits, children and restart recovery. Avoid a new phrase classifier or fixed catalog of workflows to decide which path is allowed.

### 3 Model-authored plan wording is treated as authority

**High priority. Implemented rigidity.** [TaskFlow service](../services/household-control/src/task-flow/service.ts), lines 37–49 and 199–205, permits refinement only with an exact description, evidence kind, state, tool domain and known resource. Other shape changes need fresh human steering. Satisfaction is coupled to an exact tool name. This protects targets and accepted states, but also freezes model implementation choices and wording.

**Adapt:** keep the human-bound objective, target and acceptance conditions stable; allow Main to revise plan text, permitted tool sequence and evidence strategy autonomously. Invalidate affected verification when the strategy changes. Use domain-issued semantic effect facts rather than exact tool identity wherever operations establish the same result. A different resource, broader authority or weaker acceptance state remains a material change.

### 4 Receipt association and completion are manual model work

**High priority. Implemented duplication.** [runtime.ts](../services/household-control/src/domain-runtime/runtime.ts), lines 240–246, already commits the owning action receipt. [TaskFlow service](../services/household-control/src/task-flow/service.ts), lines 266–277, then requires the model to submit evidence references and separately finish. Native progress and native goal completion add further model-facing operations.

**Adapt:** an action may identify the declared outcome it serves; existing dispatch associates the committed receipt after owner/scope/state verification. Ambiguous association remains explicit. Offer one typed completion request that freshly verifies the required outcomes and uses supported native completion. Preserve verification at meaningful commit/settlement boundaries; remove repeated instructions telling Main to initiate those checks. A receipt's existence never proves an unrelated outcome.

### 5 Tool navigation and prompt policy are unnecessarily layered

**High priority. Static source measurements.** [hooks.ts](../services/household-control/src/task-flow/hooks.ts), lines 21–38 and 82–84, combines conductor, navigation, progress and automatic-memory text totaling 8,983 characters on an ordinary human turn with an active goal, before task data and selected contracts. [household-domains.json](../skills/household-domains.json), lines 36–38, maps effect inspection to the entire 13,258-character conductor skill. Selecting contacts, documents and effects adds 18,847 characters, for approximately 27,830 characters of procedural instructions before other context. These are characters, not tokens; they do not prove truncation caused a failed run.

The skill also requires search, schema description and wrapped invocation for newly needed tools. Exact typed schemas are valuable; repeated navigation and duplicate conductor instructions are avoidable.

**Adapt:** one concise shared execution contract, a small effect-inspection contract, and focused domain instructions. Use supported selective schema binding/expansion where available. Preserve the authorized subset and strict argument validation. Do not expose every tool at once or turn malformed output into guessed executable arguments.

### 6 Memory mixes source grounding with internal copying and literal wording

**High priority. Implemented restrictions and observed candidate-only curation.** [runtime.ts](../services/household-control/src/domain-runtime/runtime.ts), lines 303–304, already knows the authenticated human source. [Memory source handling](../services/household-control/src/domains/memory/source-files.ts), lines 67–69, nevertheless depends on model-copied source IDs to confirm it. [Memory synthesis](../services/household-control/src/domains/memory/index.ts), lines 154–160, only marks a fact supported when the entire claim text is a literal normalized substring of a confirmed source. A useful paraphrase remains a candidate even with genuine supporting evidence.

The automatic-memory prompt also adds source capture, topic synthesis, daily journal, hashes and correction mechanics to ordinary human turns. The same module, lines 167–170, returns the full native write result after readback.

**Adapt:** bind authenticated provenance automatically. Separate normalized claim text from an exact evidence quote/span. Main decides what lasting knowledge means and identifies inference or uncertainty; code checks source identity, quote existence, scope and revision. Encapsulate topic/journal projection mechanics in the existing memory owner and return compact receipts with authorized detailed reads on demand. Ordinary curation remains goal-free and does not require a second background transcript processor. Do not promote arbitrary model confidence into trusted human evidence.

### 7 Contact correction and evidence require avoidable reconstruction

**High priority for cards. Implemented interface and observed extraction skipping.** [Contact tools](../services/household-control/src/domains/contacts/tools.ts), line 23, require the full intended field set for a correction; [Contact service](../services/household-control/src/domains/contacts/service.ts), lines 166–170, replaces the record. Correcting one email therefore requires Main to reproduce unrelated fields and observations.

The same service, lines 121–128, accepts model-authored observations matching field values, while [observation validation](../services/household-control/src/domains/contacts/validation.ts), lines 41–47, checks source membership without establishing an actual owning OCR extraction receipt. [Task evidence](../services/household-control/src/domain-runtime/runtime.ts), lines 579–582, establishes that a contact/revision was saved, not that a card was successfully read. Strict task bookkeeping did not prevent an empty save after skipped extraction.

**Adapt:** add typed field patches within Contacts, merged against the current authorized revision. Reuse Documents extraction handles/spans and record extraction-attempt status automatically. Distinguish original saved, extraction failed and fields populated without adding a separate workflow ledger. Preserve every supplied card and genuine failed-extraction fallback. Keep the user's later-response requirement for changing saved fields, original sources, history and audience controls.

### 8 Receipt grounding partially substitutes format recognition for reasoning

**High priority before receipt acceptance. Static limitation; no live receipt failure claimed.** [Uplift validation](../integrations/uplift/uplift_finance_bridge/validation.py), lines 127–145, supports trusted structured facts but otherwise grounds dates through a narrow numeric format set and currencies through literal currency codes. A clear date such as “November 3, 2026” cannot ground its normalized ISO value through that quote path. A currency symbol alone may genuinely be ambiguous and should not automatically establish USD.

The exposed [receipt statement bridge](../services/household-control/src/domain-runtime/receipts-bridge.ts), lines 105–119, only creates exception-approval facts. General normalized field facts and the validator's distinct-receipt clarification path are not available through that surface.

**Adapt:** use a general interpreted-field contract in Uplift: normalized value, exact supporting source span, interpretation, ambiguity and current clarification when needed. Main supplies semantic interpretation. Keep exact provenance, arithmetic, project permissions, duplicates, current revisions and atomic acceptance. Avoid adding a new parser branch for every valid phrasing.

Candidate save already returns validation; acceptance revalidates transactionally ([candidates.py](../integrations/uplift/uplift_finance_bridge/candidates.py), lines 81–91 and 129). The separate validation tool remains optional inspection. Current code does not require a redundant save → validate → accept ritual.

### 9 Checkpoint and lifecycle mechanics can be consolidated internally

**Medium priority. Static duplication and optimization opportunity.** [Task catalog](../services/household-control/src/task-flow/catalog.ts), lines 28–29, requires a revision even for ephemeral no-goal domain selection. [TaskFlow service](../services/household-control/src/task-flow/service.ts), lines 108–123 and 182–186, writes an entire immutable handoff and CAS pointer for metadata changes such as domain selection. Whole-state responses add more context than small change receipts need.

[nativeEnd](../services/household-control/src/domain-runtime/runtime.ts), lines 471–499, and [delivery reconciliation](../services/household-control/src/sqlite-household-store.ts), lines 124–192, inspect related native/source state. They have different responsibilities, so merging their stores or removing reconciliation is unjustified. Shared settlement predicates and invocation-local observations may reduce duplicated policy/reads after their race behavior is characterized.

**Adapt:** hide routine revisions/receipt association in application transactions; retain CAS at genuine concurrent state boundaries and immutable checkpoints at meaningful recovery milestones. Remove irrelevant revision inputs from ephemeral selection. Prefer a shared settlement decision function over parallel condition trees. Preserve current-source rereads across asynchronous calls, cancellation fencing and restart recovery. Do not cache authority across effects or use “latest wins.” Performance savings need measurement.

### 10 Living documentation has competing current instructions

**Medium priority. Verified maintenance debt.** The former conductor document directed Markdown recovery ledgers while the implemented skill forbids them. README and architecture summaries retained superseded acceptance/pin stages. Repeated current totals and status copies create unnecessary operator and future-agent bookkeeping.

**Adapt:** current-status owns the current runtime/acceptance summary; the implementation plan owns pending work; domain contracts own behavior; dated worklogs retain history. Replace stale current instructions with links and clearly dated evidence. This audit updates the principal navigation/current descriptions.

The mirrored [workspace AGENTS](../config/workspace/AGENTS.md) also contains obsolete raw-execution, phrase-routing and Markdown-ledger instructions. [Slice 3 configuration](../deploy/hardybot/prepare-slice3.py), lines 244–248, disables automatic workspace bootstrap/daily injection. These files are dormant configuration debt, not evidence of current prompt injection or a demonstrated cause of failure. Archive or replace their obsolete instructions before any future re-enablement; preserve identity/personality separately.

## Responsibility after simplification

| Responsibility | Owner |
| --- | --- |
| Interpret intent, choose permitted operations, replan, interpret evidence and uncertainty | Main with selected domain skills |
| Sessions, goals, children, execution, continuation and scheduled runs | Stock OpenClaw |
| Authenticated source, person/device, grants, exact invocation and cancellation fences | Existing application admission and native execution-grant projection |
| Business persistence, revisions, acceptance and actual result evidence | Existing owning domain |
| Receipt association, compact checkpoints, completion coordination | Existing TaskApplication/TaskFlow composition |
| Visible progress | Rebuildable projection of current outcomes and owner evidence |
| Long-term knowledge | Existing source Markdown/native memory wiki; Contacts and Uplift remain their own authorities |

Do not merge native execution, app delivery, financial acceptance and contact state into one ambiguous status. Their meanings differ. Simplification removes model synchronization and duplicated policy, while preserving those ownership boundaries.

## Reuse and data ownership impact

| Change | Decision | Durable data and consistency |
| --- | --- | --- |
| Action/evidence/completion facade | Adapt HouseholdTaskApplication, TaskFlowService and existing effect registry | Domain state/receipts stay authoritative. Outcome links point to those receipts; finish refreshes current owner proof. |
| Native progress | Adapt supported native tool integration | Native card is a disposable projection. Rebuild from current canonical outcomes; no second progress authority. Preserve native continuation behavior. |
| Cheap ordinary action path | Adapt admission and native goal binding | Existing source receipt and any required native goal retain exact ownership; no feature-private task store. |
| Selected schemas and compact instruction context | Adapt loader, native plugin and execution-grant metadata | Ephemeral scoped projection. Current grants and loaded contract identity remain enforced at invocation. |
| Source evidence and memory curation | Adapt existing memory adapter | Immutable sources/native wiki remain owners. Journal/topic/index projections retain their source links, correction and deletion behavior. |
| Card patches and extraction references | Adapt Contacts and Documents contracts | Contacts owns revision history; Documents owns extraction evidence; artifacts own original bytes. Patches preserve untouched fields. |
| Receipt interpretation | Adapt Uplift candidate/evidence schemas | Uplift owns candidates, accepted revisions and review. Transactional validation and projections stay in that authority. |
| Lifecycle and checkpoint simplification | Adapt current repositories and application services | Existing CAS, leases, delivery recovery and effect receipts remain. No new queue, event log or recovery ledger. |

No new subsystem is justified. The implementation adapts these owners without a new durable store or schema migration. The original audit changed documentation only; subsequent implementation and verification are recorded separately.

## Authorized implementation order

1. **Remove avoidable protocol burden first.** Establish the supported native progress/continuation seam; consolidate receipt association and completion; separate stable user outcomes from mutable plan details; remove duplicated conductor context; simplify selected schema exposure. Make the ordinary authorized action path cheap without losing native ownership.
2. **Repair domain interfaces.** Automatically bind human provenance, separate exact evidence from normalized facts, return compact memory receipts, add Contacts patches/extraction handles, and expose general receipt interpretation/clarification facts. Keep the existing reasoning-led receipt policy.
3. **Compare Qwen3.8 27B with fixed cases.** The owner agreed to stronger-local evaluation plus protocol simplification. Use the same preserved cases and a supported provider version; measure actual resource use and tool correctness before promotion. The installed old 7B failure does not characterize the newer 27B candidate. The original documentation audit performed no download, switch or provider upgrade. The later authorized comparison and provider update have their own recorded evidence.
4. **Continue the existing consolidated acceptance campaign.** One ordinary action/readback/completion, then parent/child/yield/same-goal completion, question/restart, cards and grounded memory. Continue receipts, analysis, brain dumps, publication, diagnosis and scoped scheduling after those foundations work. Rerun affected boundaries; broaden only when changes justify it.

The implementation may overlap independent domain/schema work. These are dependencies within the current reliability effort, not a new set of phase approvals or repeated certification campaigns.

## Acceptance and rollback

Judge simplification by fewer clerical/navigation calls on fixed cases, compact prompt/result sizes, correct autonomous replanning, preservation of unrelated contact fields, supported normalized facts and receipts, and truthful complete/partial/failed reporting. Record before/after traces rather than selecting an arbitrary call quota. The original behavioral case and its failed attempts stay in the evidence index.

Boundary checks must still reject wrong person/audience/resource, forged or stale invocation/source, duplicate uncertain effects, ungrounded authority, unsupported financial acceptance, cancelled work and diagnostic repairs. Verify the actual native continuation callback, not only a saved card. Backend checks do not replace a productive model-led run.

Ship source/skill/config changes together with appropriate Ubuntu checks. Retain prior deployed source and protected data/config backups. Roll back coordination/presentation code without deleting new sources, patches, financial decisions or effect receipts; reconcile uncertain effects rather than replaying them. Scheduling remains disabled until its existing acceptance conditions pass. OAuth/vault onboarding remains held.
