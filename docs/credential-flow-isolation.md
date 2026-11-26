# Credential flow isolation

## Deployment state

The protected ingress is active as of 2026-11-25. The existing trusted HTTPS
origin serves the root-owned Hardy Home interface and its Connections surface.
The control service reports version 0.9.0, ready, connected native execution and
an active delivery worker. The gateway runs through its protected system unit.
The retained user gateway unit is inactive.

The effective native and domain configuration remain root-owned. The Node
executable has a separate protected inode, preserving the original interpreter's
user ownership required by native exec-provider checks. Static runtime libraries
use the explicit inode-sharing option. Stock plugin skill cache links live in the
single writable deployment-user-owned plugin-skills child directory. Canonical
SQLite ownership remains in place with inherited sidecar access for both service
accounts.

The runtime auditor passes with the credential service's actual primary and
supplementary groups. Configuration digests and the active gateway PID match its
root-issued attestation. Trusted HTTPS assets return successfully and unsigned
Connections requests are rejected. The native scheduler reports all eleven
retained jobs disabled, and domain scheduling activation remains disabled.

The protected Google provider imports its pinned google-auth-library 11.3.4.
Sixteen deployment and policy regressions pass on Ubuntu. These checks cover
installation and component readiness. Bitwarden bootstrap and real Google grants
remain pending owner setup and provider acceptance.

## Reuse and ownership

| Component | Decision | Authority and impact |
| --- | --- | --- |
| Device signatures and current authorization | Reuse | Existing DeviceAuthenticator and canonical HouseholdDatabase own identity, nonces and current owner/manage-access checks. |
| Connection metadata and OAuth operations | Adapt | Existing household SQLite transactions own references, scopes and content-free status. |
| Provider credentials | Reuse | Bitwarden Secrets Manager owns credential envelopes and OAuth grants. Its official pinned SDK receives values over stdin. |
| Bitwarden bootstrap | Adapt | A private file under /var/lib/hardy-home-credentials belongs to the protected service. |
| Model tools and analysis | Reuse | Stock OpenClaw allowlists, explicit denials, child rosters and Docker sandboxing enforce reachability. |
| Browser interface and HTTPS | Adapt | A root-owned snapshot serves /home and handles /v1/connections, forwarding ordinary traffic to the existing control service at its retained address. |
| Protected ingress process | New | A dedicated OS identity separates credentials from the model and existing control identity. It adds no task, identity, queue or credential database. |

The ingress opens the same SQLite database and normal WAL/SHM sidecars. Named ACLs
grant the new account traversal and database access. Default directory ACLs retain
access when SQLite recreates sidecars. Existing database ownership remains in
place. Neither installation nor rollback copies a database over business records.

## Enforced boundary

The gateway retains the deployment user user, sessions, workspaces, model choice and agent
roster. A root-owned system service selects its effective configuration under
/etc/hardy-home-credentials using OPENCLAW_CONFIG_PATH. The installed stock
Node/OpenClaw runtime and reviewed plugin artifacts are copied into /opt.
Existing scheduling configuration remains in that effective configuration.

Main and household parents receive explicit raw-tool denials. Analysis retains
offline sandbox execution. The audit checks every agent and reachable child,
rejecting host execution, unsandboxed filesystem tools, unrestricted tool names,
ACP dispatch, elevation and host mounts. Raw tools require mode all, no host
workspace access, no network, read-only root and all capabilities dropped.

A root-only gateway post-start hook checks the actual process environment and
executable, then records its PID and configuration digest in a protected runtime
attestation. A configuration change or PID mismatch makes the credential gate
unavailable until the protected gateway restarts. The ordinary audit returns only
booleans and reason codes. The ingress runs it before credential handling.

Stock OpenClaw projects plugin skill links under the active configuration
directory when no internal install-root context is pinned. The installer creates
only the plugin-skills child directory with deployment-user ownership and mode
0700. The configuration parent and authoritative files retain root ownership.
This cache is regenerated from the installed plugin sources and owns no grants,
credentials or business records. Runtime dependencies are rewritten only when a
copied node_modules/openclaw alias points to the exact installed runtime package;
unexpected external links still fail preparation.

The credential ingress runs as hardy-credentials with deployment user socket-group access.
Its source, runtime and browser assets belong to root. Its private state and TLS
copies belong to its dedicated identity. It cannot access Docker sockets, the
operator SSH directory, old OpenClaw configuration or control configuration.
The existing household control service retains its configured HTTP address and
port. The installer derives the protected proxy target from that existing private
or loopback listener. The ingress takes
the existing trusted HTTPS origin on port 8443, preserving browser enrollment.

The Unix consumer socket exposes a fixed set of typed provider read operations.
Existing household tools enforce current authorization and the daemon rechecks
the same authoritative identity and connection grant. The socket exposes no
operation that returns credentials. Secret submission and bootstrap operations
remain signed, owner-only requests through the protected HTTPS interface.

## Ubuntu workflow

All builds, tests, SDK probes and service checks run on the Ubuntu runtime. The Ubuntu acl
package is required. The helper offers a read-only readiness check. Preparation and activation require
root on the Ubuntu runtime. It does not install packages or fetch secrets.

Run the check after the reviewed source and service dependencies are prepared.

```sh
python3 "$HOME/hardyafAI_Open_source/deploy/hardybot/credential-install.py" check \
  --source "$HOME/hardyafAI_Open_source" --owner "$USER" \
  --bind 127.0.0.1 --public-origin https://hardy-home.invalid:8443
```

