# OpenClaw household baseline

This project records the replacement of the active HardyAI/Jarvis runtime on
`hardybot` with an unmodified upstream OpenClaw installation. It is a test
baseline for household use and local-model comparison, not a Jarvis refactor or
compatibility layer.

Current deployment:

- Host: `operator@example.invalid` (`hardybot`, Ubuntu 26.04 LTS)
- OpenClaw: `2026.9.8` (`fc23bc8`)
- Discord plugin: `@openclaw/discord` `2026.9.7`
- Google integration: `gog` `0.43.0`, skill `1.0.0`
- Local inference: Ollama `0.32.13`, `gpt-oss:20b`
- Local embeddings: `nomic-embed-text`, with no cloud fallback
- GPU: RTX 3090, 24 GiB, NVIDIA driver `595.91.07`
- Gateway: authenticated LAN listener on port `18789`
- Workspace: `/home/operator/.openclaw/workspace`

No credentials are stored here. See the [operating runbook](docs/operations.md),
[redacted baseline](docs/baseline.md), [acceptance evidence](docs/acceptance.md),
and [redacted active settings](config/openclaw.redacted.json5).

The active Jarvis identity and personality are mirrored under
`config/workspace/` for review and version history.
