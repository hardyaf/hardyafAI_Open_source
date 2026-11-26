#!/usr/bin/python3
"""Fixed native lifecycle adapter. No account access or Fitbit protocol."""
import datetime
import fcntl
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time

BASE = Path(__file__).resolve().parent.parent
SYSTEMCTL = "/usr/bin/systemctl"
SESSION_SECONDS = 20 * 60
GUESTS = {"guest1": "emulator-5580", "guest2": "emulator-5582"}
STOP = threading.Event()

class Failure(Exception):
    def __init__(self, code, status=503, outcome="unknown"):
        self.code, self.status, self.outcome = code, status, outcome

def command(args, timeout=5):
    return subprocess.run(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                          stderr=subprocess.DEVNULL, text=True, timeout=timeout,
                          env={**os.environ, "LC_ALL": "C", "TZ": "UTC"})

def unit(guest):
    return "charge6-sync-" + guest + ".service"

def properties(name, user=True):
    args = [SYSTEMCTL] + (["--user"] if user else []) + ["show", name,
        "-p", "LoadState", "-p", "ActiveState", "-p", "SubState",
        "-p", "Result", "-p", "InvocationID", "-p", "ActiveEnterTimestamp",
        "-p", "InactiveEnterTimestamp", "-p", "ExecMainStatus"]
    p = command(args)
    return dict(line.split("=", 1) for line in p.stdout.splitlines() if "=" in line)

def radio_ready():
    return properties("charge6-radio-pilot.service", False).get("ActiveState") == "active"

def adb(guest, *args, timeout=5):
    return command([str(BASE / "software/sdk/platform-tools/adb"), "-s", GUESTS[guest], *args], timeout)

def date(value):
    try:
        parsed = datetime.datetime.strptime(value, "%a %Y-%m-%d %H:%M:%S %Z")
        return parsed.replace(tzinfo=datetime.timezone.utc)
    except (ValueError, TypeError):
        return None

def status(guest):
    state = properties(unit(guest))
    loaded = state.get("LoadState") == "loaded"
    active = state.get("ActiveState", "inactive")
    started = date(state.get("ActiveEnterTimestamp"))
    if not loaded:
        phase = "unavailable"
    elif active in ("activating", "reloading"):
        phase = "starting"
    elif active == "deactivating":
        phase = "stopping"
    elif active == "failed":
        phase = "needs_help"
    elif active == "active":
        phase = "starting"
        vm = properties("charge6-" + guest + ".service")
        if vm.get("ActiveState") == "active":
            try:
                ready = adb(guest, "shell", "-n", "getprop", "sys.boot_completed").stdout.strip() == "1"
                app = adb(guest, "shell", "-n", "pidof", "com.fitbit.FitbitMobile").returncode == 0 if ready else False
                phase = "running" if ready and app else "starting"
            except (OSError, subprocess.TimeoutExpired):
                pass
    else:
        phase = "idle" if radio_ready() else "unavailable"
    return {"version": 1, "ok": True, "phase": phase,
            "sessionId": state.get("InvocationID") or None,
            "startedAt": started.isoformat() if started else None,
            "endsAt": (started + datetime.timedelta(seconds=SESSION_SECONDS)).isoformat()
                      if started and phase in ("starting", "running") else None}

def control(action, guest):
    if action == "start":
        if not radio_ready():
            raise Failure("fitbit_radio_unavailable", outcome="not_sent")
        if properties(unit(guest)).get("LoadState") != "loaded":
            raise Failure("fitbit_not_installed", outcome="not_sent")
        for other in GUESTS:
            if other != guest:
                for other_unit in [unit(other), "charge6-" + other + ".service"]:
                    if properties(other_unit).get("ActiveState") in ("active", "activating", "deactivating"):
                        raise Failure("fitbit_radio_busy", 409, outcome="not_sent")
        # StartUnit is idempotent for the active native unit; it does not extend its session.
        args = [SYSTEMCTL, "--user", "start", "--no-block", unit(guest)]
    else:
        args = [SYSTEMCTL, "--user", "stop", "--no-block", unit(guest)]
    if command(args).returncode:
        raise Failure("fitbit_control_unavailable")
    value = status(guest)
    if action == "start" and value["phase"] == "idle":
        value["phase"] = "starting"
    elif action == "stop" and value["phase"] in ("starting", "running"):
        value["phase"] = "stopping"
    return value

def session(guest):
    (BASE / "run").mkdir(exist_ok=True)
    with open(BASE / "run/sync-session.lock", "a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 13
        if STOP.is_set():
            return 0
        if not radio_ready():
            return 10
        launched=command([SYSTEMCTL, "--user", "start", "charge6-" + guest + ".service"], 15)
        if STOP.is_set():
            return 0
        if launched.returncode:
            return 11
        began = time.monotonic()
        ready = False
        while time.monotonic() - began < 120 and not STOP.is_set():
            try:
                ready = adb(guest, "shell", "-n", "getprop", "sys.boot_completed").stdout.strip() == "1"
            except (OSError, subprocess.TimeoutExpired):
                pass
            if ready:
                break
            STOP.wait(2)
        if STOP.is_set():
            return 0
        if not ready:
            return 11
        resolved = adb(guest, "shell", "-n", "cmd", "package", "resolve-activity", "--brief",
                       "-a", "android.intent.action.MAIN", "-c", "android.intent.category.LAUNCHER",
                       "-p", "com.fitbit.FitbitMobile").stdout
        if STOP.is_set():
            return 0
        component = next((line.strip() for line in reversed(resolved.splitlines())
                          if line.startswith("com.fitbit.FitbitMobile/") and " " not in line), None)
        if not component:
            return 12
        opened = adb(guest, "shell", "-n", "am", "start", "-a", "android.intent.action.MAIN",
                     "-c", "android.intent.category.LAUNCHER", "-n", component)
        if STOP.is_set():
            return 0
        if opened.returncode or "Error" in opened.stdout:
            return 12
        # The official app owns all Bluetooth pairing/sync. Native systemd owns this bounded wait.
        print(json.dumps({"event": "official_app_opened", "syncVerified": False}), flush=True)
        STOP.wait(max(0, SESSION_SECONDS - (time.monotonic() - began)))
        return 0

def shutdown_guest(guest):
    try:
        adb(guest, "shell", "-n", "reboot", "-p", timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        pass
    # Allow Android to flush app and bond state before systemd's normal stop backstop.
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        try:
            if adb(guest, "get-state", timeout=2).stdout.strip() != "device":
                return 0
        except (OSError, subprocess.TimeoutExpired):
            return 0
        time.sleep(1)
    return 0

def main():
    if len(sys.argv) != 3 or sys.argv[1] not in ("status", "start", "stop", "session", "shutdown") or sys.argv[2] not in GUESTS:
        raise Failure("fitbit_command_invalid")
    action, guest = sys.argv[1:]
    if action == "session":
        signal.signal(signal.SIGTERM, lambda *_: STOP.set())
        signal.signal(signal.SIGINT, lambda *_: STOP.set())
        return session(guest)
    if action == "shutdown":
        return shutdown_guest(guest)
    print(json.dumps(status(guest) if action == "status" else control(action, guest)))
    return 0

if __name__ == "__main__":
    try:
        sys.exit(main())
    except Failure as error:
        print(json.dumps({"version": 1, "ok": False, "error": {"code": error.code, "status": error.status, "outcome": error.outcome}}))
        sys.exit(1)
    except (OSError, subprocess.TimeoutExpired):
        print(json.dumps({"version": 1, "ok": False, "error": {"code": "fitbit_controller_unavailable", "status": 503}}))
        sys.exit(1)
