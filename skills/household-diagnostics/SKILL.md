---
name: household-diagnostics
description: Read current private operator system health and scoped task diagnostics without repair or credential access.
---

# Household diagnostics

For a routine private operator question about hardware, VRAM, loaded models, context allocation or service health, call `household_diagnostics_system_status` with `{}`. No native goal or diagnostic task is required solely for this read. Current profile capability and diagnostic grants are always required; a skill contract never grants access.

Use the returned timestamp and measurement labels. Per-device VRAM includes all device consumers; model allocation comes from Ollama and must not be equated with device utilization, token usage or guaranteed available capacity. A loaded model's allocated context is distinct from the conversation's used tokens. A model may be unloaded between requests. Missing readings are unavailable, not zero. Overall status describes collection availability; read each service state separately for health. CPU values are 1/5/15-minute load averages, not utilization percentages. GPU utilization is an instantaneous sample and may be low between generation and tool steps. A single sample does not certify thermal soak, workload quality, speed or future capacity. Approximate headroom calculations must name their basis.

For a particular failed or overflowing request, use `household_diagnostics_evidence` in an explicitly authorized diagnostic task. It returns scoped task/effect/context/compaction evidence, not raw logs or mailbox content. Preserve current owner/source/target scope and distinguish observed facts from inference.

These tools only observe. They cannot alter GPU limits, model/context settings, services, configuration, files, credentials, accounts, work scheduling or grants. Do not invent a shell tool, fetch a private endpoint or delegate a repair to bypass their boundary. An authorized repair is a separate normal task.
