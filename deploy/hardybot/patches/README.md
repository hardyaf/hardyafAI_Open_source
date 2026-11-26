# Pinned native context repair

`native-context-budget.json` describes the owner-approved eight-file V5 patch to
OpenClaw 2026.9.8. Exact before/after SHA-256 values and the pinned patch digest
are required; version alone is insufficient. This is a compatibility exception,
not an unmodified upstream release. Native tasks, sessions, transcript, compaction,
queue, permissions and effects keep their existing owners.

The patch aligns request, retained-tail and replay budgeting. Generic SDK-owned
lossless dedup retains every business value once; only statically opted-in email
reads may omit bodies with scoped/versioned readback metadata. Verified private
provenance survives owned converters. Bounded recipes/source hashes reconstruct
from current prepared text, under the same redaction policy. Ordinary detail
limits remain. MCP/provider JSON/names cannot grant body-omission trust. Canonical
history remains under existing native policy. No email/task/tool/turn counts or
provider generation options are added.

Reproduce against a clean exact upstream package on the authoritative Linux host:

```sh
python3 deploy/hardybot/apply-native-context-patch.py --package-root "$OPENCLAW_PACKAGE" --manifest deploy/hardybot/patches/native-context-budget.json
```

Default is a non-mutating check. All paths, preimages, headers and postimages are
validated before writes. The `--apply` caller must close ingress, prove canonical
and native idle including compaction tails, stop/verify owners and cgroups, and
capture source/SDK/both config preimages. The installer uses this same applier.
Atomic replacement uses 0600 temporaries, restores/verifies UID/GID/mode and ALL
ACLs/xattrs, and creates new inodes so the separate operator SDK stays stock.

Keep the selected model's `contextTokens`, `contextWindow` and provider `num_ctx`
aligned; provider allocation alone does not prove native budget. Preserve other
model/global settings and access rules. Start Gateway, then control; attest the
actual protected entry/PID/config/patch and confirm schema/security readiness,
then reopen credential ingress. Audit binds the protected manifest into current
PID attestation. Use the existing service identity for owner-only control reads.

Replacement is atomic per file, not package-wide. Mixed/partial state is refused
and stays closed for offline forward repair. Restart prior services only if no
reviewed payload changed and old state remains exact. Rollback uses code/config
preimages, complete metadata and fresh attestation; never restore older database,
session, provider or business records over newer data. An upstream upgrade needs
renewed compatible preimages/acceptance or a verified stock correction.
See [repair acceptance and limits](../../../docs/context-budget-repair.md).
