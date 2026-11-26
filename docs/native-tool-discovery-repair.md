# Native tool discovery lifecycle repair

The 0.9.2 catalog repair and 0.9.3 invocation repair are deployed in healthy household control 0.9.3. Component and isolation checks passed. The automated signed ordinary private-conversation canary passed actual discovery, selected-account Gmail search and canonical completion. The earlier task-mode and 0.9.2 failures remain retained.

## Problem and behavior

Stock OpenClaw can build a tool catalog before an admitted invocation exists.
Its V2 context can contain an invocation guard that deliberately throws at that
stage. Calling that guard while listing metadata returned an empty household
catalog. Real private turns then received Unknown tool for domain selection
before reaching any account connector.

The plugin manifest also omitted the two connection-discovery tool names.
The SDK filters factory results against that manifest, so returning descriptors
alone could not expose those tools.

The repair separates metadata discovery from execution authority. A known,
current canonical conversation/profile/grant mapping can expose permitted
schemas before an invocation begins. Actual operations still require the
existing live source, session, identity, audience, grant and revocation checks.

## Reuse and ownership

| Boundary | Decision | Authority |
| --- | --- | --- |
| Metadata availability | Adapt existing catalogGrant | Canonical conversation/profile and current protected grants; schemas only. |
| Descriptor names and schemas | Reuse | Owning domain descriptors; plugin manifest is a checked registration projection. |
| Invocation authorization | Reuse unchanged | Stock SDK guard and existing native admission/bind/claim/scope boundaries. |
| Credential wire context | Adapt existing scoped invocation | One frozen, validated authoritative snapshot forwarded ephemerally for the same invocation. |
| Credentials and account reads | Reuse unchanged | Isolated credential service and Bitwarden; metadata discovery reads no secrets. |
| Tasks, goals and state | Reuse unchanged | Stock OpenClaw; no synthetic goals, new queue, store or permission system. |

Unknown, disabled, child and mismatched mappings remain empty. Shared audiences
receive only shared domains. Analysis and diagnostic helper roles retain their
existing narrow projections. A metadata result cannot authorize execution.

The changes stay within the existing catalog projection and scope/dispatch forwarding paths. Ownership stays in the existing runtime boundaries. A bounded future extraction can move catalog projection into a dedicated helper without moving admission or effects. That extraction is separate from this lifecycle repair.

## Executed verification

Actual installed-SDK factory contexts with a throwing pre-invocation guard now
expose domain selection and both connection-discovery schemas after the existing
graph initializes. Unknown, child, disabled, mismatched and shared/private cases
retain their scoped results. The execution callback still refuses before effects
when the stock SDK guard throws. Positive bound-invocation, current-source and
revocation checks passed. Manifest descriptors and optional metadata agree with
the registered 90-name tool projection.

The protected gateway was restarted and fresh PID/configuration/domain hash
attestation passed. Independent checks verified root-owned regular protected
files, both optional connection-discovery entries, 90 stock CLI tool names,
security audit and trusted HTTPS 0.9.3 readiness. The combined source passed
584/584 Ubuntu backend tests with zero skips and validation of 191 source files.

The owner-authored 0.9.2 target-account test failed with
`native_session_generation_changed`. Its source and native evidence are retained.
The 0.9.3 signed application canary subsequently completed actual native account
discovery followed by one selected-connection Gmail search with `newer_than:7d`
and limit 1. The native result came from the connected-Google consumer and the
assistant emitted only a success marker. Its temporary device was revoked and
all conversation/submission evidence remains retained.

The initial automated helper used task mode, which created a formal goal without its required completion checkpoint. Its canonical receipt correctly ended `failed` with `task_incomplete_after_native_run`. No execution or continuation remains active, and the failed source cannot authorize more reads. This attempt and its idle goal remain retained. The separate signed helper matching ordinary private-chat conversation mode then passed. The existing task-completion boundary is preserved.


The successful ordinary-mode canary used the real signed application submission
path in a new private owner conversation. Exact native metadata confirmed
connection discovery before one selected-connection `newer_than:7d` search with
limit 1, the connected-Google result and a boolean-only success reply. The
canonical receipt ended `complete` and native completion was confirmed. No other
provider or domain calls occurred, and its temporary device was revoked with no
recorded uncertainty. This verifies the limited first-account Gmail pipeline
through normal private-conversation mode.

## Normalized invocation forwarding in 0.9.3

The first deployed catalog repair exposed the expected schemas but the real
private turn then failed generation matching at the credential boundary. The
0.9.3 repair freezes one enriched snapshot using the existing native context observation, validates it with unchanged `NativeDomainAuthorization.resolve()`, and forwards the exact eight identity/session/run/goal fields through `scope.credentialAuthority` for that same call.

The existing SDK invocation guard, admitted source, current session generation,
identity/device, private audience, personal grants, selected connection scope,
cancellation, revocation and isolation checks remain execution requirements.
Metadata discovery provides schemas only. Existing native execution and the
household/credential services retain their authoritative roles.

## Rollback and limits

Retain public source preimages and current business records. Rollback changes
only reviewed source and registration metadata, then restarts the gateway.
Never restore a database or older credential over newer records or provider
effects. Scheduling, provider grants, SDK pins and raw host-tool restrictions
remain unchanged.

Calendar and financial consumers remain separate. Direct provider verification
has passed for the first authorized Gmail grant, while live refresh-token
rotation writeback remains unexercised. NVIDIA 595.99.02 and the existing Ollama
0.32.15/Qwen3.8 configuration are restored. All 11 historical jobs remain disabled
and the release remains pre-production.


The later ordinary-request check exposed an additional omitted-connection route
gap: the explicit-connector 0.9.3 canary had not covered the default CLI branch.
Service 0.10.1's [default-route repair](default-gmail-routing-repair.md) now passed
a natural signed request with no connection ID in either prompt or search
arguments. The earlier scoped discovery and invocation proofs remain retained.
