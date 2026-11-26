# Operations

> Deployment host/account identifiers are redacted. Example addresses use
> `example.invalid`; paths use `$HOME`. Set actual connection, account and
> storage values from protected operator configuration.

**Current release, model and acceptance:** see [current status](current-status.md).
Use its running-configuration and verified-evidence sections rather than older
dated recovery check totals. Failed isolated data is retained; ordinary services
must have no fixture override. Scheduling stays disabled. Source/config/provider
rollback preserves current durable data and never replays external effects.
The older procedures and dated evidence below remain references.

## Remote login

From PowerShell on the management PC:

```powershell
ssh -F none -4 -o IPQoS=none -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -i "$env:HARDY_HOME_SSH_IDENTITY" "$env:HARDY_HOME_SSH_TARGET"
```

The deployment account is intentionally unprivileged. Enter the server user's
sudo password only at an interactive prompt; never copy it into configuration.

## Services

OpenClaw is installed under `$HOME/.openclaw` with private Node
`24.21.0`. The official systemd user unit is
`openclaw-gateway.service`.

```bash
systemctl --user status openclaw-gateway.service
systemctl --user restart openclaw-gateway.service
journalctl --user -u openclaw-gateway.service -n 200 --no-pager
$HOME/.openclaw/bin/openclaw health --json
$HOME/.openclaw/bin/openclaw channels status --json
```

Boot persistence is enabled: `loginctl show-user "$USER" -p Linger` should
report `yes`.

Ollama is independent of Jarvis, restarts through Docker, and binds only to
loopback:

```bash
docker ps --filter name=ollama-local
curl -fsS http://127.0.0.1:11434/api/version
curl -fsS http://127.0.0.1:11434/api/tags | jq -r '.models[].name'
docker exec ollama-local ollama ps
nvidia-smi
```

## Management access

The Control UI is `<private-control-ui-url>`. It uses a randomly
generated gateway token stored only in `$HOME/.openclaw/.env` (mode
`0600`). The LAN and localhost browser origins and auth rate limiting are
explicit in `openclaw.json`.

Discord uses the existing bot through an environment SecretRef. The shared
channel admits approved users, the private-notes channel admits its designated owner,
and the management channel admits only the operator. DMs are isolated per
account, channel, and user.

## Model configuration

- Provider: native OpenClaw `ollama`
- Endpoint: `http://127.0.0.1:11434` (not a `/v1` compatibility path)
- Main profile: `ollama/qwen3.8:27b-q4_K_M` (pre-production)
- Default/other profiles: existing `ollama/gpt-oss:20b` settings retained
- Fallback models: none
- Main Qwen context: **131,072**, aligned across `contextTokens`, `contextWindow` and provider `num_ctx`
- GPT/default and other profile context: **32,768**, unchanged
- Main reasoning default: `thinkingDefault=high` → native `think:"high"` → installed Qwen **XHIGH**; supported inline/session overrides retain precedence
- Advertised model output metadata: 2,048; metadata alone does not enforce native `num_predict`, and no production generation limit was added
- Provider timeout: 300 seconds
- Main Ollama parameters: `num_ctx=131072`, `keep_alive=30m`; other profiles retain their existing values
- Memory embeddings: `ollama/qwen3-embedding:8b` (4096 dimensions)
- Embedding fallback: `none`

The November 26 Main-only promotion updated protected and retained preparation inputs while preserving ownership, modes and all ACLs/xattrs. Boot attestation, isolation audit, live registry and deployed serialization passed. Two bounded 128K/high requests completed normally, with all 66 model layers offloaded and full API GPU residency; about 10.8K prompt tokens does not certify near-full 128K or semantic performance. Model identity, GPT profiles, output options and compaction were not changed. See [readiness and limits](dual-gpu-model-readiness.md). Household web readiness remains unavailable pending deferred network restoration; no network settings were changed.

The earlier host-tool baseline used the full profile; this is superseded for
managed household agents. Current household policy exposes typed scoped tools
and supported native task/child controls. Children are conversation-only.
Restricted analysis uses its fixed native child and output publisher; do not
reactivate broad host tools while diagnosing the pending native hook correction.

## Household data

Persistent household data is ordinary Markdown in isolated workspaces:

