# Slice 1 platform adapters

These modules are shared foundations. The final functional campaign remains deferred until the full three-slice build. No vault value, agent task or household record is exercised by readiness checks.

## Artifact integration

Import ArtifactStore and artifactResponseHeaders from services/household-control/src/platform/index.ts. Construct with the protected application state root/artifacts, initialize once, and inject into the HTTP composition root. The HTTP layer derives profile, conversation access and current task scope before calling it.

put(scope, principal, input) commits immutable content and metadata atomically. An idempotency key is bound to owner/conversation/task and conflicts on changed content or audience. Input/output/evidence bytes remain in the artifact store; native model prompts receive references or explicitly admitted bounded attachments. get/read/list enforce owner or permitted household read scope. Downloads must use artifactResponseHeaders so HTML/SVG/JSON are attachments and active content is sandboxed.

The store owns files and manifests, not task execution. Native OpenClaw remains task/session authority. The application authorizes the scope; an artifact ID cannot grant a task or household permission. Use private 0700 application-owned directories, and include the artifact root in consistent application backups.

## Native execution profiles

Build deploy/hardybot/analysis-sandbox.Dockerfile into a fixed image, record its digest, and use that same image value in profile config and NativeExecutionPolicies. The image has fixed Python/numpy/pandas/matplotlib/Pillow dependencies installed at build time.

tools/render-native-platform-config.mjs takes protected state root, fixed image and UID:GID, and prints a merge patch. It never writes live configuration. Merge its two helper profiles using the existing trusted config path; do not replace family profiles or Gateway configuration.

The helpers are execution profiles, not additional family identities. Both use native Docker sandbox mode all, scope session, no agent workspace access, read-only root, no network/host binds/elevation and no delegation. Analysis permits sandbox file/process tools. Diagnosis permits only read and requires native persisted read-only session permission.

NativeExecutionPolicies({configPath,image}).assertReady(agentId) is the adapter's restrictedRuntimeCheck callback. It revalidates trusted configuration before admission. readiness() reports configuration evidence, not proof an analysis or diagnosis succeeded.

NativeExecutionCoordinator is internal, not a standalone task queue or public run endpoint. Its submit method requires an injected NativeAdmissionCheck from the existing admitted household/native task authority; without it, submission fails native_admission_required. That callback rechecks owner, task, pause/cancel state, request fingerprint and available admission before session creation and before the native turn. Inputs must match the same owner/conversation/task/audience. Do not bypass household admission by calling the adapter directly.

The native adapter owns exact sessions.create/chat.send wire contracts, stable session keys and idempotency. Analysis input attachments are bounded text/JSON/Python artifacts; image/PDF workflows first use the owned extraction capability. Outputs remain native session workspace/artifacts until the existing task publication mechanism projects them into household outputs. Functional output harvesting and agent behavior are accepted in later slices.

## Bitwarden SecretRef

tools/bitwarden-secret-resolver.mjs implements the native exec protocolVersion 1 stdin/stdout contract. Configure an absolute trusted Node binary as command and the absolute resolver script path as its first argument. Pass only BWS_ACCESS_TOKEN, BWS_BIN, BWS_CONFIG_FILE, BWS_ALLOWED_SECRET_IDS, optional BWS_SERVER_URL and the minimum PATH/LANG environment. Set jsonOnly true and a ten-second outer timeout.

BWS_BIN is an absolute trusted regular executable. BWS_CONFIG_FILE is required and must be a private regular single-link file containing only the supported dedicated TOML profile:

    [profiles.hardy_home]
    state_opt_out = "true"

An optional HTTPS server_base may be added inside that profile for self-hosting. The resolver accepts only these fields and explicitly passes --config-file and --profile hardy_home, so the user's default personal CLI config/state is never selected. Optional BWS_SERVER_URL must match server_base and is deliberately omitted from the child environment: native bws --server-url replaces its profile and would discard state_opt_out. No auth state cache is read or written. BWS_ALLOWED_SECRET_IDS is a comma-separated exact UUID allowlist. Each SecretRef id is an immutable Bitwarden Secrets Manager UUID. The resolver calls bws --output json secret get ID without a shell or token on argv. It returns only requested permitted values; errors contain fixed codes and never stderr or provider response text. It does not list the vault, mutate secrets, unlock a Password Manager vault or silently change accounts.