The JSON reports package, source, SDK and native-policy readiness without
provisioning services or resolving credentials. A false ACL check requires the
Ubuntu package to be installed by an administrator.

```sh
sudo apt-get install acl
sudo python3 "$HOME/hardyafAI_Open_source/deploy/hardybot/credential-install.py" prepare \\
  --source "$HOME/hardyafAI_Open_source" --owner "$USER" \\
  --bind 127.0.0.1 --public-origin https://hardy-home.invalid:8443
```

Substitute the deployment's bound address and trusted HTTPS origin explicitly.

When duplicate runtime storage will not fit, append `--reuse-runtime-inodes` to
the prepare command. This explicit option hardlinks only the already-installed
static Node/OpenClaw libraries into the protected release. The Node executable is
separately copied so the original interpreter retains the user ownership required
by native exec-provider validation. The protection step makes
those shared program-file inodes root-owned and removes non-root write access.
The original runtime directories retain their owner, so an operator can replace
original directory entries during an update. The pinned release keeps its earlier
inodes. Editable application source, the SDK, databases and private state are
never hardlinked by this option. This static runtime ownership promotion remains
in place after a service rollback.

The normal administrator sequence for that storage-constrained case is as follows.

```sh
sudo apt-get install acl
sudo python3 "$HOME/hardyafAI_Open_source/deploy/hardybot/credential-install.py" prepare \
  --source "$HOME/hardyafAI_Open_source" --owner "$USER" \
  --bind 127.0.0.1 --public-origin https://hardy-home.invalid:8443 \
  --reuse-runtime-inodes
sudo python3 /opt/hardy-home-credentials/source/deploy/hardybot/credential-install.py activate
```

Preparation copies the pinned runtime, existing official SDK environment, service,
tools and plugins. It builds the reviewed browser source inside the protected
snapshot, preserving the live browser assets until activation. It creates the dedicated account, TLS copies,
protected configuration, system units and database ACLs. The existing gateway
and HTTPS listener stay active during preparation. The policy-only audit, stock OpenClaw config validation and rendered systemd
unit verification must pass before cutover. Their captured output stays private.

Activate only the prepared candidate after component checks.

```sh
sudo python3 /opt/hardy-home-credentials/source/deploy/hardybot/credential-install.py activate
```

Activation updates the native configuration pointers in the current domain
configuration, disables the retained user gateway unit, starts the protected
system gateway, removes the control service TLS settings and starts the protected
ingress. The current control environment and domain configuration are backed up
privately in the rollback directory recorded by deployment.json. A failed startup invokes the scoped configuration/service rollback automatically.
The helper never copies a database over current business records.

Existing authorized Docker administrative access may transport the reviewed root
installation when passwordless sudo is unavailable. This is an operator
maintenance action. Native model tools do not expose that administrative access.

## Verification and remaining acceptance

Provider-free Ubuntu checks include the policy regression file, Python compilation
and systemd unit verification.

```sh
python3 deploy/hardybot/credential-audit.test.py
python3 deploy/hardybot/credential-install.test.py
python3 -m py_compile deploy/hardybot/credential-install.py deploy/hardybot/credential-audit.py
# The installer validates the rendered systemd units after preparation.
```

After activation, run the auditor with the credential unit's primary group and
its configured supplementary group. The primary group permits reading the
protected domain configuration. This command reads the group from the active
unit.

```sh
sudo runuser -u hardy-credentials \
  -g "$(systemctl show hardy-home-credentials.service --property=Group --value)" \
  -G hardy-credentials -- /usr/bin/python3 -I \
  /opt/hardy-home-credentials/source/deploy/hardybot/credential-audit.py
```

Every check must pass. Verify /ready and /home at the existing trusted HTTPS origin, ordinary chat
and delivery, owner-only signed requests, non-owner rejection, insecure transport
rejection and the explicit unconfigured vault state. Use synthetic credentials
and fake providers for write-path checks.

Root preparation and service cutover require administrator authorization. The
root-free check cannot certify the uninstalled protected units.

A passing policy audit is component evidence. Normal native agent turns must
also prove host tools unavailable and analysis execution limited to the sandbox.
Real Bitwarden and Google authorization have their own provider acceptance.

## Compatibility debt, risk and rollback

The effective gateway configuration is now a root-owned deployed artifact.
Operational updates must change that file and restart the protected gateway.
Domain execution.nativeConfigPath must select the same deployed file.

The deployment user account retains its existing Docker administrative membership. Native
tool denials and sandbox policy prevent model execution from reaching it.
Future host tools, native harnesses, plugins or child profiles must pass the gate
before credential handling is available. Unknown tool surfaces fail closed.

The installed record supports a bounded rollback command.

```sh
sudo python3 /opt/hardy-home-credentials/source/deploy/hardybot/credential-install.py rollback
```

Rollback restores only this installer's control-environment keys and leaves
unrelated current settings in place. Review subsequent changes to those same keys
before running it. Rollback stops and disables the protected ingress and system gateway, restores
the recorded control TLS settings and native pointers after reconciling later
operator configuration changes, then enables the retained user gateway and
restarts household-control. Preserve the current SQLite database, connection
receipts, vault records and provider effects. Named hardy-credentials ACL entries
may remain during rollback or be removed explicitly after stopping the process.
