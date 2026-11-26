# Hardy Home control service

> Deployment host/account identifiers are redacted. Example addresses use
> `example.invalid`; paths use `$HOME`. Set actual connection, account and
> storage values from protected operator configuration.

This is the narrow application boundary between family devices and OpenClaw.
The service persists routing, durable queued/unconfirmed payloads, native-bound
checkpoint references and submission outcomes in SQLite. It uses the official,
version-pinned OpenClaw Gateway client. OpenClaw remains transcript/task authority;
payloads clear after definitive acceptance or terminal delivery. Phones
authenticate with a P-256 key generated in Android Keystore. The Gateway token
never leaves this service.

Requirements:

- Node.js 24 or newer (uses built-in TypeScript type stripping)

Run:

```bash
npm run check:startup
npm start
```

Run builds and runtime checks on the authoritative Ubuntu host. The assembled backend suite runs within the consolidated
functionality campaign. [Current status](../../docs/current-status.md) records
its actual results and the separate natural-agent/owner/device acceptance limits.

The state-changing live Gateway check requires an explicit guard and a running
production service:

```bash
HARDY_HOME_LIVE_SMOKE=1 \
HARDY_HOME_BASE_URL=http://household.example.invalid:4317 \
HARDY_HOME_DATABASE=$HOME/.local/share/hardy-home/household-control.sqlite \
npm run smoke:live
```

It enrolls and revokes an ephemeral Owner test device, sends a real turn, replays
the durable submission ID, and verifies the canonical OpenClaw transcript.

Runtime configuration:

- `HARDY_HOME_DATABASE`: SQLite file (default `data/household-control.sqlite`)
- `OPENCLAW_GATEWAY_URL`: normally `ws://127.0.0.1:18789`
- `OPENCLAW_GATEWAY_TOKEN`: existing Gateway operator token
- `BIND_ADDRESS` and `PORT`: listener, default `127.0.0.1:4317`

Create a 15-minute, single-use invitation for Owner:

```powershell
npm run invite -- alex 15
```

For an easier code during supervised setup, provide an optional third argument:

```powershell
npm run invite -- alex 15 1234abcd
```

Codes are normalized to uppercase, expire, and cannot be claimed twice. This is
an enrollment code, not a reusable password.

Development requests use a mock device identity:

```powershell
Invoke-RestMethod http://127.0.0.1:4317/v1/me -Headers @{ 'x-device-id' = 'alex-phone' }
```

Known test device IDs are `alex-phone`, `natasha-phone`, `fred-tablet`, and
`belle-phone`. To use these while running the SQLite service, set
`ALLOW_MOCK_DEVICE_AUTH=true` outside production. The mock identity header is
always disabled in production.

The OpenClaw adapter implements session creation, normalized history, sending,
cancellation, and chat lifecycle events behind `HouseholdAgentAdapter`.
Submission IDs are stored before dispatch and passed unchanged as Gateway
idempotency keys. Phones never connect to the Gateway or receive its secret.

## Slice 1 runtime/platform

See [implementation, ownership and deployment evidence](../../docs/slice-1-runtime-platform.md)
and [platform adapters](../../tools/README-platform.md). `/ready` adds fresh
Gateway probe readiness; additive API contracts include native context/goal,
CAS checkpoint pointers, scoped artifacts and admin platform readiness.
Native progress remains adapter-only and helper execution has no new public
run endpoint. Server-side admission must be reused by later task integration.

New non-secret environment knobs are documented in the deployment example.
The Bitwarden resolver is installed but cannot resolve secrets without its
protected bootstrap and exact ID bindings. No account setup is implied.
Set `HARDY_HOME_DISPATCH_ENABLED=false` to hold delivery; never blindly replay
an uncertain external effect or discard a recovery reservation.

## Slice 2 domain runtime

Version 0.4.0 requires `HARDY_HOME_DOMAINS_CONFIG` in production security mode.
The protected file selects resource grants and managed adapter paths; it has no
secret values. The native plugin reads the existing protected environment.
Prepare configuration with `deploy/hardybot/prepare-domains.py`; it does not
activate its native output. `/v1/admin/domains` reports protected structural
readiness and safe tool metadata. The native content-free status method reports
actual plugin initialization without invoking a model or domain workflow.

See [Slice 2 implementation/evidence](../../docs/slice-2-domain-capabilities.md)
for schemas, authorities, run checks, exact release, configuration blockers and
rollback. Source checks include deferred test syntax only. Both slices are
deployed; natural-language workflows and final clients remain unaccepted.