Keep the bootstrap token in existing protected service configuration. No BWS CLI/token/allowed IDs means unconfigured, not a fabricated success. The SecretRef resolver remains read-only. Trusted refresh/writeback and delegated browser use are provided by the separate connector below; onboarding and real credential acceptance remain held.

inspectPlatformDependencies checks configured executable/bootstrap presence only. It does not resolve a secret or make a provider call. It verifies the dedicated no-cache configuration before calling a dependency configured.

## Read-only diagnostic evidence

buildDiagnosticEvidence produces a bounded whitelist of task IDs, phases, outcome/error codes, timestamps, token/compaction/finish-reason metadata and versions. It accepts no raw log/error text, credential values or transcript body fields. Save its JSON as an evidence artifact in the same admitted task scope.

The entire diagnostic session and any continuation remain read-only. Its restricted profile has no exec, write, network, provider mutation or delegation tool. The parent task guard applies the same restriction; returning a proposed fix does not authorize another agent to apply it.

## Trusted credential lifecycle

`BitwardenCredentialConnector` in `bitwarden-credential-connector.mjs` adapts the existing exact-ID resolver. Its protected binding map defines connection aliases, immutable secret IDs, allowed profile IDs, permitted uses and exact HTTPS browser origins. These methods are trusted connector interfaces, never plaintext model tools. Bitwarden remains the only credential authority; existing integration effect receipts own operation outcome. No local secret database, vault mirror, additional queue or automatic personal-vault unlock is introduced.

`refreshProvider(alias, context, refresh)` first validates write authority, protected configuration, executable/script trust and an isolated exact-version SDK import probe. The readiness subprocess receives no bootstrap token and performs no authentication. Unavailable writeback prevents both secret resolution and provider refresh. The connector then resolves the selected current credential, calls the trusted provider refresh callback and, when it returns a replacement, requires authoritative writeback/readback before reporting success. Failures after a potentially rotating callback are reported as unknown, including later grant/configuration/readback failures. Context contains the authenticated profile and a current-authority fence. Concurrent refresh attempts against the same secret in one connector are rejected before another provider refresh. The owning integration must reuse its existing operation receipt after an uncertain refresh; it must not repeat the provider mutation blindly.

`bitwarden-secret-writeback.py` uses the official **bitwarden-sdk 2.1.0** dependency pinned in `requirements-bitwarden.txt`. The bridge accepts the exact ID, previous value and replacement through stdin. Values never appear in argv, persisted files, model prompts or returned receipts. It logs no SDK errors or responses and disables SDK state-file caching. Existing key, note, organization and project membership are retained. Readback must match the replacement and unchanged metadata. A conflicting current value is not overwritten; an already matching replacement reconciles a response-lost write. This is an expected-value check plus readback, not a server-side atomic compare-and-swap guarantee; keep one owning integration writer per binding.

The read resolver still requires `BWS_BIN`, the dedicated private `BWS_CONFIG_FILE`, `BWS_ACCESS_TOKEN` and `BWS_ALLOWED_SECRET_IDS`. Writeback additionally requires exact `BWS_ALLOWED_WRITE_SECRET_IDS`, absolute trusted `BWS_SDK_PYTHON` and `BWS_SDK_SCRIPT` (the interpreter may be a protected virtualenv alias to a trusted executable; its original invocation path is preserved, while the SDK script must be a regular nonsymlink file), and explicit HTTPS `BWS_SDK_API_URL` and `BWS_SDK_IDENTITY_URL` in protected host configuration. Provision the pinned dependency in the connector's isolated virtual environment, not the model sandbox. The SDK subprocess receives only its minimal environment, never HOME, personal vault configuration or inherited unrelated credentials. Missing configuration is unavailable, not successful rotation. No real bindings/bootstrap or provider configuration are installed by this implementation.

