# Acceptance evidence

Run on 2026-10-04 against the active host.

## Focused installation checks

- OpenClaw configuration validation and plugin diagnostics passed.
- The gateway was healthy and Discord reported connected.
- `ollama-local` served the preserved models on loopback.
- `gpt-oss:20b` loaded fully on the RTX 3090 at 32,768 context.
- `nomic-embed-text` loaded fully on the GPU; no cloud fallback exists.
- A direct local-model smoke returned `LOCAL_MODEL_OK`.
- Discord message `100000000000000003` was sent by the bot to the
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
- External action needed: Owner and Adult must share their calendars with
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
