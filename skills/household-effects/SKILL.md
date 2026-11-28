---
name: household-effects
description: Inspect an existing scoped action receipt before recovering an uncertain write.
---

# Effect inspection guidance

household_effects_inspect reports an existing operation's committed, failed, in-progress or unknown state within current owner/conversation permissions. It neither replays nor undoes the action. Use it when useful to reconcile an uncertain write; ordinary successful actions need no separate receipt ceremony.

A lost response or empty search does not establish that nothing happened. Stable operation identity supports an exact retry; reconcile unknown effects before creating another. Existing owners capture receipts automatically. A receipt proves its own effect, not unrelated work or financial acceptance. Credentials and other profiles' stores remain separate.
