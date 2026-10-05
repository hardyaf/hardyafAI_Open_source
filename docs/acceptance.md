# Acceptance evidence

Run on 2026-10-04 against the active host.

## Focused installation checks

- OpenClaw configuration validation and plugin diagnostics passed.
- The gateway was healthy and Discord reported connected.
- `ollama-local` served the preserved models on loopback.
- `gpt-oss:20b` loaded fully on the RTX 3090 at 32,768 context.
- `nomic-embed-text` loaded fully on the GPU; no cloud fallback exists.
- A direct local-model smoke returned `LOCAL_MODEL_OK`.
- Discord message `1556406201388900405` was sent by the bot to the
  household channel and independently read back.

The direct GPU probe generated at about 11.3 tokens per second after a
roughly 19-second model load. A 32-token output limit was consumed by model
reasoning before visible text; that was an output-budget/model behavior
result, not an inference-service failure.

## Consolidated household pass

Marker `OC-NOTE-20261004-7F3A` was written to
`notes/household/acceptance-2026-10-04.md`. A matching list item was
created in `LISTS.md` and checked off. The assistant created and then read
back a confirmed event on the House calendar:

- Event ID: `6b57p3519p7a6rollh2l45le0o`
- Title: `[OpenClaw acceptance] Household baseline`
- Time: 2026-10-05 10:00-10:15 America/New_York
- Description marker: `OC-CAL-20261004-7F3A`

Memory search returned the note as the top result at about 0.852 and the list
at about 0.766. After a real gateway restart, file hashes were unchanged,
the calendar event still read back, memory returned the same top result,
Discord remained connected, Ollama remained GPU-backed, and user lingering
remained enabled.

Post-restart SHA-256:

- Note: `e4b2266223d34caa4719aa0d6d9ce933d2347601173045762c8273403aac20fc`
- List: `6c107565af6fa719916f29bfd52c2ba4c1b1eac4503cf2383dc4dced65619ab3`

## Result classification

Configuration and integration:

- Pass: native Ollama inference and embeddings, persistent notes/lists,
  House calendar write/read, Discord delivery/readback, and gateway restart.
- External action needed: Alex and Natasha must share their calendars with
  the bot account; the Google Tasks API must be enabled for Google Tasks.
- Genuine gap: consumer OAuth cannot provide Google Keep through gog.

Model behavior:

- The first low-reasoning pass falsely claimed tools were unavailable.
- At medium reasoning, the model executed tools but paused before completing
  the full sequence; an explicit continuation completed it.
- Independent checks prove the resulting actions, but this 20B model is not
  fully reliable at autonomous multi-tool orchestration.

Hardware and resources:

- Pass after installing the matching NVIDIA kernel module.
- Inference and embedding models ran on the RTX 3090.
- Root-disk pressure was resolved without deleting model volumes.

Security:

- OpenClaw warns about a small local model combined with full unsandboxed
  tools and about the personal-assistant trust model. These are deliberate
  baseline choices. The process remains an unprivileged OS user, secrets
  remain out of this repository, and LAN management is token protected.

## Isolated-agent and memory upgrade

Run later on 2026-10-04:

- Added agent `natasha` with its own workspace, session store, and database.
- Verified exact Discord bindings for Natasha's private channel and DM; the
  lower-priority wildcard route remains on `main`.
- Enabled the bundled Active Memory 2026.9.8 plugin for Natasha only in
  `escalate` mode.
- Replaced `nomic-embed-text` with local `qwen3-embedding:8b` and rebuilt
  both indexes. Deep probes passed; both vector indexes are complete at 4096
  dimensions with hybrid FTS/vector search and no fallback.
- An isolation query returned Natasha's MEMORY.md at score 0.870 from the
  Natasha index and no match from the main index.
- A non-delivered end-to-end Natasha turn read USER.md and correctly reported
  only name and timezone. The execution receipt proves a successful real
  `read` tool call.

That same turn recorded three failed memory-search attempts before succeeding
through a direct file read. The memory CLI and embedding probes independently
passed. This is further evidence of `gpt-oss:20b` tool-orchestration
weakness, not an index, permission, or GPU integration failure.

A separate cross-session canary was not accepted as an Active Memory pass.
Gateway logs showed `session-ineligible` because the turn originated from
the management CLI, not an eligible private inbound conversation. The model
eventually returned `UNKNOWN`, correctly refusing to invent the value, but
spent 43 seconds and many failed tool attempts getting there. Both test
sessions and their index chunks were removed; the generated test artifacts
were moved to the migration backup, and a final canary search returned no
matches. Active Memory injection remains to be accepted from Natasha's first
real Discord DM.

During the rebuild, Ollama reported approximately 12 GB for the chat model and
11 GB for the embedder; GPU use peaked at 23,061 MiB of 24,576 MiB. The
embedder has a short idle lifetime, but concurrent embedding and GPU OCR are
resource-constrained until the second RTX 3090 is installed.
After testing, the embedder was explicitly unloaded and GPU use returned to
13,416 MiB with only `gpt-oss:20b` resident.

## Household capture and display upgrade

Run later on 2026-10-04:

- Installed the first-party `household-capture` workspace skill for both
  `main` and `natasha`; OpenClaw reports it eligible and model-visible for
  both agents.
- Added a neutral shared household store outside both private workspaces,
  while retaining separate Jarvis and Natasha personal lists and notes.
- Verified atomic writes, cross-process locking, stable IDs, duplicate
  suppression, exact completion, recoverable removal/restore, scoped note
  search, and exclusion of personal data from the household dashboard.
- The six-test production suite passed from both deployed workspace copies.
- A natural-language main-agent turn saved one shared list item, one private
  task, and one private note in a single verified batch. A second turn
  completed both list items in one tool call. Independent reads confirmed the
  saved and completed states.
- A Natasha-agent turn read the shared list without exposing main-agent
  personal data.
- Created a native `session:report` household list widget in the pinned main
  session named `Household`. It read back at revision 2 with no active
  acceptance items. This is an on-demand snapshot, not a duplicate data store
  or an automatic refresh service.
- The built-in hybrid memory CLI returned note `JN-20261005-0001` as its top
  result (score 0.687, vector 0.553, text 0.906) using local
  `qwen3-embedding:8b` at 4096 dimensions.
- Deterministic captured-note search returned that same ID and the exact body.

The first isolated agent recall attempt selected an older acceptance note
after invalid tool calls instead of the note named in the request. Storage,
the memory index, and direct search were healthy. The agent policies and skill
were therefore hardened to route captured-note recall through scoped,
deterministic reads and to forbid substituting another note. A fresh
ordinary-language turn then returned the exact ID and sentence. It still
recorded two failed internal tool attempts before succeeding, so the remaining
risk is `gpt-oss:20b` tool selection/orchestration, not permissions, storage,
embeddings, or GPU execution.

The pre-change live files are recoverable from:

    /home/codex/.openclaw/backups/household-capture-20261005T002553
