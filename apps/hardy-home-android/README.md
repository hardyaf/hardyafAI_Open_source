# Hardy Home Android

Native Kotlin/Jetpack Compose client for the household control service. This is
a custom family interface, not an OpenClaw operator UI.

The connected-alpha build uses `NetworkHouseholdRepository` and the generated
household API client. `MockHouseholdRepository` remains only for Compose previews.
The app includes:

- four household status cards and a visible two-run limit;
- phone pull-out navigation and a persistent tablet rail;
- private/shared conversation summaries;
- server-style prompt presets;
- transcript, context/media panel, and Owner-only diagnostics;
- a full-width composer with Android speech recognition;
- no model picker, terminal, tools, Gateway settings, or generic agent picker.

## Build requirements

- Android Studio with JDK 17
- Android SDK 37 and Build Tools 36.0.0
- Gradle 9.6.0 / Android Gradle Plugin 9.4.0

Open this directory in Android Studio and let it sync, or use a JDK 17 and an
Android SDK with the included Gradle wrapper:

```powershell
.\gradlew.bat :app:testDebugUnitTest :app:assembleDebug
```

The debug APK will be under `app/build/outputs/apk/debug/`.

## Install the prototype

The checked build produces a development-signed APK for hands-on UI review.
With USB debugging enabled on an Android phone or tablet, connect it and run
from this directory:

```powershell
..\..\.android-sdk\platform-tools\adb.exe devices
..\..\.android-sdk\platform-tools\adb.exe install -r app\build\outputs\apk\debug\app-debug.apk
```

On first launch, enter the household service address and the one-time Owner code
created on `hardybot`. The phone creates a P-256 signing key in Android Keystore;
neither the OpenClaw Gateway token nor a reusable enrollment code enters the app.
On Android 17 or newer, accept the nearby/local-network prompt so the app can
reach the private Hardybot address. This grants LAN access only; it does not
expose an OpenClaw credential to the phone.

## Live integration seam

`HouseholdRepository` remains the only UI data boundary. The network repository
persists ambiguous submissions and retries the same submission ID after a restart,
allowing the service and Gateway to reconcile the send without duplicating it.

The generated client comes from
`../../contracts/household-api/openapi.json`. Regenerate or verify it with:

```powershell
node ..\..\tools\generate-household-client.mjs
node ..\..\tools\generate-household-client.mjs --check
```

Do not add an OpenClaw token or Gateway client to the Android application.
