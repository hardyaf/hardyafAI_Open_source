# Hardy Home for Chrome

Android is the primary client. Update the Chrome companion on demand against the
current Android workflows and household API. Each browser enrolls separately
under its existing household profile.

Chrome supports private and household chat, history, Eastern timestamps, names
and tags, prompt flavors, images and PDFs, camera capture, output previews,
local dictation, task and progress controls, linked clarifications, explicit
approvals, Brain dump and scoped diagnosis. The Rolodex, Lists, Knowledge and
Receipt Review screens follow the current household grants. A library item
can be linked to a chat using the same typed focus as Android.

Household control owns conversation metadata, history, grants and delivery
receipts. OpenClaw owns execution. IndexedDB holds the nonextractable device
key, device ID, file drafts and exact unresolved or recoverable sends for this
device. Conversation history and output previews are loaded on demand.
An uncertain send keeps its submission ID. A proven pre-dispatch failure
allows an explicit retry with a new ID. Disconnect clears the browser's key
and local draft and delivery buffers.

Camera capture uses Chrome's camera permission. Dictation uses Chrome's
on-device recognition and requires a supported local language pack. Preview
of PDFs opens Chrome's PDF viewer. Plain text, including SVG source, is shown
as text.

## Sidebar and browser layout

The browser keeps the composer visible within the current viewport. The
conversation list and messages scroll independently. On narrow screens, Chats
opens the in-app sidebar.

Use the conversation's actions button to rename, move or remove it directly in
the sidebar. New folder creates a durable personal folder. Drag a conversation
onto a folder or use Move for keyboard and touch. Folder placement is private to
the signed profile and never changes the conversation's audience. Deleting a
folder returns its conversations to Unfiled.

Conversation deletion removes the conversation from app access and prevents new
admitted work. Native history, artifacts and recorded effects remain with their
existing owners. Active or unconfirmed work must be settled first; stopping an
active task allows removal once it is idle. See the
[implementation and ownership record](../../docs/web-conversation-organization.md).

## Build and serve

On Hardybot, run from the project root:

    node apps/hardy-home-web/build.mjs

The household control service serves the allowlisted files at /home/. The
existing signed API remains on the same origin. A private HTTPS origin or a
localhost SSH tunnel gives Chrome the secure context required for device
enrollment. Plain LAN HTTP shows a connection instruction. The tunnel's local
host and port identify the browser origin. Use the same address on later
visits to retain the existing enrollment.

Use a one-time personal invitation. The display invitation is reserved for
the kitchen screen. Disconnect removes the browser's key and device ID from
Chrome. The existing operator device-revocation authority can revoke a lost or
retired browser.

For a parity update, compare the requested Android workflow and its current
signed API contract, adapt the browser UI, then verify the feature through
Chrome and confirm Android compatibility on Hardybot. Keep protected values and
canonical state with their current owners.

## Fitbit sync

An explicitly configured personal profile sees a self-scoped Sync my Fitbit card. It starts a bounded session through the existing signed API and opens the official app in that person's Android guest. It does not expose the emulator or Google credentials. Session state is separate from verified tracker/cloud sync. See [Fitbit control](../../docs/fitbit-sync.md) and [Google Health data access](../../docs/fitbit-health-data.md).
