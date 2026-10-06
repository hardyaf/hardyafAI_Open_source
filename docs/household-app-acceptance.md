# Hardy Home acceptance plan

Do not replace Discord from a successful screenshot or conversational claim.
Each phase requires independent readback or test evidence.

## Phase 1: prototype

- The household service starts without credentials or third-party packages.
- Automated tests prove that a child cannot read Alex diagnostics.
- Automated tests prove that a client-supplied `agentId` cannot override the
  authenticated person's mapping.
- Automated tests prove that a third person's request is queued when two
  execution slots are occupied.
- The Android project contains phone and tablet layouts for the four status
  cards, conversation/preset drawer, transcript, content panel, and composer.
- The Android microphone action returns recognized text to the draft without
  auto-sending it.

## Phase 2: Alex vertical slice

- A newly enrolled device receives a revocable device identity and no Gateway
  owner secret.
- A message sent by Alex reaches only the Alex agent and appears in canonical
  OpenClaw history after reconnect.
- Duplicate or ambiguous sends are reconciled by a stable submission ID.
- An interrupted connection does not silently submit the same message twice.
- Conversation history reloads after application process death.
- The service reports only bounded, sanitized diagnostics.

Evidence recorded on 2026-10-05:

- The service and Android test suites pass, including one-time claim, signed
  request replay rejection, profile-derived agent routing, authorization, and
  SQLite reopen/replay tests.
- A live enrolled Alex test device mapped to OpenClaw agent `main`; the agent's
  canonical history returned exactly one user turn and the assistant response
  `Hardy Home connected.`
- The same live submission was replayed after an actual `household-control`
  process restart. Its receipt was reconciled from SQLite and canonical
  OpenClaw history still contained one user turn.
- The private `hardybot` user service is enabled on `192.168.1.127:4317`; its
  read-only Gateway probe reports connected.
- Android lint, unit tests, APK assembly, and APK signature verification pass
  for `0.2.0-alpha`.
- The APK is installed and enrolled as Alex on a Pixel 7. Android's local
  network permission is granted, while the OpenClaw Gateway credential remains
  absent from the phone.
- A phone-originated message was submitted and the app process was killed 250
  milliseconds later. After relaunch, canonical history contained exactly one
  copy of the user message and exactly one agent reply: `Phone restart
  accepted. Hardy Home connected.`
- Restarting `household-control` while the phone was open recovered the event
  stream, reconciled the terminal OpenClaw run from durable session state, and
  changed Alex from `Working` to `Ready` without a duplicate turn.
- The real-device layout, enrollment, text entry, send, history reload, and
  reconnect paths pass. Hands-on speech recognition still requires a person to
  speak into the phone and remains a separate UI check.

## Phase 3: household isolation

- Each person has a distinct agent workspace, session store, and memory index.
- Cross-profile transcript reads fail unless the conversation is explicitly
  household-shared.
- theo and Belle cannot select an adult agent, call an unlisted tool, open a
  terminal, inspect configuration, or read adult workspace files.
- Natasha-private content is not available to Alex administration views.
- Prompt presets are selected by ID and arbitrary system-prompt text is
  rejected.
- Shared household lists remain available through the maintained narrow skill.

## Phase 4: operations and cutover

- Two active runs and at least two queued messages preserve FIFO ordering and
  per-conversation serialization across a service restart.
- Alex can pause and resume admission without discarding queued messages.
- Revoking a phone prevents its next authenticated request and event reconnect.
- Android release signing, backup, restore, and upgrade are exercised on a real
  phone and tablet.
- The app is used in parallel with Discord for an agreed soak period.
- Discord is disabled only after chat, voice, images, memory, calendar/list
  actions, recovery, and child restrictions all pass.
