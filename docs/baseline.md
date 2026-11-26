# Redacted pre-cutover baseline

> Deployment host/account identifiers are redacted. Example addresses use
> `example.invalid`; paths use `$HOME`. Set actual connection, account and
> storage values from protected operator configuration.

**Historical installation baseline:** preserve this initial snapshot as evidence.
Use [current status](current-status.md) for observed availability and the
[living design](household-assistant-design.md) for current product intent.

Captured on 2026-10-04 before OpenClaw activation.

## Host and resources

- Hostname: the deployment host
- OS: Ubuntu 26.04 LTS
- Kernel: `7.0.0-34-generic`
- CPU: 32 logical CPUs
- RAM: 121 GiB; swap: 8 GiB
- GPU: NVIDIA GeForce RTX 3090, 24 GiB
- Root filesystem before cleanup: 98 GiB total, 91 GiB used, 2.9 GiB free
- Root filesystem after obsolete image/container/build-cache cleanup: 44 GiB
  used, 50 GiB free

The host booted kernel `7.0.0-34`, but NVIDIA 595 modules were installed only
for older kernels. `nvidia-smi` therefore failed. Secure Boot was disabled.
Installing `linux-modules-nvidia-595-open-7.0.0-34-generic`
`7.0.0-34.34+1` restored the RTX 3090 on driver `595.91.07`. Docker,
NVIDIA Container Toolkit configuration, model storage, and downloaded models
were preserved.

## Jarvis runtime

Two Docker Compose projects restarted automatically:

- Production project `jarvis-poc`
- Acceptance project `jarvis-taskws-accept`

They included the Jarvis API, task and email workers, approval/runner services,
document and OCR services, Discord attachment processing, Paperless, SearXNG,
and Ollama. The application health endpoint reported healthy even though its
Ollama container had been stopped for seven days. A per-minute Jarvis email
worker was also present in the deployment user's crontab.

Cutover actions:

- Backed up the crontab under
  `$HOME/openclaw-migration/backups/20261004T201500Z/`.
- Removed the Jarvis cron entry.
- Stopped both Compose projects and set their container restart policies to
  `no`.
- Removed 32 obsolete application containers and unused images/build cache;
  Docker volumes were not pruned.
- Preserved `jarvis-poc_ollama-data` and reused it in the standalone
  `ollama-local` service.

## Model and inference settings

Jarvis used `gpt-oss:20b` through local Ollama:

- Context: 32,768 tokens
- Maximum generated tokens: 2,048
- Request timeouts: 90-120 seconds in different callers
- Ollama endpoint: `127.0.0.1:11434`

The old configuration disagreed about its micro-model: one setting selected
`qwen2.5:7b`, while another selected `qwen2.5:3b` with a 4,096-token
context. The preserved model volume contained:

- `gpt-oss:20b`
- `qwen2.5:7b`
- `qwen2.5:3b`

OpenClaw starts with only `gpt-oss:20b` active, using the comparable
32,768/2,048 limits, so the baseline has no router ambiguity. The Qwen
downloads remain preserved.

## Discord and Google metadata

Discord was connected as `Jarvis_bot` to guild `<household-guild-id>`.
Configured channels:

- Shared household: `<shared-household-channel-id>`
- Adult private notes: `<private-notes-channel-id>`
- Operator management: `<operator-channel-id>`

Approved users were `<operator-external-user-id>` (operator) and
`<adult-external-user-id>` (Adult). The bot token was reused through an
environment SecretRef and is not recorded here.

The existing Google OAuth client was preserved. Its old refresh token had
expired or been revoked and could not be migrated. Intended calendar aliases
were:

- House: `household-bot@example.invalid`
- Owner: `alex@example.invalid`
- Adult: `natasha@example.invalid`

After fresh authorization, the account actually exposes the House calendar and
read-only U.S. Holidays. Owner and Adult are not currently shared with the bot
account.

## Source preservation

The canonical sibling `HardyAI` repository was clean and 19 commits ahead of
its remote. It was pushed to `origin/main` through commit `2841678`. The
sibling legacy `Jarvis` repository was left untouched because its own
instructions mark it frozen/read-only.
