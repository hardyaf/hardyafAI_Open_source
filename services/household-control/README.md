# Hardy Home control service

This is the narrow application boundary between family devices and OpenClaw.
The connected-alpha milestone persists routing and submission metadata in
SQLite and uses the official, version-pinned OpenClaw Gateway client. Phones
authenticate with a P-256 key generated in Android Keystore. The Gateway token
never leaves this service.

Requirements:

- Node.js 24 or newer (uses built-in TypeScript type stripping)

Run:

```powershell
npm test
npm start
```

The state-changing live Gateway check requires an explicit guard and a running
production service:

```bash
HARDY_HOME_LIVE_SMOKE=1 \
HARDY_HOME_BASE_URL=http://192.168.1.127:4317 \
HARDY_HOME_DATABASE=/home/codex/.local/share/hardy-home/household-control.sqlite \
npm run smoke:live
```

It enrolls and revokes an ephemeral Alex test device, sends a real turn, replays
the durable submission ID, and verifies the canonical OpenClaw transcript.

Runtime configuration:

- `HARDY_HOME_DATABASE`: SQLite file (default `data/household-control.sqlite`)
- `OPENCLAW_GATEWAY_URL`: normally `ws://127.0.0.1:18789`
- `OPENCLAW_GATEWAY_TOKEN`: existing Gateway operator token
- `BIND_ADDRESS` and `PORT`: listener, default `127.0.0.1:4317`

Create a 15-minute, single-use invitation for Alex:

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
