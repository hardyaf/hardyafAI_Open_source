# Fitbit sync through Hardy Home

Implemented November 16, 2026, for the Chrome companion. Control service 0.8.0,
HTTP API 0.6.0 and additive application schema 6. Physical sync acceptance and
cloud-data authorization are separate. The native OpenClaw boundary contract
remains 0.7.0; its strict compatibility check is unchanged. Service/UI release
versioning is independent of that native protocol.

## Family experience

An operator-configured, enrolled personal profile sees **My Fitbit** and **Sync my
Fitbit**. A session starts that person's existing Android guest and opens the
official Google Health app automatically. The person keeps their tracker near
the server's Bluetooth antenna. No emulator interaction is part of this flow.

The session lasts up to 20 minutes, then stops the guest. Stop session ends only
the authenticated person's session. Another guest holding the shared controller
causes a busy response; a child cannot cancel the other person's session. Native
unit ownership and a shared kernel lock enforce exclusivity. Two simultaneous
button presses do not restart or extend an active session.

The UI reports session state and explicitly leaves the last successful tracker
sync unconfirmed. VM boot, an app process or a successful HTTP response is not a
health-data receipt. A separately authorized Google Health API connection is
needed to report cloud last-sync time and populate views.

## Reuse and ownership

| Concern | Owner and decision |
| --- | --- |
| Identity and revocation | Existing signed personal-device enrollment and household profile |
| Permission and guest binding | Optional Fitbit section of existing protected domain configuration |
| Control receipts | Additive device_effects table in existing household SQLite database |
| Execution | Existing systemd user service management, fixed controller and kernel locks |
| Account login and bonds | Original per-person Android AVD; never clone a signed-in disk |
| Health records | Google Health; no app-private extraction or new health store |
| Secrets | Existing trusted Bitwarden connector for future cloud authorization |

The native DomainEffectStore requires conversation/source-prompt foreign keys.
A standalone device button cannot use it without creating artificial chat
context. DeviceEffectStore therefore owns only device-control receipts in the
existing database, with no worker, retry queue or scheduler. Its profile, enrolled
device, stable operation ID, action and protected guest binding are immutable.
Unknown effects remain unknown and are not blindly dispatched again; status is
read from the native manager. Committed request replay refreshes current status.

The optional protected configuration has this shape:

```json
{
  "fitbit": {
    "controller": "/absolute/private/pilot/tools/fitbit-control.py",
    "locationLabel": "the home server",
    "profiles": { "belle": { "guestId": "guest1" } }
  }
}
```

This section is part of the existing domain configuration, not a new settings
store. Omit it to disable the feature. It does not enable the profile's model
domain grants. The server resolves the target; clients cannot submit an account,
profile, guest, path, unit or command. Signed authority is checked before and
after host calls. Display devices and development identities are rejected.

## API

- GET /v1/fitbit: own sanitized native session state.
- POST /v1/fitbit/sync: start, with operationId only.
- DELETE /v1/fitbit/sync: stop, with a distinct operationId.

Both mutations require stable IDs. A receipt means the native control request
was accepted. It never means that new steps were uploaded. The contract currently
returns syncVerified=false, lastSyncTime=null and dataConnection=not_connected.

The lifecycle helper uses fixed native units and fixed ADB serials. Its ADB
operations read readiness, resolve/open the official launcher and request normal
Android shutdown. It does not enter credentials, automate pairing, read app
databases or implement any Fitbit protocol.

## Browser access from the children's computer

Use separate Windows user profiles and enroll one personal browser device per
child. Browser signing needs a secure context. An optional HTTPS listener reuses
the same application handler, startup, identity, database and nonce ledger as
the existing HTTP service; it does not create another runtime. Existing clients
can retain their current endpoint.

Configure HARDY_HOME_TLS_CERTIFICATE and HARDY_HOME_TLS_PRIVATE_KEY with absolute
protected PEM paths, and HARDY_HOME_TLS_PORT with a free nonprivileged port. Both
files must be regular, owned by the service account and mode 0600; symlinks are
rejected. TLS 1.2 is the minimum. The private operator procedure supplies a
name-constrained LAN CA, its public certificate and a per-user setup shortcut.
Server and CA private keys never leave the server. Renew the server certificate
before expiry; a failed or untrusted certificate is not an enrollment workaround.

The owner installs the public trust certificate in each child's CurrentUser
store and enters that child's one-time invitation in their own browser. Neither
child receives the deployment SSH identity. Revoke an enrolled device through
the existing device authority if the browser profile is lost. Removing a
shortcut alone does not revoke the device key.

## KVM access

The deployment user must be a member of the standard kvm group. Guest units
run their fixed launcher with sg kvm so newly granted membership works even
when the user service manager predates it. This applies only to the guest
process group and does not require a household/OpenClaw restart. Owner sudo is
needed for the initial group grant, entered at the interactive terminal required
by the operations instructions. Verify the actual native-unit KVM API/createVM
and Android boot rather than relying on an SSH session's group list or a
temporary device ACL.

## Deployment and rollback

The private operator record owns actual paths, profile/account mapping, pinned
radio dependencies and installation evidence. Native guests are not enabled at
boot. The dedicated root-owned radio bridge can start at boot, grants only
CAP_NET_ADMIN and listens only on loopback. Do not grant general sudo or a
capability on a general-purpose Python interpreter.

Remove the protected mapping and restart household-control to revoke this
feature. Stop the Fitbit session and guest units. Restore only changed source,
assets and configuration if rolling back. Keep the additive receipt table and
newer business records; never restore an old application database. Removing the
pilot does not delete Google cloud records. Erasing a guest deletes its local
login/bond state and requires a separate explicit removal decision.

Scheduling remains off. Other family grants, OpenClaw configuration, model
selection and household data ownership are unchanged.
