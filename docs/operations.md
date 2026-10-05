# Operations

## Remote login

From PowerShell on the management PC:

```powershell
ssh -i $env:USERPROFILE\.ssh\jarvis_codex operator@example.invalid
```

The `codex` account is intentionally unprivileged. Enter the server user's
sudo password only at an interactive prompt; never copy it into configuration.

## Services

OpenClaw is installed under `/home/operator/.openclaw` with private Node
`24.21.0`. The official systemd user unit is
`openclaw-gateway.service`.

```bash
systemctl --user status openclaw-gateway.service
systemctl --user restart openclaw-gateway.service
journalctl --user -u openclaw-gateway.service -n 200 --no-pager
/home/operator/.openclaw/bin/openclaw health --json
/home/operator/.openclaw/bin/openclaw channels status --json
```

Boot persistence is enabled: `loginctl show-user codex -p Linger` should
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

The Control UI is `http://192.0.2.10:18789/`. It uses a randomly
generated gateway token stored only in `/home/operator/.openclaw/.env` (mode
`0600`). The LAN and localhost browser origins and auth rate limiting are
explicit in `openclaw.json`.

Discord uses the existing bot through an environment SecretRef. The shared
channel admits both approved users, the private-notes channel admits Adult,
and the management channel admits only the operator. DMs are isolated per
account, channel, and user.

## Model configuration

- Provider: native OpenClaw `ollama`
- Endpoint: `http://127.0.0.1:11434` (not a `/v1` compatibility path)
- Primary: `ollama/gpt-oss:20b`
- Fallback models: none
- Context: 32,768
- Maximum output: 2,048
- Provider timeout: 300 seconds
- Ollama parameters: `num_ctx=32768`, `keep_alive=30m`
- Memory embeddings: `ollama/qwen3-embedding:8b` (4096 dimensions)
- Embedding fallback: `none`

Host tools use OpenClaw's `full` profile and execute as the `codex`
account on the gateway. Filesystem tools are not restricted to the OpenClaw
workspace. Elevated/sudo execution is disabled, preserving the OS privilege
boundary.

## Household data

Persistent household data is ordinary Markdown in isolated workspaces:

- Main/shared: `/home/operator/.openclaw/workspace`
- Adult private: `/home/operator/.openclaw/workspace-natasha`
- Each workspace: `USER.md`, `MEMORY.md`, `memory/`, private `notes/`,
  and private `LISTS.md`
- Shared household lists/notes:
  `/home/operator/.openclaw/shared/household/`
- Derived indexes: `/home/operator/.openclaw/agents/<id>/agent/openclaw-agent.sqlite`

Useful memory checks:

```bash
/home/operator/.openclaw/bin/openclaw agents list --bindings --json
/home/operator/.openclaw/bin/openclaw memory status --deep --json
/home/operator/.openclaw/bin/openclaw memory index --agent natasha --force
/home/operator/.openclaw/bin/openclaw plugins info active-memory --json
```

Adult's direct messages enable cross-conversation transcript recall. Her
private Discord channel uses the same isolated agent and file memory, but
OpenClaw does not ingest channel transcripts into Remember across
conversations.

Google Workspace uses `gog` `0.43.0`, OAuth client `house`, and account
`hardy.aibot@gmail.com`. Calendar writes must use an explicit calendar ID and
be read back before success is reported.

Google Keep is a genuine integration gap: gog supports it only for Workspace
service accounts with domain-wide delegation, not this consumer OAuth account.
Markdown notes are the maintained local alternative.

The OAuth token has Google Tasks scope, but the Tasks API is disabled in Cloud
project `988413896481`. Enable it here if Google-backed task lists are wanted:

<https://console.cloud.google.com/apis/library/tasks.googleapis.com?project=988413896481>

Markdown list management works without that API.

Natural-language note and list capture uses the first-party
`household-capture` workspace skill. See
[`household-capture.md`](household-capture.md) for storage, recovery, dashboard,
and verification details.

PDF URLs and attachments use the first-party `local-documents` skill. Its
single entry point is:

```bash
/home/operator/.openclaw/bin/read-pdf --url 'https://example.org/document.pdf' --mode auto
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

For the intended Owner and Adult calendars, each owner must share the calendar
with `hardy.aibot@gmail.com` and grant Make changes to events. No existing
credential can create those external shares.

## Updates and checks

Upgrade only after reading upstream release notes:

```bash
/home/operator/.openclaw/bin/openclaw update
/home/operator/.openclaw/bin/openclaw config validate
/home/operator/.openclaw/bin/openclaw plugins doctor
systemctl --user restart openclaw-gateway.service
```

After a restart, verify gateway health, Discord status, an Ollama GPU process,
and one real read/write action. Do not treat a conversational claim as proof.
The redacted repository configuration is documentation; the active file is
`/home/operator/.openclaw/openclaw.json`.
