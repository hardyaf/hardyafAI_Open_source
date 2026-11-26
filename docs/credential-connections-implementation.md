# Hardy Home credential connections

## Execution and scope

The owner requested the protected Connections flow on November 25, 2026, releasing the earlier hold for this implementation and its deployment. Provider consent, vault access and account selection are completed by the owner through the protected interface. No provider grant is inferred from a saved credential. Scheduling remains disabled.

The owner-only Hardy Home Connections flow provides Bitwarden Secrets Manager setup, password entry and Google OAuth onboarding. Credentials are stored directly in Bitwarden, their immutable IDs bind explicit account operations, and the model receives connection status and authorized tool results. Provider-specific finance feeds and arbitrary browser login execution remain outside this connection-management change.

## Reuse map

| Boundary | Decision | Application |
| --- | --- | --- |
| User/device authorization | Reuse | Existing enrolled P-256 device signatures, replay prevention, profile and capability checks. |
| Application transport and clients | Adapt | Dedicated Connections requests over authenticated HTTPS, bypassing chat, dictation, attachments and saved submission payloads. |
| Secret authority | Reuse/adapt | Bitwarden Secrets Manager and pinned official SDK. Add initial creation and exact readback to existing retrieval and replacement contracts. |
| Durable metadata | Adapt | Add a connection metadata repository to the existing household SQLite authority. No additional secret or identity database. |
| OAuth | New narrow provider adapter | Existing code has no initial authorization or callback. The adapter owns Google state, PKCE, account verification and credential exchange, reuses Bitwarden storage and current profile ownership. |
| Credential process isolation | Adapt | Stock runtime/tool policy and OS process boundaries. Secret entry remains unavailable until isolation and HTTPS checks succeed. |
| Task, session and operation ownership | Reuse | Native OpenClaw remains execution authority. Connections do not create a task queue or copy credentials into model sessions. |

## Data ownership

| Datum | Owner and lifecycle |
| --- | --- |
| Provider passwords, refresh tokens, client secrets | Bitwarden. No local credential mirror. A trusted consumer may hold the selected value temporarily. |
| Vault bootstrap | Protected host service configuration, required to open the external secret authority. Never a model tool result. |
| Connection label, owner, resource grant, secret ID and status | Existing household database. Owner-filtered and no secret values. Disconnect disables use without deleting business history. |
| OAuth state and PKCE verifier | Trusted connector memory with a short expiry. Restart expires incomplete consent and requires retry. |
| Form values | Temporary native/browser field state. Bypass draft persistence, logging, analytics, chat and artifacts. |
| Provider grants and account data | Provider. Local metadata records only configured scope and verified identity. |

## Acceptance and rollback

Run all builds, meaningful boundary tests and UI checks on Ubuntu. Test owner/revoked-device rejection, plaintext HTTP rejection, secret-free errors/results/storage, duplicate and uncertain vault writes, OAuth state/identity mismatch, restart and failed refresh. Real provider/vault access is accepted only after the owner completes setup. Retain source/config backups and additive migrations. Roll back source and service configuration without replacing newer household databases or provider effects.

## Implementation status

Connection management is implemented and deployed. The current service is 0.9.3. Acceptance below distinguishes setup, direct provider reads, native tool execution and canonical terminal receipts. The isolated ingress serves the protected web bundle and connection endpoints, and proxies ordinary application traffic to the existing private control listener. The existing household device and metadata authority is shared by both processes. The daemon runs under its own OS identity with protected code and bootstrap state. Activation verifies the effective root-owned native policy and actual system gateway identity before credential entry is available.

Google OAuth uses the pinned official google-auth-library 11.3.4. Supported private reads are Gmail search/message and primary-calendar list/event. Gmail content is projected as bounded plain text and selected headers. HTML-only messages use the provider snippet. Stored password credentials are bound to an exact HTTPS origin for later trusted consumers. This change provides their secure entry and storage, while concrete browser login consumers remain a separate provider integration.

A registered HTTPS DNS callback saves Google credentials automatically. The private IP deployment uses a registered loopback redirect and a secure completion field for the full returned authorization URL. No token needs to be copied into chat or Bitwarden by the owner. External Testing-mode Google grants still have Google's seven-day limitation.

Uncertain initial secret creation is recorded before the provider effect. A retry reconciles an existing exact key and value and cannot issue a second creation after an uncertain result. Uncertain refresh or writeback remains visible and blocks blind replay. Bitwarden SDK updates are expected-value checks and readback, without a server-side atomic CAS guarantee. One daemon owns these writes.

Ubuntu acceptance passed 558 backend tests, zero skips, five Bitwarden helper tests, 16 isolation/deployment tests and 16 synthetic browser checks. Android 0.6.0-alpha / code 10 assembled, passed lint with zero errors and 11 unit tests. The final generated API client is 0.7.0 and rejects HTTP for Connections requests.

