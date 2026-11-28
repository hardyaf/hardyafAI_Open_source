# Hardy Home Android

Native Kotlin/Jetpack Compose household client. Each phone enrolls separately to one
configured family profile and creates its own Android Keystore P-256 signing key.
Private and household conversations have explicit audiences. Owner-only Connections forms
hold entered provider credentials briefly in protected field state and send them directly
to the isolated HTTPS credential service. They bypass chat, saved drafts and model input.
The OpenClaw Gateway token remains server-side.

Slice 3 source includes conversation media capture/import/upload, linked clarifications,
explicit action approval buttons, native task progress and goal controls, Rolodex lookup
with history and card sources, personal/shared lists and knowledge, receipt review, and
safe output previews. Available views and actions follow current server authorization;
children remain conversation-only. No model picker, terminal or raw tool controls appear
in the household interface.

These features are implemented source, not a functionality certification. Build and startup
checks run between integration slices; the consolidated functionality campaign follows
the completed three-slice build. See [client architecture and acceptance notes](../../docs/slice3-clients.md).

## Build on the authoritative Ubuntu host

The project pins Gradle 9.6.0, Android Gradle Plugin 9.4.0 and Kotlin 2.4.10. It uses
JDK 17, Android API 37 and Build Tools 36.0.0. Google's SDK package identifier is
`platforms;android-37.0`. [AGP compatibility](https://developer.android.com/build/releases/agp-9-4-0-release-notes)
documents the required Gradle, JDK and Build Tools versions.

Set `JAVA_HOME` and `ANDROID_HOME` to the host's managed build toolchain, then run:

```sh
bash gradlew --no-daemon :app:assembleDebug
```

The development-signed APK is `app/build/outputs/apk/debug/app-debug.apk`. Build scripts
retain its hash and a separate copy with the integration-slice evidence. No Android
emulator, instrumentation test, business workflow or provider call is part of this build
command. Functionality testing remains a separate final campaign.

On first launch, enter the household service address and your own one-time phone
invitation. The debug build supports a private LAN address; release builds require HTTPS.
On Android 17 and newer, accept the local network permission when connecting to a household
LAN service. A kitchen screen uses a different dedicated invitation and browser client.

## Application boundaries

`HouseholdRepository` owns UI state and request delivery. `NetworkHouseholdRepository`
uses the enrolled device identity and the generated API client; the Slice 3 signed read
adapter reuses the exact same canonical signing protocol. Pending submissions retain
their exact request body and identity through a lost response or process restart.

`WorkspaceRepositorySupport`, `HouseholdLibraryApi`, and `ClientAttachmentStore` own
client projections, safe previews and temporary media delivery buffers. Canonical tasks,
contacts, lists, memories, approvals and receipt states remain on their existing server
owners. Media drafts are app-private until uploaded; disconnecting a phone clears its
local drafts, identity and previews.

`MockHouseholdRepository` is only for Compose previews. The app launches the real network
repository and never presents simulated family data as a live connection.

Regenerate/check the API client from the repository root:

```sh
node tools/generate-household-client.mjs
node tools/generate-household-client.mjs --check
```

## Tap-to-start and tap-to-stop dictation

Tap the microphone in Chat or Brain dump, speak at your own pace, then tap
Stop. The foreground recorder stays open through silence and keeps the screen
awake. Hardybot transcribes the completed clip locally and appends the result
to the current conversation draft. The existing Send action submits the draft
in the selected mode. Leaving the app or reaching 30 minutes stops capture
and keeps the recording on the phone for explicit transcription or discard.

The Android client signs the binary AAC/MP4 request with the enrolled personal
device key. The server rechecks the chat and voiceInput grants and current
device binding. The CPU transcriber uses a pinned local model, processes the
audio in memory, and returns draft text through the signed response. The
binary endpoint is documented in the OpenAPI contract and uses the existing
signed Android transport.

## Protected connections

Version 0.6.0-alpha adds owner-only Bitwarden setup, password storage and Google OAuth.
Credential fields are not saved across recreation or backgrounding, and credential
screens block screenshots. Requests require HTTPS and bypass the ordinary retry cache.
The service must report enforced isolation before forms are enabled.

Google OAuth uses the owner's registered client and matches the expected account.
A valid HTTPS DNS callback completes automatically. For a private IP service address,
register the loopback redirect shown by the app and paste the returned browser URL
into the protected completion field. The application exchanges the authorization code
and saves the refresh token directly to Bitwarden.

### Finding account setup on the phone

Open the side menu, then Connections while enrolled as the household owner.
Version 0.6.2-alpha names the existing actions explicitly: Set up Bitwarden,
Add a username and password, Set up Google authorization, and Connect a Google
account. If Bitwarden is already connected, use Add a username and password
directly; the existing protected service saves it in the selected vault project.
These labels reuse the existing native forms and signed HTTPS connection API.
No provider credentials enter chat, the ordinary retry cache or saved app state.

Install the new APK as an update to the existing Hardy Home app. Its package
and signing identity must match the previous installer so Android preserves the
device enrollment, Keystore identity and private app data. Phone installation
and real account-entry acceptance remain explicit user steps after build checks.