`useBrowserLogin(alias, context, {origin}, consume)` accepts only deliberately delegated automation credentials stored as a JSON object containing username and password. The protected binding must authorize the profile, browser use and exact actual page origin; context must carry the admitted task and human source prompt. A trusted browser adapter consumes the credential directly without recording password entry in prompts, screenshots, transcripts or artifacts, and returns only `authenticated`, `human_required` or `failed`. It must check the actual browser origin immediately before filling and keep redirects/challenges inside its own adapter boundary. MFA, CAPTCHA, passkeys and new consent remain human-required. This does not unlock Password Manager or grant the agent arbitrary vault/browser access. Browser and OAuth adapters require explicit connection wiring and real acceptance when their held onboarding is released.

Primary API evidence: [Bitwarden's official SDK documentation](https://bitwarden.com/help/secrets-manager-sdk/), [official 2.1.0 package metadata](https://pypi.org/pypi/bitwarden-sdk/2.1.0/json), [official Python client API](https://github.com/bitwarden/sdk-sm/blob/main/languages/python/bitwarden_sdk/bitwarden_client.py). The pinned wheel was statically inspected for `get`, `update` and response attributes; contract tests use fake providers and no secrets. The CLI's documented edit path accepts a value on argv, so this connector uses the SDK instead.

## Targeted diagnostic evidence

`readTaskDiagnosticEvidence` adapts the existing submission, checkpoint, native-grant and effect owners. An explicit diagnosis may select `targetSubmissionId` or `targetRunId`; source references prefixed with `user:` are normalized to their existing receipt. The selected receipt must belong to the same authenticated profile, even for an operator. Retained child-run grants resolve back to their admitted root receipt while native observation follows the exact child session/run. Source-reference continuations include their original authorized effect source. No cross-adult transcript authority is granted.

Checkpoint lookup uses the selected goal and session, including retained historical goal checkpoints after a new diagnostic goal starts. The result contains target references, phase, lifecycle/error codes, scoped effect metadata, recent same-profile request references and native metrics. It never returns request text, transcript prose, credential values, provider error messages or raw logs. This lets Main select an affected prior request and reason from evidence without repairing anything.

The trusted native adapter reads `sessions.describe`, bounded `chat.history` metadata and exact `agent.wait` terminal observation. Context budget data uses the native pre-prompt estimate, remaining budget after reserve and route where present; exact-run usage/finish metadata is separately matched. A later run's session counters cannot be attributed to an earlier run. Estimated headroom is labeled by its basis.

`native-diagnostic-hooks.mjs` additionally projects actual `model_call_ended`, `llm_output` and `after_compaction` metadata. Its fixed whitelist includes safe numeric payload/timing/usage/context fields, native stop reasons and termination kinds, and a bounded internal error-category vocabulary. Native `errorCategory` is an open string field; unrecognized values become the fixed `provider_error` category. It never forwards prompts, model text, raw provider errors, model aliases, credentials, transcript paths or session-file contents. `compactedCount` is retained as a count of compacted messages, not incorrectly reported as the number of compaction operations. One captured `after_compaction` event is one observed compaction.

`native-diagnostic-events.ts` stores those small projections as **private evidence in the existing ArtifactStore**, attributed to the exact admitted source/run/session. The root rechecks the current native grant and source before capture. No event database, log mirror, worker or queue is added. A maximum of 64 immutable evidence records per run bounds diagnostic storage; this cap drops further diagnostic capture and never limits productive agent work. Exact duplicate observation IDs reconcile after process-object restart, concurrent writers use immutable slot conflicts, and direct deterministic slot lookup avoids dependence on broad artifact listing. Reads verify content integrity, owner, source and run. A full capture window is conservatively labeled truncated; observed compaction counts are a lower bound when capture coverage is incomplete. Historical records remain under the same private artifact backup/deletion lifecycle as other task evidence; this change adds no independent retention service.

Missing counters, pre-deployment observations and expired child grants remain explicitly unavailable. These observations are read projections, not an assertion that every provider retains every metric or that every event was captured.

Focused regression coverage is in `diagnostic-evidence.test.ts`, `native-diagnostic-events.test.ts`, `credential-lifecycle.test.ts` and `tools/tests/test_bitwarden_writeback.py`. Source changes are implemented; Ubuntu execution and real-provider acceptance are recorded in the consolidated implementation campaign, not implied by this document.
