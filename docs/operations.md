# Operations

## Remote login

From PowerShell on the management PC:

```powershell
ssh -i $env:USERPROFILE\.ssh\jarvis_codex codex@192.168.1.127
```

The `codex` account is intentionally unprivileged. Enter the server user's
sudo password only at an interactive prompt; never copy it into configuration.

## Services

OpenClaw is installed under `/home/codex/.openclaw` with private Node
`24.21.0`. The official systemd user unit is
`openclaw-gateway.service`.

```bash
systemctl --user status openclaw-gateway.service
systemctl --user restart openclaw-gateway.service
journalctl --user -u openclaw-gateway.service -n 200 --no-pager
/home/codex/.openclaw/bin/openclaw health --json
/home/codex/.openclaw/bin/openclaw channels status --json
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

The Control UI is `http://192.168.1.127:18789/`. It uses a randomly
generated gateway token stored only in `/home/codex/.openclaw/.env` (mode
`0600`). The LAN and localhost browser origins and auth rate limiting are
explicit in `openclaw.json`.

Discord uses the existing bot through an environment SecretRef. The shared
channel admits both approved users, the private-notes channel admits Natasha,
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

- Main/shared: `/home/codex/.openclaw/workspace`
- Natasha private: `/home/codex/.openclaw/workspace-natasha`
- Each workspace: `USER.md`, `MEMORY.md`, `memory/`, `notes/`,
  and `LISTS.md`
- Derived indexes: `/home/codex/.openclaw/agents/<id>/agent/openclaw-agent.sqlite`

Useful memory checks:

```bash
/home/codex/.openclaw/bin/openclaw agents list --bindings --json
/home/codex/.openclaw/bin/openclaw memory status --deep --json
/home/codex/.openclaw/bin/openclaw memory index --agent natasha --force
/home/codex/.openclaw/bin/openclaw plugins info active-memory --json
```

Natasha's direct messages enable cross-conversation transcript recall. Her
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

For the intended Alex and Natasha calendars, each owner must share the calendar
with `hardy.aibot@gmail.com` and grant Make changes to events. No existing
credential can create those external shares.

## Updates and checks

Upgrade only after reading upstream release notes:

```bash
/home/codex/.openclaw/bin/openclaw update
/home/codex/.openclaw/bin/openclaw config validate
/home/codex/.openclaw/bin/openclaw plugins doctor
systemctl --user restart openclaw-gateway.service
```

After a restart, verify gateway health, Discord status, an Ollama GPU process,
and one real read/write action. Do not treat a conversational claim as proof.
The redacted repository configuration is documentation; the active file is
`/home/codex/.openclaw/openclaw.json`.