- Main private workspace: `$HOME/.openclaw/workspace`
- Adult private: `$HOME/.openclaw/workspace-natasha`
- Each workspace: `USER.md`, `MEMORY.md`, `memory/`, private `notes/`,
  and private `LISTS.md`
- Shared household lists/notes:
  `$HOME/.openclaw/shared/household/`
- Derived indexes: `$HOME/.openclaw/agents/<id>/agent/openclaw-agent.sqlite`

Useful memory checks:

```bash
$HOME/.openclaw/bin/openclaw agents list --bindings --json
$HOME/.openclaw/bin/openclaw memory status --deep --json
$HOME/.openclaw/bin/openclaw memory index --agent natasha --force
$HOME/.openclaw/bin/openclaw plugins info active-memory --json
```

The designated private agent's direct messages enable cross-conversation transcript recall. Its
private Discord channel uses the same isolated agent and file memory, but
OpenClaw does not ingest channel transcripts into Remember across
conversations.

Google Workspace uses `gog` `0.43.0`, OAuth client `house`, and account
`household-bot@example.invalid`. Calendar writes must use an explicit calendar ID and
be read back before success is reported.

The account and client select the existing authorization, not the destination
calendar. Every authenticated command passes
`--account household-bot@example.invalid --client house`. For calendar commands, the
positional calendar ID selects House (`household-bot@example.invalid`), Owner
(`alex@example.invalid`), or Adult (`natasha@example.invalid`). Generic references
such as "the calendar", "our calendar", "family calendar", and "household
calendar" default to House. Only an explicitly named destination calendar
overrides that default; attendees and phrases such as "for Owner" do not.

Calendar creation uses local wall times with
`--timezone America/New_York`, followed by `gog calendar event` readback using
the returned event ID. Do not manually select a numeric offset. Inspect
authorization only with `gog auth list`; never inspect gog credential, token,
or keyring files. An account in `gog auth list` proves configuration, not a
usable grant. Classify an actual read-only provider failure before asking for
reauthorization; never ask the user to paste credential contents into chat.

The complete non-negotiable calendar route and command shape live at the top
of `AGENTS.md`, which OpenClaw injects on every main-agent turn. The
workspace `gog` skill is the maintained deeper reference, but correct basic
calendar routing does not depend on the local model successfully loading that
skill.

Google Keep is a genuine integration gap: gog supports it only for Workspace
service accounts with domain-wide delegation, not this consumer OAuth account.
Markdown notes are the maintained local alternative.

The OAuth token has Google Tasks scope, but the Tasks API is disabled in Cloud
project `<google-project-id>`. Enable it here if Google-backed task lists are wanted:

<https://console.cloud.google.com/apis/library/tasks.googleapis.com?project=YOUR_PROJECT_ID>

Markdown list management works without that API.

Natural-language note and list capture uses the first-party
`household-capture` workspace skill. See
[`household-capture.md`](household-capture.md) for storage, recovery, dashboard,
and verification details.

PDF URLs and attachments use the first-party `local-documents` skill. Its
single entry point is:

```bash
$HOME/.openclaw/bin/read-pdf --url 'https://example.org/document.pdf' --mode auto
```

It runs a bounded fast text path or the pinned CPU-only Docling/RapidOCR
fallback and returns local Markdown/JSON evidence. See
[`local-documents.md`](local-documents.md) for limits, storage, versions, and
upgrade procedure. It does not authorize downstream calendar writes.

Complex requests use the first-party `task-conductor` skill. Jarvis keeps the
user-facing session as the conductor, runs substantial gather, act, and verify
phases in fresh worker sessions, and records compact recovery state under
`.openclaw/task-ledgers/`. Cumulative local tokens are diagnostic only; workers
are refreshed according to active context headroom and semantic progress.
Complete tool results stay in artifacts while paths, stable IDs, hashes, and
bounded evidence move between phases. The policy imposes no numerical
tool-call, turn, or concurrency limits. See
[`task-conductor.md`](task-conductor.md) for context allocation, recovery, and
failure classification.

The proposed default integration manages the bot-owned household calendar and
invites named people or recipients covered by an agreed rule. This does not
require direct write access to personal calendars. The older direct-edit route
requires the owner's separate calendar share/grant and is not implied by an
invitation. No credential can grant itself that authority.

