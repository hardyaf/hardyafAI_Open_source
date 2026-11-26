# Hardy Home application architecture

> Deployment host/account identifiers are redacted. Example addresses use
> `example.invalid`; paths use `$HOME`. Set actual connection, account and
> storage values from protected operator configuration.

**November 3 status:** preserve the implemented identity/transport boundary, but
read the [current status](current-status.md) before treating queue, presets,
media or family rollout descriptions as complete. The
[living design](household-assistant-design.md) adds wiki, Rolodex, brain dumps,
visuals, scoped display output and explicit no-repair diagnosis. These additions
are proposed until their implementation and acceptance are recorded.

Status: Alex-only connected alpha remains the accepted client baseline. Slice 1
service version 0.4.0 deployed November 3; [Slice 2 run checks passed](slice-2-domain-capabilities.md),
but expanded functionality acceptance remains deferred.

## Product boundary

Hardy Home is a household product that happens to use OpenClaw. It is not an
OpenClaw operator console with hidden navigation.

The system has four deliberately separate responsibilities:

1. The Android app owns the family-facing experience: profile status,
   conversations, prompt presets, chat, dictation, media, and the small set of
   controls allowed for the signed-in person.
2. The household control service authenticates devices, maps each person to
   exactly one configured agent, filters reads, schedules at most two household
   turns, and exposes sanitized diagnostics to Alex.
3. OpenClaw owns agent execution, session transcripts, tools, memory and native
   artifacts. The household service owns its scoped uploaded/published artifact
   projection and native-bound checkpoint references.
4. Ollama owns local inference. Configuring four agents does not require four
   copies of the model.

No phone receives a reusable OpenClaw Gateway owner credential. The Gateway
is never the public application API.

```text
Android app
    |
    | HTTPS + authenticated event stream
    v
Household control service
    |
    | loopback/private Gateway client
    v
OpenClaw Gateway ----> isolated Alex/Natasha/Fred/Belle agents
    |
    v
local Ollama model
```

## Trust and privacy rules

- A device is enrolled to one person with a one-time invitation. The device
  creates its key in Android Keystore; the server stores only the public key.
- A shared tablet may switch profiles, but adult profiles require a local
  biometric or PIN challenge.
- The server derives `profileId` and `agentId` from authenticated device state.
  It ignores client-supplied identity and agent selectors.
- A person may read only their private conversations plus conversations
  explicitly marked household-shared.
- Alex's administrative role can manage access and inspect sanitized service
  health. It does not silently grant access to another adult's private chat.
- Child agents receive a per-agent allowlist, sandbox requirement, and no
  terminal, configuration, approval, unrestricted filesystem, or diagnostic
  tools.
- Shared lists and notes continue to use the existing neutral household store.
  The control service does not create a second memory system.
