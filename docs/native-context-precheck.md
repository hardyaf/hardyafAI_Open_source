# Native context precheck and accepted budget repair

Current status: household control 0.10.2 and the approved pinned OpenClaw V5
compatibility patch are deployed. Main's selected Qwen `contextTokens`,
`contextWindow` and `params.num_ctx` are all **131,072**, with Main-only
high thinking (native `think:"high"`, mapped to Qwen XHIGH). Live registry,
deployed serialization, PID/config attestation and isolation checks confirm
adoption. Two 128K/high capacity requests stopped normally with thinking and
responses; their roughly 10.8K-token prefill is not near-full 128K or semantic
certification. The dated **November 25 64K** native compaction, productive
new-source continuation, complete scoped Google readback and natural private
Gmail checks remain accepted for those tested workflows. See the
[repair record](context-budget-repair.md) and [current capacity limits](dual-gpu-model-readiness.md).

The flag-only 32K candidate remains rejected and off. No email/tool/turn counts,
replacement engine/store or generation/thinking cap was introduced. The following
sections preserve earlier allocation/investigation evidence, not current native
budget acceptance. The initial 64K allocation changed two fields but left
`contextTokens=32768`; provider capacity alone did not establish native64.

The first immediate post-start 128K observer failure was retained under containment. A forward start waited for the listener and unchanged owner observer, then passed without rewriting config; exact initial failure causality remains unconfirmed. Production output and compaction settings are unchanged. Household web access remains unavailable pending deferred network restoration.

## Earlier 64K allocation result

At that initial allocation stage, the active protected configuration and retained
preparation input had exactly two semantic Qwen changes: `contextWindow` and `params.num_ctx`, each
32,768 to 65,536. The explicit native parameter overrides the descriptor;
changing only `contextWindow` leaves actual Ollama requests at 32K. The first
isolated attempt exposed this metadata mismatch and was retained as invalid
64K evidence, then corrected. No global context override was added.

With the precheck off, signed app admission and a stock gateway exercised fresh
and existing synthetic chats. Tool planning was deterministic; prompt-capacity
probes and compaction summaries used actual local Qwen through the native API.
Both chains completed three large reads, one atomic 18-read batch and a terminal
read. Maximum measured foreground input was 45,946 and 48,405 tokens; every
request used 65,536 and no capacity rejection occurred. Source hashes, private
owner, grant/run/session lineage and loaded contracts remained current, with
zero effects and no replay. Native runs returned idle. This is lifecycle and
capacity evidence, not natural-language task-quality certification.

The existing chat saved one automatic compaction, 48,555 to 11,262 tokens,
with a 3,358-character summary in 72.151 seconds. Six actual Qwen summary
requests used 64K and the stock 1,024 summary-output budget. The fresh chat
completed its read chain, but its automatic compaction was interrupted by
fixture cleanup. Three actual summary requests were observed. A later chronology
review found the manual active-run rejection triggered gateway termination;
shutdown began three milliseconds before the generic failed-compaction record,
followed by a cancellation event. This is not a clean model-summary failure.
The inner catch-all exception remains unspecified; there is no evidence to claim
empty output, exhausted thinking budget, timeout, invalid format or inability to
summarize. That earlier campaign did not prove fresh 64K compact-and-resume
acceptance.
The manual RPC checks also retained fixture limits:
a fresh-tail race and an `Already compacted` response after successful automatic
compaction. No productive 64K post-compaction follow-up was proven.

The measured allocation stayed fully on GPU at 20,996 MiB total use, leaving
3,129 MiB on the current card. It does not establish concurrent embedding/OCR
capacity. Scratch processes stopped and ordinary 32K was restored before the
separate protected 64K deployment.

Deployment changed configuration only. The initial atomic replacement preserved
UID/GID/mode but omitted the named native-owner read ACL, causing gateway startup
to fail. Restoring the exact existing installer rule repaired access without
changing configuration bytes or granting write access. Forward verification
rechecked the original protected preimages, exact two-leaf differences, actual
PID/config attestation, trusted readiness and the credential-service isolation
audit. No database or session history was restored. Future replacements must
capture, preserve and verify extended ACLs/xattrs in addition to UID/GID/mode.
Rollback restores only captured context settings with those access rules and
fresh attestation; retained business records and test failures remain intact.

The following sections preserve the earlier 32K flag investigation and its
rejected proposal. They are not the current context configuration.

## Historical 32K failure and rejected flag proposal

A private email request successfully read 18 approved connected messages.
Its successful model inputs grew to 28,677 tokens, followed by a 1,920-token
output and a later context_overflow. Exact-run recovery logs show two compaction
attempts triggered by overflow, both ending summary_failed. Compaction was
attempted; an absent session counter did not mean it was disabled.

Installed stock OpenClaw 2026.9.8 supports
agents.defaults.compaction.midTurnPrecheck.enabled. Its default is off, while
ordinary compaction remains enabled through stock defaults. The opt-in guard
checks newly returned tool data before another model call and enters native
compaction/recovery early. It must not replay completed tool effects.

## Reuse and ownership

| Concern | Decision and boundary |
| --- | --- |
| Context sizing, compaction and recovery | Reuse stock OpenClaw and its built-in SQLite compaction engine. No fork, second memory store or task engine. |
| Persistent preparation | Adapt the existing Slice 3 preparation defaults, preserving unrelated nested compaction settings, model limits and permissions. |
| Production setting | Change only the supported leaf in the protected native configuration after isolated proof; refresh actual PID/config attestation. |
| Source/session authority | Preserve exact current source/run/session, owner/device/audience and loaded-contract checks. No relaxed generation matching. |
| Mail and credentials | Existing provider and isolated credential owners remain unchanged. Test with synthetic reads, not private mailbox content. |
| Token/resource limits | Keep the existing 32K context, per-call output and provider/model configuration. Do not add email-count, step or turn caps. |

Existing after-compaction hooks project diagnostics; they are not an authority
rebind. Stock SQLite compaction is expected to preserve session identity. The
test must observe actual identity and productive post-compaction execution.
If an engine rotates identity, admission and loaded contracts must be rebound
through the existing trusted native hooks before any new effect, or deny.

## Required verification and rollback

Run isolated stock runtime with synthetic typed read results large enough to
exercise the guard, same window/model and real local summarizer. Confirm early
precheck/compaction, successful summary and canonical completion, current source/
device/session lineage and a productive post-compaction call. Retain exact
results and failed attempts. Fake transport alone cannot prove the real
summarizer works, since the observed recovery failure was summary_failed.

Only after that proof should production activation take a protected config/source
backup, verify no active accepted work, change the one leaf, restart/attest and
audit the gateway/credential boundary. Do not restore databases, session history,
tokens or newer records. Rollback restores only the setting/source preimages and
restarts with fresh attestation. Executed results and limitations follow.


## Executed result: no global activation

The preparation-only candidate passed eight focused tests and 605 installed-SDK
checks, but that did not establish native acceptance. Isolated stock gateway,
canonical control/admission and synthetic typed reads then exercised actual local
Qwen capacity and summarization. The existing-chat case completed three large
reads, an atomic 18-read batch and a productive terminal read, with six saved
compactions and two real local-model summaries. Session, run, source hash, owner
and loaded contracts remained current, with zero recorded effects or replays.

A fresh-chat case failed with stock Nothing to compact, even though the actual
provider input fit the 32K window. Earlier fixture attempts also exposed calibration
and capacity gaps; their evidence is retained. Scripted decision transport plus
real capacity probes/summaries is lifecycle evidence, not semantic acceptance of
every long mailbox request. The fresh-chat regression blocks global activation.

The two public preparation files were restored to their exact pre-candidate
source. The candidate archives, focused/full logs and native runs remain retained.
The accepted restored source passed 603/603 installed-SDK checks, zero skips or
failures, and 195-file validation. The protected configuration was never changed.

## Why overflow recovery failed

The user run's atomic read block contains 61,972 model-visible text characters.
Stock tool-result retention estimation gives a text-only lower bound of 37,165
tokens, excluding foreground prompts and tools. Its maximum retention at 32K is
at most 24,576 before fixed foreground and pending input. The then-stock aggregate
projection allowed that block without reducing it, so the compactor could not fit
a complete latest exchange. These are SDK estimates, not measured provider tokens.
Retention preferences or a different summary model cannot bypass that initial
capacity check. The two original summaries failed before inference.

At the original failure, provider/model context was explicitly configured to 32,768 tokens. The model
metadata advertises 262,144, which is an architectural capability, not a validated
local working allocation. A separate synthetic one-token 65,536-context probe
was fully GPU-resident. Ordinary 32K execution was restored immediately and the
protected config hash remained unchanged. This establishes memory fit only;
the later 64K workflow evidence and remaining limitations are recorded above.
