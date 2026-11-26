---
name: household-effects
description: Inspect an existing scoped action receipt before recovering an uncertain write.
---

# Household effect receipts

Use `household_effects_inspect` with the original `operationId` when an action times out, is interrupted, or has an uncertain response. The existing effect owner reports committed, failed, in-progress or unknown state for this person/conversation; it never replays or undoes the action.

A missing response or search result does not prove no write occurred. Reconcile unknown outcomes through the owning domain before another attempt. Keep the same operation identity for an exact retry; changed arguments require an explicit new operation after reconciliation.

Receipt existence proves neither unrelated work nor financial acceptance. Read current authorized business state where required. Credentials, other profiles' receipts and raw stores remain unavailable. Task receipt association and completion belong to the existing application; do not create another ledger.
