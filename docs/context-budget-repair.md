# Context budget and progressive reading repair

Status: **household control 0.10.2 is deployed**. Main's selected Qwen3.8 27B
Q4_K_M now has a **131,072 native working budget and provider allocation**, with Main-only high thinking (native `think:"high"`, mapped to Qwen XHIGH).
OpenClaw is upstream **2026.9.8 with the owner-approved pinned V5 compatibility
patch**. Its native execution, sessions, compaction, queue, permissions, transcript
and effect ownership remain in place. This is not an unmodified upstream package
or a replacement task engine.

## Current default after the November 26 promotion

The protected and retained inputs align all three selected-model context fields at **131,072**. Live Gateway registry and deployed serialization confirm 128K/high; PID/config attestation and isolation checks passed. Two bounded capacity requests completed normally with thinking and responses, all 66 layers on GPU and full API GPU residency. Their roughly 10.8K-token prefill does not establish near-full 128K performance or semantic acceptance.

Model selection, GPT/other profiles, production output options, compaction, permissions and disabled scheduling are unchanged. The initial post-start observer failure was retained under containment; waiting for the listener and unchanged owner observer completed forward startup without rewriting either config. Exact initial failure causality remains unconfirmed. Household web availability remains blocked by deferred network restoration. The **64K repair and compaction/continuation results below are dated November 25 evidence**, not new 128K workload certification. See [current capacity and limits](dual-gpu-model-readiness.md).

## Causes

The original 32K email exchange returned 18 approved messages with 61,972
model-visible characters. Native retention estimation gave a text-only lower
bound of 37,165 tokens, against at most 24,576 retention before fixed foreground
and pending input. The latest assistant/tool exchange could not be split safely;
both original recovery attempts failed before summary inference.

The initial 64K promotion changed `contextWindow` and provider `params.num_ctx`
but missed the selected model's separate `contextTokens=32768` cap. Stock native
resolution takes the minimum. Provider capacity and GPU residency did not prove
a 64K native budget. The November 25 repair changed only that same model's `contextTokens`
to 65536 in the protected and retained preparation inputs. Other model profiles,
global defaults, generation/thinking options, grants and scheduling were unchanged by that repair.
Ordinary old resolved session telemetry is recomputed; session databases are not
rewritten and genuine explicit/locked overrides retain their existing semantics.

SDK deferred wrappers also presented the same business payload twice. The real
18-result fixture contained 77,634 model-visible characters, including 34,344
of inner JSON and the same 34,344 again as structured details. Owned tool
conversions dropped verified projection provenance, and the actual 8,192-byte
ordinary-details reducer dropped large framework descriptors. The final checks
exercise the complete Gateway/conversion/persistence path, not only direct tools.

The earlier fresh provider64 campaign's apparent summary failure followed
verifier shutdown/cancellation. It did not prove model-summary inability.
The current local model has written real summaries and continued useful work.

## Reuse and data ownership

| Concern | Decision | Authoritative owner |
| --- | --- | --- |
| Execution, sessions, compaction and queue | Adapt the pinned native implementation; no replacement engine | OpenClaw |
| Request, retained-tail and replay budgeting | One existing native estimator/current request budget | Native runtime |
| Canonical history and call/result identities | Retain under existing redaction and ordinary-details policy | Native transcript |
| Recipes and frozen views | Bounded hash-bound metadata in existing native transcript/cache records | Native runtime |
| Full email text | Refetch through existing typed Google reads; no mailbox cache | Gmail |
| Current source, profile, device, audience, grants and effects | Recheck existing authorities on every operation | Household services |
| Credentials and immutable account bindings | Reuse protected vault/Connections boundaries | Existing vault and Connections owners |
| Window offsets and content versions | Derived metadata; references grant no authority | Google adapter |

## Implemented behavior

V5 pins eight exact SDK files, including all three owned tool-conversion edges
and the actual persistence reducer. Verified private provenance survives those
conversions. Generic SDK-wrapper deduplication retains every business value once;
only the statically opted-in email read capability may declare body text optional.
Provider JSON, MCP fields, names and forged metadata grant neither capability.

Small recipes bind to exact current prepared text, known SDK framing and strict
serialization. They replace large alternate-body sidecars. The ordinary 8,192-byte
details limit remains; separately validated framework metadata is bounded too.
The same existing text policy prepares content and descriptor/readback values.
Cold replay cannot reintroduce redacted text. Invalid ownership, framing, source
hash or redaction binding declines projection. Canonical audit/history remains
under its existing native policy.

