# Ubuntu household deployment

> Deployment host/account identifiers are redacted. Example addresses use
> `example.invalid`; paths use `$HOME`. Set actual connection, account and
> storage values from protected operator configuration.

**November 3 planning note:** this is the existing connected-alpha deployment,
not a fully delivered household release. See [current status](../../docs/current-status.md)
and [implementation plan](../../docs/household-assistant-implementation-plan.md)
for queue, continuation, private-event and family-rollout requirements. A document
update does not deploy the proposed capabilities.

The connected alpha runs `household-control` as a hardened user service beside
the OpenClaw Gateway. The Gateway owner credential stays on the server; Android devices
receive only the household API.

1. Put this repository at `$HOME/hardyafAI_Open_source`.
2. Run `bash deploy/hardybot/install-household-control.sh` as the deployment user.
3. The installer reuses the existing local Gateway token from OpenClaw's
   protected environment file without printing it. If it cannot find that
   value, it creates a protected template and exits so the value can be entered
   manually before rerunning the installer.
4. Create Owner's 15-minute invitation only when the phone is ready:

   ```bash
   cd ~/hardyafAI_Open_source/services/household-control
   npm run invite -- alex 15
   ```

   During a supervised setup, an easy explicit code can be supplied as the last
   argument (for example, `npm run invite -- alex 15 1234abcd`). It is still
   single-use and expires after the requested interval.

5. Enter the service address and one-time code in the Android app.

The state-changing live acceptance command is deliberately gated:

```bash
cd ~/hardyafAI_Open_source/services/household-control
HARDY_HOME_LIVE_SMOKE=1 \
HARDY_HOME_DATABASE=~/.local/share/hardy-home/household-control.sqlite \
HARDY_HOME_BASE_URL=http://household.example.invalid:4317 \
npm run smoke:live
```

It creates and then revokes an ephemeral Owner test device, sends one real agent
turn, replays its submission ID, and verifies canonical history.

The alpha binds to the private LAN address. Before remote access or a household
release, put it behind private HTTPS (recommended: Tailscale Serve), change the
Android service address to that HTTPS origin, and do not expose port 4317 to the
public internet.

## Slice 2 configuration and checkpoint

The current pre-production service is 0.4.0 with application schema 3 and Uplift
schema 1. The two build checkpoints passed; functional scenarios remain deferred
until Slice 3. See [evidence/rollback](../../docs/slice-2-domain-capabilities.md).

`prepare-domains.py` accepts the existing protected native config, separate
domain/native output files, protected state root, trusted general/document
Python executables, Google executable/account/client/calendar binding and
timezone. It writes private candidate configuration and empty managed
directories only. It preserves existing family/provider settings and refuses
conflicts instead of silently changing grants. Keep the document virtualenv
executable path, even when it is a symlink.

Validate the prepared native configuration with the installed OpenClaw schema;
take consistent backups before deliberate activation and service restart. Set
`HARDY_HOME_DOMAINS_CONFIG` in the existing protected service environment. The
installer now requires that setting and checks `/ready`; it does not provision
OAuth, vault credentials or receipt project grants. Initialize the Uplift module
only against its intended protected DB/vault; it refuses an unrelated database.

The native plugin is pinned to the installed SDK. Its optional tools are an
additive Main opt-in; the helper knowledge scope denies all tools and has no
family route. Wiki storage is explicitly agent-isolated/local with automatic
private-history bridging off. New schedule activation remains disabled.
Include Contacts/app state, artifacts, Uplift DB/originals, native memory/wiki
sources and protected configuration in the eventual complete backup campaign.

## Native analysis file projection

Current analysis intake requires the supported native attachment policy. The existing
platform renderer, `prepare-platform.py` and `prepare-slice3.py` prepare these fields:

```json
{"tools":{"sessions_spawn":{"attachments":{"enabled":true,"maxFiles":32,"maxTotalBytes":16777216,"maxFileBytes":16777216,"retainOnSessionKeep":true}}}}
```

Preparation fills absent fields, refuses conflicting explicit policy and preserves
other native configuration. Validate a prepared candidate with the installed native
schema, then use the existing reviewed promotion procedure. A tool-factory config
clone does not change hidden-spawn runtime policy. The typed launcher checks actual
readiness and returns a safe blocker before spawning when file projection is absent.
Global native support grants no raw family attachment access: the trusted family
guard still rejects attachment arguments and direct analysis-agent selection.
Local helper model/sandbox, owner grants, held OAuth/vault setup and disabled
scheduling remain unchanged. See [analysis contracts](../../docs/NATIVE-TASK-HOOKS-AND-ANALYSIS.md#native-analysis-attachment-readiness-correction).

## Public web research

Use stock `web_search` with the official SearXNG provider plugin pinned to the
installed OpenClaw release. The provider project loads from the protected
OpenClaw provider directory. Pin `tools.web.search.provider` to `searxng` and
set `plugins.entries.searxng.config.webSearch.baseUrl` to the loopback service.
The existing native `web_fetch` opens public sources and keeps its private
network restrictions. Public web access requires an explicit `web` grant and
uses the existing personal and household audience rules.

The [Compose file](web-search.compose.yaml) starts only SearXNG. Deploy it and
its adjacent [settings](web-search.settings.yml) to the protected service
configuration directory. Create a mode 0600 environment file with a generated
`SEARXNG_SECRET`. Run Compose with that explicit `--env-file`. The service
publishes only on IPv4 loopback, runs as the image's unprivileged user, and
enables JSON search. Search terms still reach the enabled upstream engines.
Provider data is disposable and the native search cache stays with OpenClaw.

Check `/healthz`, then send a harmless public query to `/search` with
`format=json`. Check that the returned URLs include the expected official source.
Validate both protected configurations against the deployed source and installed
OpenClaw, wait for active turns to settle, and verify both services are ready
after restart. Test a fresh authorized chat that searches, opens, and cites a
public source. On rollback, restore matching source and protected configs, then
stop this Compose project if the older config has no consumer. Runtime state
and saved conversations can remain in place.
