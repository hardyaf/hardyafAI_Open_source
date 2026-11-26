---
name: household-scheduling
description: Declare, inspect and manage authorized future household tasks through the native scheduler, preserving owner, audience, configuration revision and honest activation status.
metadata: {"openclaw":{"emoji":"⏰"}}
---

# Future tasks

Compose authorized `household_schedule_*` tools for an explicit future run or
reminder. The native scheduler owns due time, durable identity and run history;
do not start a second queue, loop, host timer or background poller. Resolve
relative dates with the runtime clock and time zone; clarify materially missing
time or ambiguous recurrence. Use one-off instants, intervals or a supported
cron/time-zone expression according to intent.

Preserve a useful self-contained task message and the original private/shared audience.
Delivery defaults to the trusted originating Discord destination or the configured private notification route for app requests.
Use `delivery:{mode:"announce",destination:"notifications"}` for the configured
protected notification destination, or `delivery:{mode:"none"}` for explicitly
quiet work. The application resolves recipients; do not supply raw channel IDs,
webhook URLs or arbitrary people. If no authorized destination is configured,
clarify or report the missing route; do not silently save a non-delivering reminder. Scheduled execution rechecks its own current grants;
creating a job never grants provider, household, diagnostic or credential access.
Route and audience grants are rechecked when the scheduled task runs and before a new native notice is prepared. Native acceptance of a prepared immutable notice commits delivery; an already queued notice may finish after a later grant change. Do not promise that cancellation retracts an accepted message. The strict per-retry policy cannot activate with the installed native delivery interface.
Execution completion and delivery status are separate: an unknown or partial
send must be reconciled rather than blindly repeated.
If activation is disabled or unconfigured, report the saved job as disabled and
state that it will not run. Do not imply a reminder was delivered merely because
its declaration saved.

Get the current job/configuration revision before an edit or cancellation.
Cancellation disables future work while retaining history; removal requires
current destructive approval. Neither rolls back completed external effects.
After an uncertain response, inspect the central effect receipt and owned native
job state before retrying a declaration. The same rules apply to future work
identified while reasoning through a brain dump.
