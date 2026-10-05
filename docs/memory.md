# Memory and agent architecture

Deployed 2026-10-04 on OpenClaw 2026.9.8.

## Agent boundary

`main` is the default Jarvis agent for the shared household channel, Owner
DMs, and operator management. `natasha` is a separate Jarvis agent with its
own workspace, sessions, and SQLite/vector database.

Discord routes Adult's private channel and her direct messages to
`natasha`; a lower-priority account-wide rule sends all other Discord
traffic to `main`. Both agents share the same Ollama model weights, so this
does not load a second copy of the 20B chat model.

## Current memory layers

- USER.md: stable confirmed profile facts and preferences.
- MEMORY.md: curated durable decisions and non-profile facts.
- memory/YYYY-MM-DD.md: append-only dated observations.
- notes/: longer reference notes.
- Agent LISTS.md: canonical private task/list store.
- `/home/operator/.openclaw/shared/household/LISTS.md`: canonical shared household
  shopping/task store, accessed by both agents through household-capture.
- Built-in SQLite hybrid search: full-text plus 4096-dimensional vectors.
- Adult direct/explicit transcripts: indexed by Remember across
  conversations.
- Active Memory: bounded pre-reply retrieval for Adult in `escalate` mode.

The canonical resolver is written into each agent's AGENTS.md. One item has
one authoritative destination; cross-references may point to it. Conflicts
retain source/date and are not silently overwritten.

## Retrieval configuration

- Provider: local Ollama at 127.0.0.1:11434
- Embedding model: qwen3-embedding:8b
- Dimensions: 4096
- Search: hybrid FTS and vector
- Cloud fallback: none
- Active Memory targets: natasha only
- Active Memory reasoner: resolved agent model, currently gpt-oss:20b
- Active Memory query: recent turns, preference-only prompt, thinking off
- Deep recall policy: escalate only
- Recall timeout: 15 seconds
- Recall transcript artifacts: disabled

Active Memory's cross-conversation transcript source is supported only for
direct and explicit UI conversations. Adult's private Discord channel still
has isolated file/index recall and pre-reply retrieval, but the channel itself
is not eligible for automatic cross-conversation transcript ingestion. Use
her Discord DM for that specific capability. CLI-created sessions are also
ineligible; the first real DM remains the acceptance point for injected
cross-conversation recall.

## Storage

- Main workspace: /home/operator/.openclaw/workspace
- Adult workspace: /home/operator/.openclaw/workspace-natasha
- Shared household store: /home/operator/.openclaw/shared/household
- Main database: /home/operator/.openclaw/agents/main/agent/openclaw-agent.sqlite
- Adult database:
  /home/operator/.openclaw/agents/natasha/agent/openclaw-agent.sqlite

The Markdown files are authoritative. SQLite indexes and embedding caches are
derived and can be rebuilt with `openclaw memory index --force`.

## Model and hardware decision

`gpt-oss:20b` remains the one-3090 baseline: it fits fully on the GPU at
32,768 context, supports tools, and leaves substantial idle headroom. It is
not declared the final best model. Acceptance has twice shown imperfect tool
orchestration.

No third, cheap generative memory model is loaded yet. On one 3090, keeping a
chat model, the 8B embedder, and another model resident would cause eviction or
CPU spill. Active Memory therefore resolves to gpt-oss:20b for now and runs
deep recall only on escalation. After the second GPU is installed, benchmark a
small local memory reasoner separately rather than assuming it improves recall.

Qwen3 Embedding 8B materially improves semantic retrieval quality but is
resource-heavy. During indexing Ollama reported about 12 GB for the chat model
and 11 GB for the embedder, with total GPU use at 23,061 MiB of 24,576 MiB.
The embedder unloads after roughly five idle minutes. Until the second 3090 is
installed, avoid concurrent embedding rebuilds and GPU OCR.

After the second GPU is installed, compare `gpt-oss:20b` against
`qwen3.5:35b-a3b` using the same household acceptance suite. Keep the
embedder/OCR workload off the chat-model GPU if the serving layout permits.
Do not select a larger model only from benchmark reputation; require better
calendar/list/tool completion, grounded recall, latency, and VRAM evidence.

## Deliberately not added

There is no Chroma store, graph database, custom factstore, compatibility
layer, or cloud recall service. The supported OpenClaw tiers and isolated
agent boundary come first. A small SQLite factstore is the next justified
addition only when exact-value queries outgrow curated Markdown. Graph and
episodic stores should wait for measured retrieval failures.
