# Read-only system status

Status: **deployed in household control 0.11.0 with deterministic post-deployment checks passed**. The protected manifest and native registration declare 91 tool names before contextual authorization filtering, including the optional system-status tool. Natural-language chat acceptance was not run while network restoration remains deferred.

## Plan and reuse

Add `diagnostics.system_status` to the existing household diagnostics domain. A routine private operator query may read a snapshot without creating a diagnostic goal. The existing diagnostics grant, profile capability, admitted source, identity and current-authority checks remain in force. Existing task-evidence diagnosis retains its explicit diagnostic-mode requirement.

| Boundary | Decision | Owner and effect |
| --- | --- | --- |
| Tool discovery and authorization | Adapt existing domain catalog, native grants and diagnostic capability | Household domain runtime; read only |
| Fixed process execution | Reuse BoundedProcessRunner | Existing cancellation, timeout and output bounds; no model-supplied command |
| Host observation | New narrow collector adapter | Fixed host/kernel, NVIDIA, service and loopback model-status reads; no compatible existing hardware reader |
| Snapshot projection | New diagnostics-owned typed reader | Strict whitelist; no credentials, raw logs, arbitrary URLs, paths, process lists or command lines |
| Storage and scheduling | Reuse none needed | On-demand snapshot only; no new store, queue, daemon, background monitor or retained history |
| Deployment | Reuse protected source/config promotion and attestation | Keep native core patch, model, context/reasoning and all existing credential boundaries |

## Data ownership

Linux/NVIDIA own instantaneous hardware readings; Ollama owns loaded-model allocation and context metadata; systemd owns unit state. The diagnostic result is a timestamped, nonauthoritative observation. Model VRAM, total device VRAM, context capacity, observed usage and CPU load are different measures. Ollama's reported model size is runtime resident allocation, including cache, rather than the downloaded weight-file size. CPU load averages are not utilization percentages. Overall snapshot status describes measurement availability; individual service states describe health. Unavailable data is labeled, never converted to zero or healthy. No durable state or external mutation is introduced.

The new source module owns collection and redacted validation. The large runtime file receives only composition/dispatch wiring; it does not acquire hardware parsing or process-control policy.

## Validation and deployment

Required checks cover fixed commands and endpoints, bounded cancellation/failures, hostile/malformed provider responses, partial availability, units/freshness, current identity/grant/private-operator authorization, unknown input rejection and unchanged read-only diagnostic behavior. Run checks and live observation on Ubuntu. Then promote exact source and the additive native tool allow entry, validate stock schema, verify actual native tool discovery, protected PID/config and credential isolation. Do not run model inference solely to measure status.

Do not change networking, credential grants, scheduling, model settings, native core, databases or conversations. A source/config rollback restores matching static preimages only and never overwrites newer business records. Existing application bind failures remain separate from hardware visibility.

## Implementation and component verification

The fixed, no-input collector reads bounded NVIDIA telemetry, CPU load/core count, RAM, root-filesystem space, the fixed system/user service states and Ollama's loopback loaded-model list. Its clean subprocess environment, fixed arguments, discarded stderr, streaming output bounds, disabled HTTP proxies/redirects and five-second total deadline prevent arbitrary command or endpoint selection. Missing/unloaded units are unavailable rather than healthy inactive services. Cleanup covers the collector's owned command process groups even after their leaders exit.

The typed runtime adapter projects only the versioned whitelist and rejects malformed known fields. It rechecks the current private operator identity, diagnostics capability and grant before and after the snapshot, including cancellation. A routine authorized chat needs no artificial diagnostic goal. Existing task-evidence diagnosis retains its diagnostic-mode requirement. A snapshot reports collection completeness separately from health: an observed failed or restarting service can coexist with successful measurement, and missing sensors are null/unavailable rather than zero.

Component evidence: **635/635 backend checks passed with no skips using the installed protected SDK**; the earlier 623-pass/12-skip attempt remains retained and its fixture environment was corrected. The total includes 12 system-status authorization checks and two policy checks. The collector's **25/25 Python checks**, **11/11 installer checks** and source validation passed separately. A bounded live read-only snapshot returned two GPUs, host metrics and three service observations; no model was loaded or invoked. An empty loaded-model list is valid and does not imply zero hardware or context capacity.

## Acceptance

**Protected deployment passed.** The exact 12 runtime/source paths and two Main allow-entry inputs were promoted with ownership, modes and all ACLs/xattrs preserved. The existing V5 native patch and Main 128K/high defaults are unchanged. Fresh Gateway PID/config attestation and credential isolation passed. Live native tools.catalog and tools.effective checks confirmed the optional tool's registration and availability for an existing private operator session; forbidden host tools remained absent. The protected empty-input schema and Main allow entry were verified. The fixed collector passed as the actual Gateway actor in 54.489 ms, reporting two 24 GiB GPUs, no loaded models and the fixed service observations, with no inference or model loading.

This establishes deterministic registration, scoped component authorization and deployed collection, not a model-authored chat workflow. Household web access remains unavailable while network restoration is deferred; no natural-language chat was run. Networking, native core, model/context/reasoning, credential grants, databases and conversations were not changed.
