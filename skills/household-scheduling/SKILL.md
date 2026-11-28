---
name: household-scheduling
description: Declare, inspect and manage authorized future household tasks through the native scheduler, preserving owner, audience, configuration revision and honest activation status.
metadata: {"openclaw":{"emoji":"⏰"}}
---

# Scheduling guidance

The existing native scheduler owns future tasks, due time and run history. Compose household_schedule_* tools when scheduling is available. Current deployment keeps scheduling disabled and historical jobs retained; a saved disabled job will not run. Do not imply activation or delivery from a saved declaration.

Interpret dates against the current clock/time zone and resolve material ambiguity. The supported APIs describe one-off, interval and cron schedules. Useful task text and the original audience support later execution. Trusted delivery configuration supplies recipients; job creation never grants credentials or future data access. Each run rechecks current permissions.

Current revisions protect edits. Cancellation stops future work and retains history; it does not undo completed effects or retract already accepted notices. The private owner can remove ordinary data under current permissions; other profiles retain their configured approval policy. Inspect unknown send/declaration outcomes before repeating them. These are suggestions and API semantics, not a mandatory flow.
