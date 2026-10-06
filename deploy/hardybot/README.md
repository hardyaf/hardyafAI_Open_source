# hardybot deployment

The connected alpha runs `household-control` as a hardened user service beside
the OpenClaw Gateway. The Gateway remains private to the host; Android devices
receive only the household API.

1. Put this repository at `/home/operator/hardyafAI_Open_source`.
2. Run `bash deploy/hardybot/install-household-control.sh` as `codex`.
3. The installer reuses the existing local Gateway token from OpenClaw's
   protected environment file without printing it. If it cannot find that
   value, it creates a protected template and exits so the value can be entered
   manually before rerunning the installer.
4. Create Owner's 15-minute invitation only when the phone is ready:

   ```bash
   cd ~/hardyafAI_Open_source/services/household-control
   npm run invite -- alex 15
   ```

   During a supervised setup, an easy explicit code can be supplied as the last
   argument (for example, `npm run invite -- alex 15 1234abcd`). It is still
   single-use and expires after the requested interval.

5. Enter the service address and one-time code in the Android app.

The state-changing live acceptance command is deliberately gated:

```bash
cd ~/hardyafAI_Open_source/services/household-control
HARDY_HOME_LIVE_SMOKE=1 \
HARDY_HOME_DATABASE=~/.local/share/hardy-home/household-control.sqlite \
HARDY_HOME_BASE_URL=http://192.0.2.10:4317 \
npm run smoke:live
```

It creates and then revokes an ephemeral Owner test device, sends one real agent
turn, replays its submission ID, and verifies canonical history.

The alpha binds to the private LAN address. Before remote access or a household
release, put it behind private HTTPS (recommended: Tailscale Serve), change the
Android service address to that HTTPS origin, and do not expose port 4317 to the
public internet.
