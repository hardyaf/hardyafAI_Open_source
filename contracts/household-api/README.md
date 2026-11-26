# Household API contract

`openapi.json` describes API contract 0.7.0 for household service 0.9.0. The HTTP handlers remain authoritative for current identity, device kind, profile capability, audience, resource revision and native task admission. The ordinary application API excludes raw tool dispatch, native Gateway tokens and caller-chosen host paths. Owner-only Connections requests carry write-only credential fields directly to the isolated HTTPS service and bypass chat and saved submissions.

Protected requests use all four `X-Hardy-*` headers. Sign exact UTF-8 bytes with the enrolled ECDSA P-256 key and SHA-256. The canonical text is five LF-separated lines: uppercase method; exact encoded path including query; timestamp; nonce; lowercase SHA-256 hex of exact body bytes. Empty bodies hash zero bytes. The timestamp is Unix milliseconds within five minutes and each 16–128 character nonce is consumed once per device. Query encoding/order must match the path sent after signing.

Personal and display devices use separate invitation kinds and claim routes. Display claims return only a device id and authorize only the display snapshot and existing publication content routes. The public kitchen shell/assets contain no household data. Publication expiry and device revocation are rechecked during content access.

Messages carry normal freeform text with signed task metadata: mode, admitted artifact ids, an optional resource focus, a pending question id and an optional exact approve/reject decision. These fields cannot grant domain permissions, select an external author, alter diagnosis-only mode, or dispatch a raw tool. Task, brain-dump and diagnostic text has a 16,000 character limit; ordinary conversation allows 20,000. Approval decisions bind to the same replyToQuestionId. A reply cannot also start a new goal.

Workspace, Rolodex, list, managed-wiki and receipt-review routes are read-only bounded projections. Changes enter through an ordinary signed prompt and the authorized native task/domain tools. Client checkpoint writes are retired with HTTP 410. Cancel requests require a stable operation id, issue time and at least one exact current goal/run target; they do not undo earlier effects. `waiting_for_user` retains the durable question/native goal while settled execution capacity is released.

The existing generator creates Android transport methods from this contract. It signs query paths exactly and returns media as bytes rather than decoding images/documents as text. Run generation and structural checks only on the authoritative Ubuntu build host:

```sh
node tools/generate-household-client.mjs
node tools/generate-household-client.mjs --check
```

Generation is structural verification, not functional acceptance of providers, native goal continuation, OCR, receipt acceptance or physical displays.

Connections use the same enrolled-device identity and nonce authority in the
canonical household database. The protected HTTPS ingress owns `/v1/connections`
and proxies ordinary application routes to the existing control service. The
provider callback uses one-time state, PKCE and the initiating device's current
authority. No credential value or secret ID is returned by the public API.