`household_email_read` accepts optional `bodyWindow` parameters with code-point
offsets, a caller-chosen size and a scope-bound version. Nonzero offsets require
that version. Each continuation rechecks current access and refetches the message;
changed content is refused instead of silently stitched. Partial views retain the
connection, message, version and original read offset, with explicit omissions
and readback metadata. Window completion and whole-message completion are distinct;
incomplete MIME/snippet-only projections never claim a full body. Legacy CLI
reads refuse unsupported windows before invoking the CLI.

There are no new email, task, tool-call or turn counts, phrase/workflow routes,
credential stores, mailbox caches, schedulers or hosted fallbacks. Existing native
resource/cancellation controls remain. The experimental mid-turn flag stays off.
Explicit native output options are unchanged; the 2,048-token model descriptor is
an accounting assumption when Ollama omits `num_predict`, not a new generation cap.

## Verification

The exact clean public export passed 621/621 installed-SDK application tests with
zero skips, 199 source checks, web/domain builds and generated-client consistency.
The applier, security audit and installer passed 16, 21 and 11 Python checks.
The SDK passed 34 provider-free checks, including real Gateway tool_call execution,
large results, cold SQLite prepare/commit/replay, MCP/forgery refusal and body plus
readback redaction. Corrected lifecycle helpers passed 52 checks; the final natural
chat filter passed 28 checks.

Two full signed-app stub cases passed with zero real inference. The same original
workloads then passed with real local Qwen capacity probes and actual summaries.
The automatic case retained 3 large reads, 18 batch results and primary/new-source
terminal reads. Its genuine 2,055-character summary completed in 12.153 seconds;
matching native budget input fell 81,435 to 44,095. A new signed source reloaded
its contract and executed a useful typed read with current grants and stable SID.

The Google case preserved all 18 references, performed deferred body projection
and retained canonical bodies. A new signed source reconstructed the omitted
5,284-character synthetic body in 11 contiguous version/CID-bound windows with an
exact hash match. Its 21 real capacity probes and one actual summary request
succeeded. Both real cases ended canonical-complete and native-idle, with closed
compaction intervals before device revocation/teardown, zero effects and unchanged
source/SDK/configuration during isolated testing.

Large-case planning was deterministic; capacity probes and summaries used real
local Qwen. These prove lifecycle/readback behavior, not natural planning quality
for every long task. The deployed natural private-chat Gmail check separately
passed the approved mailbox/query, provider result, source/session/native65536,
completion, idle and temporary-device revocation gates.
All 37 independent postdeployment checks passed. Broader household acceptance
and additional account grants remain separate.

## Retained diagnostics and rollout limits

Earlier startup, fixture import, provenance, native32/provider64 and verifier
attempts remain retained. Verification observes exact canonical native session/run
and full compaction lifecycle. Direct compactor transport can retain tools; tools
presence is not a reliable summary classifier. Missing transient diagnostics mark
evidence inconclusive instead of injecting provider failures. A new durable
nonempty summary/cut and completed native outcome remain mandatory.

Saved stock `tokensBefore` uses provider usage plus a legacy trailing estimate;
patched `tokensAfter` includes weighted history and fixed request costs. They are
reported as mixed-basis telemetry, not compared. Reduction uses a same-lifecycle
native prepare/commit pair with identical window/fixed/pending/reserve/reply,
lower input and fitting final request, followed by useful new-source work.
Commit logs alone do not establish durable compaction.

Two live verification reports were rejected by test assumptions: UTC dates
instead of the configured timezone, then exactly one successful native trace.
Actual reads/native64/cleanup had succeeded. The corrected verifier checks the
trusted local calendar and every successful trace, including framework content
and details. Wrong accounts, operations, filters or limits cannot hide behind a
valid result. Trace counts are not unique provider API counts. Originals remain.

Promotion captured source/SDK/both configuration preimages with complete
UID/GID/mode/ACL/xattrs and an inspection-only database backup. It proved native
and canonical inactivity, stopped and verified owners, replaced protected files
with new inodes, left the operator SDK stock, and attested the actual new Gateway
PID/config/patch before reopening credential ingress. A first preflight stopped
before writes because its observer used the maintenance UID; using the existing
service owner repaired that check without weakening private-file validation.
No database, session or provider records were restored. Scheduling remains off.

See the [pinned patch maintenance procedure](../deploy/hardybot/patches/README.md).
Replacement is atomic per file. Mixed/partial state stays closed for offline
forward repair. Code/config rollback uses captured preimages, complete metadata
and fresh attestation; it never restores older business records over newer state.
