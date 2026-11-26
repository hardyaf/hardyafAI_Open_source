# Public source and private instance configuration

The repository contains application code and neutral examples. Each running household retains its own protected configuration, identity and data outside the checkout. Git ignore rules help prevent accidental commits; they do not encrypt a file or make it a credential store.

## Reuse and ownership

| Information | Existing owner | Public source |
| --- | --- | --- |
| Passwords, OAuth refresh tokens and client secrets | Bitwarden and the trusted credential connector | Secret references, contracts and synthetic examples |
| Bitwarden bootstrap and service/Gateway settings | Existing protected JSON and environment files outside Git | Environment variable names and neutral configuration templates |
| Account/profile/agent bindings and current grants | Protected domain/native configuration and canonical application identity records | Stable protocol identifiers and synthetic examples, not real external account IDs |
| Household display names and initials | Existing private household database | Generic fresh-install labels; startup preserves saved display metadata |
| Private assistant notes, user context and memory | Existing private workspaces and stores | Generic documentation templates |
| Credentials or private deployment history retained for rollback | Private operator backup outside the repository | No archive, bundle or runtime-state copy |

No second configuration loader, identity database, secret mirror or local vault is introduced. An instance can continue using its current private JSON/env paths; no new untracked JSON file is required solely for source cleanup. If a developer creates a local JSON override for an existing loader, use a private file outside the checkout or an ignored .local.json/.local.json5 name. JSON is a file format, not an access-control boundary.

The existing configuration preparation tools accept explicit private input/output paths. Repository config/workspace examples and the redacted JSON5 are documentation copies, not the deployed source of truth. Do not replace a live private configuration with the example.

## Identity compatibility

Historical profile and agent identifiers remain stable compatibility keys. They are not the current household's display names or a grant of account access. Private configuration and the canonical identity database bind real people and account permissions.

The profile seed changes only the ownership of display_name and initials on conflict: existing values are preserved. The pre-existing refresh of role, capabilities, agent binding and color remains in force. Fresh databases get neutral labels. This narrow change stays in the existing database seed owner; it adds no identity authority or migration of private records.

## Source hygiene

Keep real addresses, contact details, external user/channel IDs, bootstrap values, local environment files, workspace data, databases and rollback archives outside Git. The ignore rules protect common local operator-input names while keeping ordinary JSON, environment examples and public agent templates trackable. Before committing, inspect the staged paths and content.

Tests use explicitly synthetic private-network addresses when private-network validation is the behavior under test. Prose can use reserved documentation addresses and domains. Do not replace a functional private-network test with a public IP merely to satisfy a text scanner.

## History and rollback

Privacy cleanup rewrites the affected commit contents and records the old-to-new mapping privately. Keep a verified, private all-ref bundle before updating GitHub. Rewritten commits have new IDs; synchronize old clones before using them again, and do not merge or push old history back into the cleaned repository.

GitHub pull-request references and cached commit views are separate from writable branches and tags. A successful branch rewrite does not prove that every old GitHub copy has been purged. Keep repository visibility private until remaining references have been reviewed. Contacting GitHub Support or replacing a repository is a separate owner action; the cleanup does not silently do either.

The original private configuration, database, credentials, workspaces and running services are not changed by this source/history cleanup. Rollback of repository history uses the private Git backup, never an older application database.

Reference: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository
