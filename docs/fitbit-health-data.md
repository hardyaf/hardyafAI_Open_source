# Google Health data access for Fitbit views

Research and proposed integration, November 16, 2026. No cloud reader, OAuth grant,
credential bootstrap or health cache is enabled by the Sync button release.

The official Google Health app remains responsible for tracker-to-cloud sync.
Hardy Home can read cloud data through the Google Health API; app tokens,
screens and private databases are not a supported integration boundary.
The current official API overview says the old Fitbit Web API and OAuth endpoints
were turned off November 2, 2026. Do not build a new integration on them.

## Two independent mappings

1. Existing household profile -> protected Android guest binding for physical sync.
2. Existing household profile -> trusted Bitwarden credential binding for API reads.

Each Google account supplies its own OAuth grant and refresh token. A client ID
identifies the application and is not a per-tracker key. The private credential
binding must also pin the Health user identity returned by users.getIdentity.
Use users/me with that person's token and compare the identity before presenting
any data; never trust a client-selected account or assume a newly authorized
token belongs to the person whose guest is running.

Reuse BitwardenCredentialConnector and its profile-scoped provider_refresh
boundary, readiness checks and authoritative rotation writeback. A per-account
secret can hold the OAuth credential bundle consumed only by a trusted Google
adapter. Access tokens may be cached briefly in trusted process memory. No
tokens or client secrets go to model tools, browser storage, logs or receipts.
The official Android app continues to own its independent login.

Bitwarden bootstrap is currently held/pending in the household baseline. Do not
work around it with plaintext files or another credential database. The owner
must complete the agreed provider bootstrap and the two account consent flows
before live API reads can be accepted. Unrelated OAuth repair remains separate.

## Initial read-only scope

Request only:

- https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly
- https://www.googleapis.com/auth/googlehealth.settings.readonly

The first covers steps; settings covers paired devices and last-sync time.
Either also permits getIdentity, so a separate profile scope is not required
for this initial slice. Sleep and additional health metrics need their own
explicitly selected scopes later. No writes, location or reproductive-health
scopes are part of this plan.

## Provider calls

- GET https://health.googleapis.com/v4/users/me/identity
- GET https://health.googleapis.com/v4/users/me/pairedDevices
- POST https://health.googleapis.com/v4/users/me/dataTypes/steps/dataPoints:dailyRollUp

Paired devices include the model and lastSyncTime. Daily step summaries return
steps.countSum. Use closed-open civil calendar ranges: midnight on the first
date through midnight after the final date. The initial view should use a
one-day window and at most 30 days. The API allows a maximum 90-day range for
steps; preserve its reconciliation and date semantics instead of summing
overlapping raw sources or using fixed 24-hour offsets.

Select source family deliberately: all-sources matches a reconciled mixed-source
view; google-wearables restricts the chart to Google/Fitbit trackers. Label the
chosen source. Missing/unworn data is not proof of a successful zero-step sync.

Read pairedDevices once before a physical session and again afterward. An
advanced lastSyncTime is evidence of a cloud sync; new-step acceptance also
requires the new totals. Keep physical-session acceptance, cloud freshness and
metric availability separate. A later adapter can stop a session early when
a fresh sync is verified. The current release uses the bounded 20-minute
session and does not claim this early-stop or cloud verification is implemented.

## Owner setup when the connector is ready

1. Enable Google Health API in an owner-controlled Google Cloud project.
2. Create the application's OAuth client and exact allowed callback URI.
   The LAN IP used by the Sync UI is not a valid non-loopback web OAuth redirect.
   Prepare an owner-only localhost callback through management SSH, or a compliant
   DNS/HTTPS callback, and register it exactly. Use the system browser and Google
   OAuth client library with state/PKCE; never an embedded emulator WebView or
   pasted codes in chat. No callback is implemented by this release.
3. Add both intended accounts as test users while testing and select only the
   read-only scopes above.
4. Complete consent separately for each account, request offline access and
   bind the returned identity to the intended household profile.
5. Commit each refresh credential directly through the trusted Bitwarden
   bootstrap/connector path. Prove refresh and durable writeback before exposing
   data tools.
6. Compare a live paired-device lastSyncTime and fresh steps against the official
   app, then add the self-scoped views.

Google's setup documentation currently caps unverified apps at 100 users and
states that Testing-mode refresh tokens expire after seven days. The owner must
resolve publishing/verification requirements before claiming unattended,
long-term operation. Do not silently reauthorize, bypass consent or register
public webhooks. Manual reads need no new household schedule.

Begin with bounded on-demand reads through a domain-owned adapter and the
existing current identity/audience policy. If views later require a cache, keep
it as a replaceable per-profile projection in the existing household data layer,
record source family/fetched time, define retention and revocation cleanup, and
keep Google as the source of truth. No local fitness data store exists yet.

## Primary references

- [API evolution and legacy shutdown](https://developers.google.com/health/about)
- [Cloud/OAuth setup and token lifetime](https://developers.google.com/health/setup)
- [Identity and accepted scopes](https://developers.google.com/health/reference/rest/v4/users/getIdentity)
- [Paired devices and settings scope](https://developers.google.com/health/reference/rest/v4/users.pairedDevices/list)
- [Steps and reconciliation](https://developers.google.com/health/data-types/steps)
- [Daily rollup request](https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/dailyRollUp)
- [Calendar aggregation semantics](https://developers.google.com/health/aggregate-data)

- [Web OAuth redirect validation](https://developers.google.com/identity/protocols/oauth2/web-server#uri-validation)
