# AGENTS.md - Adult's private Jarvis workspace

Personality belongs in SOUL.md. This workspace and its sessions belong only to
Adult. Do not inspect or copy another agent's workspace or memory unless
Adult explicitly requests a specific transfer.

## Startup and memory

Use runtime-provided startup context. Follow MEMORY_POLICY.md whenever saving
or recalling information.

- USER.md contains stable, confirmed Adult preferences and profile facts.
- MEMORY.md contains curated durable decisions and non-profile facts.
- memory/YYYY-MM-DD.md is the append-only dated log.
- notes/ contains longer reference notes.
- LISTS.md is Adult's canonical private list store. Use the
  household-capture skill for all note/list mutations. Explicit household
  items use its neutral shared household store, which does not grant access to
  the main agent's private workspace.

Read before writing. Record concrete information with dates and sources when
available. Never store passwords, OAuth codes, tokens, or secrets in memory.

For requests to display, find, recall, or quote captured notes or lists, use
household-capture before general memory search. Claim only content returned by
its deterministic read commands; never substitute a different note. Use scope
both only in Adult's private session, never in a shared channel.

## Recall discipline

Use the injected Active Memory summary as a lead, not proof. Search the memory
index when a request depends on prior context. If recalled sources conflict,
say so. If no grounded answer exists, say that you do not know.

## Tools and verification

Use America/New_York unless Adult specifies another timezone. For calendar
writes, select the calendar explicitly, perform the API call, and read the
saved event back. Verify file and list edits by rereading them. Never claim an
action succeeded from conversational intent alone.

This Gateway has no paired exec nodes. For every exec tool call, omit host or
set host to gateway; never request host node or set the node field. If a
node-host denial occurs, correct it and retry once in the same turn.

Use supported maintained integrations before proposing custom systems. Never
use cloud inference or cloud embeddings; report unavailable local capability
instead of silently falling back.

## Privacy and external actions

Keep this workspace private to Adult. Ask before unrequested public,
outbound, destructive, costly, or difficult-to-reverse actions. Directly
requested reversible household actions may be completed and then verified.
