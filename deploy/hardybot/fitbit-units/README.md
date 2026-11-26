# Fitbit native lifecycle templates

Render only with protected operator paths and the verified HCI index. Never
accept template parameters from a household HTTP request. The current fixed
controller recognizes guest1 and guest2.

Install charge6-display.service and the rendered charge6-guest1.service /
charge6-sync-guest1.service in the existing service user's systemd manager.
A second guest uses its own fresh AVD and the guest2 filenames. Do not enable
guest/session units at boot.

The system radio unit is charge6-radio-pilot.service. Its Python environment,
preflight and every parent directory must be root-owned and not writable by the
service user. It has CAP_NET_ADMIN only; do not set a file capability on Python
or grant general sudo. The preflight must verify the selected controller belongs
to the dedicated physical USB function. Linux retains its normal driver.

Each guest launcher must hold the common radio-client.lock with flock --nonblock
--no-fork while running the official emulator. The session helper holds the
separate common sync-session.lock across boot, the official app and shutdown.
A new request must reject another active profile; do not use Conflicts= to
silently cancel the other child's sync.

Use the official Play image and existing per-person data disk. The launcher
keeps VNC, ADB and radio transport on loopback, disables metrics/crash sending
and snapshots, and sets LimitCORE=0. Shutdown asks Android to power down before
the native stop deadline. No account data is copied or restored.

The private installer pins copied radio file hashes, checks permissions and
validates rendered units. Test the deployed native lifecycle before granting
the child's protected mapping. Source/config rollback preserves newer database,
AVD and cloud data.


## KVM permission across login and reboot

The service account must belong to the standard kvm Unix group before either
guest is started. An owner applies that membership through interactive sudo.
The fixed guest unit uses sg kvm for its exact protected launcher command, so
an already-running user service manager can use a newly granted membership
without restarting unrelated household services. It remains the same unprivileged
UID. No caller can choose the group, executable or guest through this boundary.

Verify KVM API access and empty VM creation from a native user unit, then boot
the actual guest. Temporary device ACLs alone are not the durable authority.
The normal device ownership/mode remains root:kvm 0660. Retain original unit
files for rollback and preserve every guest disk.
