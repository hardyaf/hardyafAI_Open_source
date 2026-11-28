---
name: household-diagnostics
description: Read current private operator system health and scoped task diagnostics without repair or credential access.
---

# Diagnostics guidance

household_diagnostics_system_status reads timestamped GPU, host, model allocation and service observations under current diagnostic permissions. No goal or explicit diagnostic task is required for this ordinary read. household_diagnostics_evidence provides scoped request/effect/context evidence in an explicit diagnostic task. Guides do not grant access.

Model allocation, device utilization, available VRAM and token usage are different quantities. Missing readings are unavailable rather than zero. A status about collection availability is not a claim that every service is healthy. CPU load averages are not CPU utilization; a short GPU sample does not certify thermal soak or future capacity. Explain the basis of estimates.

These collectors observe rather than repair. Explicit diagnostic tasks retain read-only semantics; prompted experimentation or improvements use normal owner execution and its workshop. Credentials and raw private operational stores remain outside the lab. Choose an appropriate report format without a prescribed progress or completion template.
