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

Natural-language household notes and lists use the first-party
`household-capture` workspace skill. Its design and operating checks are in
[`docs/household-capture.md`](docs/household-capture.md).

PDF documents use the first-party `local-documents` workspace skill with a
fast local text path and a pinned, CPU-only Docling/RapidOCR fallback. See
[`docs/local-documents.md`](docs/local-documents.md).

## Household application

The Owner-only connected alpha is deployed privately on `hardybot`. The custom
Android client and its narrow household control plane are intentionally
separate from the OpenClaw power-user interface:

- [`apps/hardy-home-android/`](apps/hardy-home-android/) contains the native
  Kotlin/Jetpack Compose household client.
- [`services/household-control/`](services/household-control/) contains the
  local API that owns device identity, profile-to-agent routing, prompt
  presets, permissions, and the two-run household queue.
- [`contracts/household-api/openapi.json`](contracts/household-api/openapi.json)
  is the authoritative phone-to-service API contract.
- [`deploy/hardybot/`](deploy/hardybot/) contains the private systemd deployment
  and first-device enrollment procedure.
- [`docs/household-app-architecture.md`](docs/household-app-architecture.md)
  records the system boundary and staged rollout.
- [`docs/household-app-acceptance.md`](docs/household-app-acceptance.md)
  defines the evidence required before replacing Discord.