The protected OS installation is activated. After automatic approval review rejected the initial broad provisioning method and the AppArmor exception, the owner explicitly approved a temporary exception. The bounded networkless container launched the reviewed host installer through systemd and was removed. Effective configuration, static assets and runtime are protected, while only the derived stock plugin-skills cache is writable by the ordinary gateway identity. A separate protected Node executable preserves the original SecretRef ownership contract. Shared pinned static library inodes avoided exhausting root storage; failed attempts and duplicate-SDK manifests remain inspectable.

Live HTTPS verification passed nine checks: trusted readiness, owner identity and security-ready empty Connections state, unsigned/child/revoked-device refusal, HTTP credential refusal and protected asset delivery. Temporary test devices were revoked. The public stock SDK factory verified Main/Natasha core tool surfaces without prohibited host tools. Credential daemon restart, enabled boot units, actual service-user audit, pinned SDK imports and synthetic bidirectional SQLite sidecar access passed. All 11 historical schedules remain disabled.

The owner subsequently configured the Bitwarden machine connection. Live synthetic verification authenticated to the exact configured organization/project, created and read a dummy secret, updated and read it back, and removed only its verified immutable ID. Provider deletion acknowledgement and metadata absence confirmed cleanup. The token stayed inside the dedicated credential identity, and no existing account secret values were inspected. The later owner consent and direct Gmail verification are recorded below. Physical Android interaction remains an owner step. Rollback restores only changed service/configuration settings and retains current household databases, vault state and provider effects.

## OAuth client completion patch

Release 0.9.1 adapts the existing Google provider adapter, configuration
validation and client status presentation. The existing Bitwarden boundary,
credential identity, canonical metadata repository and scoped native consumer
are reused. Data ownership and grants are unchanged; no service, store, queue
or parallel authorization mechanism was introduced.

A live synthetic-code comparison isolated client-secret outer whitespace.
Maintenance stopped the credential writer, corrected only that field through
the existing expected-value replacement interface, and read back the same
immutable secret ID. No provider grant or mailbox/calendar data was touched.
Uncertain replacement is reconciled by authoritative readback, never replayed
blindly or restored over newer values.

Provider errors are projected to fixed codes by exchange/verification stage.
Raw provider messages, request configuration, authorization codes and token
values cannot enter the public error. The official SDK and Gaxios can override
constructor retry settings; final-boundary boolean and numeric retry controls
are both disabled and bounded by the existing timeout. Actual installed-SDK
lost-response tests verify one attempt for exchange, refresh, revocation and
certificate retrieval. Secret whitespace normalization applies only to Google
application credentials, with a regression preserving delegated passwords.

The browser explains localhost completion and clears consumed flows while
retaining correctable callback input. It no longer claims machine-token
replacement is available. Ubuntu acceptance passed 574 backend checks, 189-file
source validation, 28 browser cases, Android build/lint and 11 unit checks.
Physical phone interaction and Calendar consent remain pending. The first Gmail grant and production-service provider reads have now passed.

The first maintenance guard stopped before the vault write because shutdown
ended in a terminal failed state after its 75-second deadline. The corrected
guard requires zero MainPID and terminal inactive/failed state before writing.
The shutdown delay's cause remains unconfirmed. Failed attempts and source
preimages are retained. Rollback may restore reviewed source files, while
preserving the corrected vault value, current database and provider effects.

## First Gmail provider acceptance

The owner completed genuine consent through Hardy Home. The first saved Gmail
read-only grant passed fresh provider identity comparison, two offline refreshes,
Gmail search and one metadata-only message read through the unchanged production
Connections service. Only pass/fail metadata left the trusted helper. Scope
enforcement rejected Calendar reads from that email-only grant. No rotated token
was issued, so rotation writeback remains covered by regression checks rather
than this live attempt.

Verification held the daemon stopped and checked its terminal state, zero PID
and empty cgroup before composing the same service/vault/provider under its
dedicated OS identity. Current owner and existing personal-device checks fenced
every phase. Service restart and trusted readiness passed afterward. This established provider/service acceptance. At that stage, native verification was blocked by missing current-kernel NVIDIA modules. The separately approved restoration and later native attempts are recorded below.

## Native provider restoration

The owner separately approved the standard Ubuntu NVIDIA package repair needed
for the normal local assistant check. It preserved package/module preimages,
verified the exact approved package plan and archive hashes, loaded a matching
current-kernel driver and started only the existing pinned Ollama container.
No credential, grant, native-policy or model configuration changed.

