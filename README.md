# OpenClaw household assistant

This project is the implementation home for the OpenClaw household assistant.
It began as the stock-OpenClaw replacement baseline for HardyAI/Jarvis and now
includes the household app and supported first-party skills. Upstream OpenClaw
remains unmodified; the former native Jarvis engine remains inactive.

The current planning set is:

- [Household assistant design](docs/household-assistant-design.md): confirmed intent and proposed behavior.
- [Implementation plan](docs/household-assistant-implementation-plan.md): reuse, ownership, work packages and acceptance.
- [Design decisions](docs/design-decisions.md): agreed choices and open questions.
- [Receipt reasoning and acceptance](docs/receipt-acceptance-policy.md): autonomous interpretation, automatic acceptance and review state.
- [Current status](docs/current-status.md): authoritative current runtime, verification and acceptance summary.
- [Bookkeeping complexity audit](docs/bookkeeping-complexity-audit.md): original findings about unnecessary model ceremony and retained boundaries.
- [Simplification implementation](docs/bookkeeping-simplification-implementation.md): implemented 0.6.0 interfaces, verification and compatibility limits.
- [Slice 1 evidence](docs/slice-1-runtime-platform.md): deployed runtime/platform changes and rollback.
- [Slice 2 evidence](docs/slice-2-domain-capabilities.md): deployed domain tools/data, run checks, configuration limits and rollback.
- [Slice 3 evidence](docs/slice-3-implementation.md): deployed behaviors/interfaces, contract results and remaining acceptance cases.
- [Source map](docs/design-source-map.md): existing implementations and native extension references.
- [Worklog](docs/WORKLOG.md): consequential documentation and architecture updates.

This living design supersedes the earlier baseline-only product scope. It does
not deploy planned features or reactivate the old native runtime.

Deployment baseline (current verification and acceptance are maintained in [current status](docs/current-status.md)):

- Host: authoritative Ubuntu server; protected inventory holds connection details
- OpenClaw: `2026.9.8` (`fc23bc8`)
- Household service, schemas and tool surface: see [current status](docs/current-status.md) for the active deployment and promotion state
- Discord plugin: `@openclaw/discord` `2026.9.7`
- Google integration: `gog` `0.43.0`, skill `1.0.0`
- Local inference: see [current status](docs/current-status.md) for the active Ollama version, selected model and evaluation results
- Local embeddings: `qwen3-embedding:8b`, with no cloud fallback
- GPU: RTX 3090, 24 GiB, NVIDIA driver `595.91.07`
- Gateway: authenticated private deployment
- Release/checks/availability: see the single [current status](docs/current-status.md) summary and protected final deployment receipt.
- Remaining work and acceptance: follow the existing [implementation plan](docs/household-assistant-implementation-plan.md) and current status; implemented reliability changes stay within the consolidated campaign.

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

The initial household rollout remains Owner-only; four family profiles are configured but their complete rollout is pending. The custom
Android client and its narrow household control plane are intentionally
separate from the OpenClaw power-user interface:

- [`apps/hardy-home-android/`](apps/hardy-home-android/) contains the native
  Kotlin/Jetpack Compose household client.
- [`services/household-control/`](services/household-control/) contains the
  local API that owns device identity, profile-to-agent routing, prompt
  preset metadata, permissions, durable queued delivery, native task controls
  and scoped artifacts. The original three-slice 0.5.0 baseline integrated
  the domain/task/analysis plugin, client projections and native task boundary.
  The 0.6.0 simplifications adapt those owners with a smaller model interface.
  [Current status](docs/current-status.md) owns active deployment, verification
  and workflow acceptance.
- [`apps/kitchen-display/`](apps/kitchen-display/) contains the thin, revocable
  household display client.
- [`contracts/household-api/openapi.json`](contracts/household-api/openapi.json)
  is the authoritative phone-to-service API contract.
- [`deploy/hardybot/`](deploy/hardybot/) contains the private systemd deployment
  and first-device enrollment procedure.
- [`docs/household-app-architecture.md`](docs/household-app-architecture.md)
  records the system boundary and staged rollout.
- [`docs/household-app-acceptance.md`](docs/household-app-acceptance.md)
  defines the evidence required before replacing Discord.