## Updates and checks

Upgrade only after reading upstream release notes:

```bash
$HOME/.openclaw/bin/openclaw update
$HOME/.openclaw/bin/openclaw config validate
$HOME/.openclaw/bin/openclaw plugins doctor
systemctl --user restart openclaw-gateway.service
```

After a restart, verify gateway health, Discord status, an Ollama GPU process,
and one real read/write action. Do not treat a conversational claim as proof.
The redacted repository configuration is documentation; the active file is
`$HOME/.openclaw/openclaw.json`.

## Planned credentials and diagnosis

External secret storage uses the agreed Bitwarden automation-project direction,
reusing native SecretRef resolution. No connector is claimed deployed. Keep
bootstrap credentials protected, resolve secrets only inside trusted connectors,
and durably write back provider token rotations. See the
[credential design](household-assistant-design.md#bitwarden-and-integration-credentials).

Explicit log diagnosis is planned as an operator task with an enforced
operational read-only tool surface and a redacted evidence reader. It can report
a proposed fix but cannot apply it, restart services or replay mutating work.
A later repair instruction is a separate task. See the
[diagnostic design](household-assistant-design.md#explicit-diagnosis-without-repair).

## Slice 1 deployment and recovery

Household control 0.3.0 and application schema 2 are deployed. Use `/health`
for process liveness and `/ready` for initialized service plus a fresh
authenticated Gateway status probe. Neither promises free execution slots.
Admin platform readiness checks configuration/dependencies without a model
turn, vault lookup or household mutation.

See [Slice 1 evidence and rollback](slice-1-runtime-platform.md) before changing
delivery or restoring older code. The owner authorized cancelling historical
requests in this pre-production environment; records were retained and both
slots are now free. Future unknown effects require explicit reconciliation or
authorized cancellation, never blind replay.
`HARDY_HOME_DISPATCH_ENABLED=false` holds delivery while preserving new durable
payloads. Keep current state before source/configuration rollback; do not
overwrite post-cutover work with an older database. Complete functional and
restore acceptance follows the full three-slice build.

## Historical Slice 2 checkpoint

At the earlier Slice 2 checkpoint, pre-production service 0.4.0 used app schema 3
and Uplift schema 1. Both services and its native plugin were initialized and
two slots were free. This is dated evidence, not current availability. [Slice 2 evidence](slice-2-domain-capabilities.md) supersedes older
current-version statements while preserving their dated deployment history.

Use protected domain readiness for dependency/configuration state and the
native plugin's content-free initialization status for actual registration.
Neither runs a model, resolves a secret or certifies a household workflow.
Do not confuse production security mode (mock auth disabled) with production
rollout; the owner explicitly identified this system as pre-production.

Retain the pre-Slice-2 source/dependency/configuration/database/artifact backups.
Do not downgrade new contact/financial data into old readers or replay unknown
effects. OAuth, Bitwarden access, receipt catalog/grants and standing scheduler
authorization remain configuration work; agent/UI/diagnostic behavior and full
restore/functional acceptance remain after the complete build.


## Read-only system status

Household control 0.11.0 deploys optional `household_diagnostics_system_status` through the existing diagnostics domain. Protected source/allow-entry promotion, native registration, deployed collection, PID/config attestation and credential-isolation checks passed. It is available only to a current private operator with the diagnostics capability and domain grant, with authority rechecked through collection. Routine authorized status requests need no diagnostic goal. Existing task-evidence diagnosis still requires diagnostic mode.

The tool accepts no arguments and invokes one fixed bounded collector. It observes GPU VRAM/utilization/temperature/power when available, host CPU load and RAM, root-filesystem space, fixed service states and the loopback loaded-model list. It does not load a model or run inference. Device memory, Ollama resident model/cache allocation and context tokens are separate values; CPU load is not utilization. Overall status describes collection completeness, while each service reports its own observed state. Unavailable measurements are explicit and do not become healthy zeroes.

No arbitrary commands, paths, URLs, process lists, environment values or raw logs are exposed. The known application bind failures remain separate, and natural-language chat was not tested while network restoration is deferred. This feature changes no network, model/context/reasoning, credential grants, native core or database settings. See [implementation, checks and deployment acceptance](system-status-diagnostics.md).