Independent package/GPU/service checks and one empty direct local Qwen response
passed without a reboot. This restored provider availability. The subsequent native attempts and their remaining receipt-settlement gate are recorded below. Restoring an older GPU module alone is not a full driver rollback:
userspace, module and running-kernel versions must remain compatible. Current
business records and provider effects must be preserved during any rollback.


## Native catalog and invocation forwarding

Release 0.9.2 adapts the existing `catalogGrant` projection for stock SDK
metadata discovery before an invocation is admitted. Canonical conversation,
current profile, audience and protected grants determine available schemas.
Unknown, child, disabled, stale and mismatched mappings remain scoped or empty.
Actual execution still requires the SDK guard and the existing source admission,
claim, session-generation and revocation checks. The plugin manifest now declares
both connection-discovery tool names with optional metadata. Its 90-name
registration matches the stock CLI projection.

The owner-authored private 0.9.2 target-account attempt failed with
`native_session_generation_changed`. That failure was retained and led to the
0.9.3 forwarding repair. The runtime freezes one enriched snapshot from the existing native context observation, validates it through unchanged `NativeDomainAuthorization.resolve()`, then forwards the exact eight identity/session/run/goal fields through `scope.credentialAuthority` for that same invocation. The
consumer still resolves and rechecks the current principal, personal grant,
private audience, selected account permission, cancellation and isolation state.
Raw SDK aliases cannot replace the normalized authoritative session binding.

These changes reuse the stock native runtime, canonical household admission and
metadata, scoped credential consumer and Bitwarden writer. They introduce no new
queue, identity model, permission store or credential mirror. Execution ownership
and data ownership remain with the existing authorities.

The combined 0.9.3 source passed 584/584 Ubuntu backend tests with zero skips and 191-file source validation. Protected file ownership, manifest optional metadata, stock CLI
registration, fresh gateway attestation, security audit and trusted readiness
passed after deployment. Catalog and invocation checks retain negative cases
for pre-invocation execution, mismatched sessions, revoked sources, children and
private/shared audience boundaries.

A temporary enrolled personal device then submitted the automated canary through
the ordinary signed application API in a new private owner conversation. Native
connection discovery confirmed the named account and immutable connection before
one selected-connection Gmail search using `newer_than:7d` and limit 1. Retained
native evidence confirms the connected-Google result and a boolean-only assistant
success reply. The temporary device was revoked. Exported verification evidence contains only IDs, statuses, tool names and boolean checks.

The initial automated helper used task mode and created a formal goal without its required completion checkpoint. The canonical receipt ended `failed` with `task_incomplete_after_native_run`, preserving the existing completion policy. No execution or continuation remains active, and the failed source has no remaining read authority. That attempt, idle goal and the earlier 0.9.2 generation-change failure remain inspectable. A separate signed canary using the ordinary private-chat conversation mode subsequently passed the limited first-account Gmail application acceptance case. Calendar, financial consumers and physical Android
interaction remain separate. Google issued no replacement refresh token in the
verified provider attempt, so live rotation writeback remains unexercised. The
release remains pre-production. Rollback preserves current business records,
credentials, grants and provider effects.


## Ordinary private-conversation verification

The separate automated canary used the normal signed personal-device API and
ordinary conversation mode in a new private owner chat. It verified the named
account through connection discovery before one exact selected-connection Gmail
search with `newer_than:7d` and limit 1. The result came through the isolated
connected-Google consumer. The assistant emitted only the success marker, the
canonical receipt ended `complete`, and native completion was confirmed. No other
provider or domain call occurred. The temporary device was revoked with no
recorded uncertainty. Conversation, submission and content-free audit evidence
are retained.

This establishes the automated signed native application path for that bounded
Gmail read. The earlier task-mode incomplete-goal receipt and 0.9.2 generation
failure remain retained. Task-completion policy, source/session/device and grant
checks remain enforced. Calendar, financial consumers, physical phone use and
live refresh-token rotation writeback remain separate acceptance work. The
release remains pre-production.


## Default private Gmail route in 0.10.1

The isolated credential service now resolves an omitted email connection ID
against the protected configured mailbox identity and that signed owner's
canonical Gmail-read bindings. It requires one current matching binding and
uses the unchanged owning read/refresh path. Historical disconnected entries
remain retained; unknown/current duplicates stay ambiguous. No caller can
supply a default account or secret selector, and no connected failure falls
back to the CLI or another private account.

The natural signed private-chat search passed without connector IDs in the
prompt or tool arguments, with actual approved-account connected-Google
receipts and canonical completion. Component acceptance passed 603/603 checks;
independent deployment acceptance passed 23 checks. The larger multi-message
context-overflow investigation is separate from credential connectivity. See the
[default-route record](default-gmail-routing-repair.md).
