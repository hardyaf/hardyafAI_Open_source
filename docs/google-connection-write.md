# Google connection access

Household control 0.14.0 deployed and independently verified November 27, 2026. Candidate acceptance and protected activation are complete. The owner requested a write-access option for all currently connected Google services; this implementation covers the existing Gmail and Calendar connection surfaces.

| Responsibility | Decision | Owner |
| --- | --- | --- |
| Account credentials and consent | Adapt existing Connections service, vault and Google OAuth flows; upgrade the same connection ID after consent | Existing protected credential service |
| Account access selection | Extend existing connection presets/effective scopes, with immediate read-only downgrade | Existing connection metadata repository |
| Execution and uncertain effects | Reuse native admission, cancellation and the existing domain effect ledger | Existing native execution and domain owners |
| Gmail and Calendar operations | Extend existing typed domain/provider adapters; compose MIME using pinned Nodemailer with file/URL fetching disabled | Existing Google adapter |
| Attachment bytes | Reuse scoped ArtifactStore, resolved in the application before protected IPC | Existing artifact owner |
| Controls | Extend existing web and Android Connections views; never put credentials in chat | Existing application UI |

No second credential store, permission engine, task queue, effect ledger or account database is introduced. The large runtime composition module receives only a call to a focused attachment adapter. Existing read access continues until a write upgrade completes; cancelled or failed consent leaves the existing connection usable. Selecting read-only revokes HardyAI's local write capability without requiring the user to delete their working connection.

Google's actual consent and calendar ACLs remain authoritative for provider access. Ordinary authorized writes use the existing tool/receipt path without added approval forms or prescribed skill flows. Existing owner/account/source/audience checks and credential custody remain. No real email, invite or calendar mutation is used in the acceptance campaign. Ollama, model/context/reasoning defaults, held unrelated onboarding and scheduling remain unchanged.

API references: [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [Gmail operations](https://developers.google.com/workspace/gmail/api/reference/rest), [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth), [MailComposer](https://nodemailer.com/extras/mailcomposer).


## Prepared result and acceptance

The 0.14.0 candidate adds Gmail and Calendar read/write choices and in-place consent upgrades in both Connections clients. A successful upgrade retains the original connection ID and configured-mailbox routing. Failed consent leaves the previous grant usable. A local read-only downgrade blocks write execution before credential resolution, keeps reads working, and rejects stale consent completions. It preserves the actual provider scopes; it does not claim to revoke Google's OAuth grant.

Gmail tools compose/send messages with scoped attachments, manage drafts and labels, apply mailbox label changes, and trash/restore messages or threads. Gmail's modify scope does not include immediate permanent message deletion. Calendar tools list accessible calendars and read/create/update/delete events under the selected account and its Google calendar ACLs. Series and single occurrences use actual provider identities and conditional revisions. Future-only changes require composing a recurrence split because the provider has no atomic future-only flag. Existing default household Calendar compatibility remains available.

Acceptance passed 694 backend tests with the deployed pinned SDK and zero skips, 219 source/import checks, 23 credential-audit tests and 11 installer tests. Full native execution through real Unix IPC proved one send per operation, uncertain-result retention without resending, read-only denial before token access, and exact 3 MiB attachment custody. Independent Python MIME parsing verified sender, Unicode text, Bcc and attachment hashes; mocked provider operations covered exact endpoints, recurrence-instance selection and revision conflicts. Tests used synthetic identities and provider responses; no real mailbox, invite or calendar data was changed. Android unit tests, lint and assembly passed; phone installation and Google consent remain owner steps.

The only native configuration change adds twelve optional typed tools to Main's existing allowlist. The accepted native/provider patches, model defaults, serial Ollama serving, current business databases, persistent workshop and held unrelated onboarding remain intact. The sole added package is pinned Nodemailer 10.6.1 for MIME construction; it performs no SMTP delivery and cannot fetch attachment paths or URLs. Deployment installs its prepared files offline.


## Deployment verified

Protected activation and independent live verification passed all 445 promoted file hashes, two configuration hashes and preserved metadata. All three services are active and the application reports 0.14.0 ready/connected. The full credential-isolation audit, current Gateway PID/protected-config attestation and 37 policy/pin checks passed. All 566 prior artifact objects match their manifests and bytes. The persistent workshop, accepted V5/workshop/native-provider patches, Main 131072/high defaults and Ollama single-request/single-loaded-model serving are retained. No current business database was restored or unrelated onboarding/scheduling activated.

The feature is deployed; individual Google accounts remain at their current granted access until the owner chooses an upgrade and completes provider consent. The Android 0.6.3-alpha/code 13 installer passed 11 unit tests, lint, assembly, package identity and the existing signing-certificate check. Phone installation and real-account write acceptance remain owner steps. Canonical release documentation was refreshed after exact verification; protected/reference release snapshots retain their prepared build-time provenance.