- Conversation text remains canonical in OpenClaw. The service additionally
  retains queued or unconfirmed submission payloads until definitive delivery
  or terminal outcome, and owns scoped artifact bytes plus CAS checkpoint
  pointers. See [Slice 1 ownership](slice-1-runtime-platform.md#data-ownership-and-lifecycle).

The current redacted baseline has `sandbox.mode: "off"`, the `full` tool
profile, filesystem access outside the workspace, and full Gateway exec. Those
defaults are acceptable only for the trusted operator baseline. They must not
be inherited by child agents.

## Domain model

### Person profile

Fields:

- Stable ID (`alex`, `natasha`, `theo`, `belle`)
- Display name, avatar/color, role
- Fixed OpenClaw agent ID
- Capability set
- Presence and run state

Profiles are people. Agents are execution and memory boundaries. Sessions are
conversations. A prompt preset is an optional, validated addition to a newly
created conversation.

### Capability set

The service returns capabilities with `/v1/me`. Initial capabilities are:

- `chat`
- `voiceInput`
- `attachImages`
- `viewHouseholdStatus`
- `viewDiagnostics`
- `manageAccess`

The Android app uses this set to omit unavailable controls. The service checks
the same capability on every request; UI hiding is never the security check.

### Prompt presets

Presets such as `ayso`, `homework`, `household-planning`, and `story-time` are
server-owned records with:

- stable ID and display label;
- audience allowlist;
- short user-facing description;
- validated agent-context template;
- optional references to maintained household resources.

The app sends only the preset ID. Arbitrary system instructions from a client
are rejected. The selected preset is recorded on the conversation so it can be
shown and audited. The first integration may express the preset as a visible
context message. A later OpenClaw plugin may apply the same validated preset as
turn context without widening the phone's authority.

### Execution slots

There may be four configured and connected people while only two turns execute.
The household scheduler exposes `available`, `working`, `queued`, `paused`, or
`offline` for each person.

- A message is durably accepted before it is shown as queued.
- At most two household turns are dispatched to OpenClaw.
- Per-conversation ordering is preserved.
- OpenClaw `agents.defaults.maxConcurrent: 2` is the backstop, not the only
  source of user-visible queue state.
- Alex priority and pause controls are a later policy layer. FIFO is the first
  safe behavior.

## Household API v1

The first implementation deliberately has a small surface:

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness, version, and adapter mode |
| POST | `/v1/enrollment/claim` | Claim a single-use invitation with a device public key |
| GET | `/v1/me` | Current profile and capabilities |
| GET | `/v1/household/status` | Four status cards and slot count |
| GET | `/v1/presets` | Presets allowed for the current person |
| GET | `/v1/conversations` | Authorized conversation summaries |
| POST | `/v1/conversations` | Create a conversation for the mapped agent |
| GET | `/v1/conversations/{id}/messages` | Authorized transcript projection |
| POST | `/v1/conversations/{id}/messages` | Submit text and return running/queued receipt |
| POST | `/v1/conversations/{id}/cancel` | Cancel the current or selected run |
| GET | `/v1/events` | Authenticated server event stream |
| GET | `/v1/admin/diagnostics` | Sanitized Alex-only health summary |

Production requests are signed with the enrolled device's Android Keystore
P-256 key. The signature covers the method, path, timestamp, nonce, and body
hash; the service rejects expired timestamps and nonce replay. Development can
opt into an explicit `x-device-id` mock header, which fails closed in production.
The complete authoritative surface and schemas are in
`contracts/household-api/openapi.json`.

## OpenClaw adapter

The control service owns one private operator connection and will pin the
published OpenClaw Gateway client/protocol packages to versions tested with the
deployed Gateway. It translates the household API into only these families:

- session create/list/resolve;
- chat history/send/abort;
- session message subscriptions;
- narrowly sanitized health and diagnostics;
- authorized artifact retrieval.

The Android app never implements the OpenClaw wire protocol. A Gateway upgrade
therefore changes the adapter rather than every family device.

## Android application structure

The first Compose prototype has one activity and one household home surface:

- Four status cards across the top.
- A persistent conversation/preset rail on tablets and a pull-out drawer on
  phones.
- A transcript that owns most of the screen.
- An optional media or diagnostics pane below the transcript.
- A full-width composer with attachment, dictation, and send actions.
- No model picker, terminal, files browser, skill editor, Gateway settings,
  approval console, tool inspector, or generic agent switcher.

`NetworkHouseholdRepository` is the runtime implementation and uses the
checked-in client generated from the OpenAPI contract. The mock repository is
retained only for Compose previews. Pending submission IDs are committed to
local preferences before network dispatch and replayed after an ambiguous
failure or app restart.

## Connectivity

During LAN development, the app may connect to the control service on
the deployment host. The production target is HTTPS/WSS through private Tailscale Serve
or another authenticated private ingress. OpenClaw should ultimately return to
a loopback/private bind with only the control service and explicit operator
maintenance paths able to reach it.

Do not expose either the Gateway or the development identity header to the
public internet.

## Delivery stages

1. **Prototype:** mock Compose UI, executable mock service, API contract, and
   unit tests.
2. **Alex vertical slice:** device enrollment, Alex agent, live streaming,
   history, dictation, reconnect, and one signed debug APK.
3. **Household MVP:** four isolated agents, prompt presets, queue/status,
   private/shared conversation filtering, images, and tablet layout.
4. **Safety and administration:** child policies, Alex access controls,
   sanitized diagnostics, revocation, and an independent security test.
5. **Cutover:** signed family release, backup/restore exercise, parallel Discord
   soak, then Discord removal only after acceptance evidence is complete.

## Slice 2 native capability boundary

The service and first-party native plugin compose the same domain protocols.
Only trusted host invocation/run identity plus an admitted signed app request
can execute the new tools. Exact session/run or goal lineage, current devices,
profile bindings, audience and goal controls are checked; unknown/child/unmapped
paths fail closed. Domains own schemas/effects and current resource ACLs.
The effect registry is a receipt store, not another task queue. Replay/status
does not republish cached domain content after resource permissions change.

The protected domain-readiness API returns safe metadata; phones receive no
raw tool executor, provider client, SQL, paths or Gateway secret. Contact/media,
review/progress and source navigation views remain Slice 3.


## November 25 web sidebar organization and retained deletion

The web companion now uses viewport-bounded transcript/sidebar scrollers and an
in-app Chats drawer on narrow screens. Existing signed title metadata supports
title-only rename without overwriting current tags. Per-profile folders and chat
placement live in the same household database migration authority. They organize
only the viewer's sidebar, including visible household chats, and cannot change
an audience or grant.

Owner-only conversation removal is a canonical retained tombstone, not native
history erasure or provider undo. Deletion verifies current identity, live native
state and no unsettled work; admission, native/credential current guards and
delayed reads reject removed conversations. Folder deletion clears only the
viewer's placements and preserves conversations. No task, identity, queue,
credential or memory authority was introduced. The
[implementation record](web-conversation-organization.md) covers schema 8, stable
folder operations, executed checks and the forward-repair requirement for any
rollback after tombstones exist. Android does not yet expose the new folder UI.
