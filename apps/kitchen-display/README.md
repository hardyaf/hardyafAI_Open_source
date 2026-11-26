# Hardy Home kitchen display

A static browser client for read-only household lists, upcoming events and the most
recent explicitly published household output. It uses a separately enrolled, revocable
display identity. It cannot browse family profiles, private chats, personal lists, wiki
sources, receipts, diagnostics or general artifact storage.

Build on the authoritative Ubuntu host, with no package installation:

```sh
node build.mjs
```

The household service serves the four generated `dist/` assets at `/display/`. The client
uses same-origin signed `/v1/display/` routes. Use trusted HTTPS or localhost; browser
WebCrypto requires a secure context. A plain remote LAN HTTP page can show enrollment
instructions but cannot create a protected device key. Do not disable browser security
or embed a Gateway credential in a kiosk URL.

Connect with a dedicated one-time kitchen-display invitation. The browser stores a
nonextractable P-256 private key in IndexedDB. Household data stays in memory, visibly
goes stale when offline, and is cleared after ten minutes without a fresh snapshot.
Revocation clears the screen and removes its local identity.

The native display projection owns publication policy and source authorization. The
client derives the signed content route from the publication ID and ignores arbitrary
external content URLs. Current server publications are limited to safe text and raster
output; client rendering also keeps all untrusted text inert.

Build/startup evidence is separate from functionality acceptance. The signing tests and
enrollment, revocation, outage and publication scenarios run only when the consolidated
campaign opens. See [the client architecture notes](../../docs/slice3-clients.md).
