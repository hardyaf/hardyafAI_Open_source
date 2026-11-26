#!/usr/bin/env python3
"""Fixed, read-only host telemetry. Version 1 status describes collection, not health."""
import csv
import datetime
import io
import json
import math
import os
import pathlib
import re
import selectors
import signal
import socket
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.request

VERSION = 1
DEADLINE_SECONDS = 4.5
HARD_DEADLINE_SECONDS = 5.0
MAX_OUTPUT_BYTES = 32768
MAX_COMMAND_BYTES = 8192
MAX_HTTP_BYTES = 16384
MAX_ROWS = 16
NVIDIA = ("/usr/bin/nvidia-smi",
          "--query-gpu=index,name,memory.used,memory.total,memory.free,utilization.gpu,temperature.gpu,power.draw,power.limit",
          "--format=csv,noheader,nounits")
SYSTEMCTL = ("/usr/bin/systemctl", "show", "openclaw-gateway.service",
             "hardy-home-credentials.service", "--property=Id",
             "--property=ActiveState", "--property=LoadState", "--no-pager")
USERCTL = ("/usr/bin/systemctl", "--user", "show", "household-control.service",
           "--property=Id", "--property=ActiveState", "--property=LoadState", "--no-pager")
OLLAMA_PS = "http://127.0.0.1:11434/api/ps"
SERVICE_IDS = {"openclaw-gateway.service": "native_gateway",
               "hardy-home-credentials.service": "credential_ingress",
               "household-control.service": "household_control"}
SERVICE_STATES = {"active", "activating", "inactive", "failed", "unknown"}
ERROR_CODES = {"command_missing", "command_timeout", "command_output_limit",
               "command_failed", "invalid_response", "host_metric_unavailable",
               "owner_session_unavailable", "ollama_unavailable", "collection_deadline"}
NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9 ._:/@+()=-]{0,159}\Z")


class Unavailable(Exception):
    def __init__(self, code):
        self.code = code if code in ERROR_CODES else "invalid_response"


class CollectionDeadline(Exception):
    pass


def number(value, maximum, integer=False):
    if isinstance(value, bool):
        raise Unavailable("invalid_response")
    if isinstance(value, str):
        try:
            value = float(value.strip())
        except ValueError:
            raise Unavailable("invalid_response") from None
    if not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0 or value > maximum:
        raise Unavailable("invalid_response")
    if integer:
        if value != int(value):
            raise Unavailable("invalid_response")
        return int(value)
    return round(float(value), 3)


def label(value):
    if not isinstance(value, str) or not NAME.fullmatch(value):
        raise Unavailable("invalid_response")
    return value


def remaining(deadline, maximum):
    value = min(maximum, deadline - time.monotonic())
    if value <= 0:
        raise Unavailable("collection_deadline")
    return value


def run_fixed(args, deadline, *, limit=MAX_COMMAND_BYTES, timeout=1.0, user=False):
    if args not in (NVIDIA, SYSTEMCTL, USERCTL) or user != (args == USERCTL):
        raise Unavailable("invalid_response")
    env = {"PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C"}
    if user:
        env["XDG_RUNTIME_DIR"] = "/run/user/" + str(os.getuid())
    end = time.monotonic() + remaining(deadline, timeout)
    try:
        process = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                   stderr=subprocess.DEVNULL, env=env, cwd="/",
                                   shell=False, close_fds=True, start_new_session=True)
    except FileNotFoundError:
        raise Unavailable("command_missing") from None
    except OSError:
        raise Unavailable("command_failed") from None
    output = bytearray()
    selector = selectors.DefaultSelector()
    try:
        selector.register(process.stdout, selectors.EVENT_READ)
        while selector.get_map():
            wait = end - time.monotonic()
            if wait <= 0:
                raise Unavailable("command_timeout")
            for key, _ in selector.select(wait):
                chunk = os.read(key.fd, min(4096, limit + 1 - len(output)))
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                output.extend(chunk)
                if len(output) > limit:
                    raise Unavailable("command_output_limit")
        try:
            code = process.wait(timeout=max(0.001, end - time.monotonic()))
        except subprocess.TimeoutExpired:
            raise Unavailable("command_timeout") from None
        if code != 0:
            raise Unavailable("command_failed")
        try:
            return output.decode("utf-8", errors="strict")
        except UnicodeDecodeError:
            raise Unavailable("invalid_response") from None
    finally:
        # The session/process group is ours even if its leader has already exited.
        # Descendants may still hold stdout, so leader.poll() must not skip cleanup.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        finally:
            selector.close()
            process.stdout.close()
            if process.poll() is None:
                try:
                    process.wait(timeout=0.1)
                except subprocess.TimeoutExpired:
                    pass


def parse_gpus(text):
    rows = list(csv.reader(io.StringIO(text)))
    if len(rows) > MAX_ROWS:
        raise Unavailable("invalid_response")
    devices = []
    indexes = set()
    for row in rows:
        if len(row) != 9:
            raise Unavailable("invalid_response")
        index = number(row[0], 65535, integer=True)
        if index in indexes:
            raise Unavailable("invalid_response")
        indexes.add(index)
        used, total, free = [number(x, 1048576) for x in row[2:5]]
        if total <= 0 or used > total or free > total:
            raise Unavailable("invalid_response")

        def optional(raw, maximum):
            return None if raw.strip().lower() in {"n/a", "[n/a]", "not supported"} else number(raw, maximum)

        devices.append({"index": index, "name": label(row[1].strip()),
                        "memoryUsedMiB": used, "memoryTotalMiB": total, "memoryFreeMiB": free,
                        "utilizationPercent": optional(row[5], 100),
                        "temperatureC": optional(row[6], 200),
                        "powerDrawW": optional(row[7], 100000),
                        "powerLimitW": optional(row[8], 100000)})
    return {"status": "ok", "devices": devices}


def cpu():
    count = number(os.cpu_count(), 65536, integer=True)
    if count <= 0:
        raise Unavailable("host_metric_unavailable")
    loads = os.getloadavg()
    if len(loads) != 3:
        raise Unavailable("host_metric_unavailable")
    return {"status": "ok", "logicalCores": count,
            **dict(zip(("load1", "load5", "load15"), [number(v, 10000000) for v in loads]))}


def ram():
    with pathlib.Path("/proc/meminfo").open("rb") as source:
        text = source.read(16385)
    if len(text) > 16384:
        raise Unavailable("host_metric_unavailable")
    values = {}
    for line in text.decode("ascii").splitlines():
        key = line.split(":", 1)[0]
        if key in ("MemTotal", "MemAvailable"):
            match = re.fullmatch(r"(\w+):\s+(\d+)\s+kB", line)
            if not match or key in values:
                raise Unavailable("host_metric_unavailable")
            values[key] = number(int(match[2]) / 1024, 1000000000000)
    total, available = values.get("MemTotal"), values.get("MemAvailable")
    if total is None or available is None or total <= 0 or available > total:
        raise Unavailable("host_metric_unavailable")
    return {"status": "ok", "totalMiB": total, "availableMiB": available,
            "usedMiB": round(total - available, 3)}


def disk():
    value = os.statvfs("/")
    block = value.f_frsize or value.f_bsize
    if block <= 0 or not 0 <= value.f_bavail <= value.f_bfree <= value.f_blocks:
        raise Unavailable("host_metric_unavailable")
    gib = 1024 ** 3
    return {"status": "ok", "path": "/",
            "totalGiB": number(value.f_blocks * block / gib, 1000000000000),
            "availableGiB": number(value.f_bavail * block / gib, 1000000000000),
            "usedGiB": number((value.f_blocks - value.f_bfree) * block / gib, 1000000000000)}


def parse_services(text, units):
    found = {}
    for block in text.strip().split("\n\n"):
        fields = {}
        for line in block.splitlines():
            if "=" not in line:
                raise Unavailable("invalid_response")
            key, value = line.split("=", 1)
            if key not in ("Id", "ActiveState", "LoadState") or key in fields:
                raise Unavailable("invalid_response")
            fields[key] = value
        unit = fields.get("Id")
        if unit not in units or unit in found or "ActiveState" not in fields or "LoadState" not in fields:
            raise Unavailable("invalid_response")
        if fields["LoadState"] != "loaded":
            found[unit] = service_unavailable((unit,), "host_metric_unavailable")[0]
            continue
        state = fields["ActiveState"]
        found[unit] = {"id": SERVICE_IDS[unit], "scope": "user" if unit == "household-control.service" else "system",
                       "status": state if state in SERVICE_STATES else "unknown"}
    if set(found) != set(units):
        raise Unavailable("invalid_response")
    return [found[u] for u in units]


def service_unavailable(units, code):
    return [{"id": SERVICE_IDS[u], "scope": "user" if u == "household-control.service" else "system",
             "status": "unavailable", "errorCode": code} for u in units]


def services(deadline):
    units = ("openclaw-gateway.service", "hardy-home-credentials.service")
    try:
        result = parse_services(run_fixed(SYSTEMCTL, deadline, timeout=0.7), units)
    except Unavailable as error:
        result = service_unavailable(units, error.code)
    except CollectionDeadline:
        result = service_unavailable(units, "collection_deadline")
    except Exception:
        result = service_unavailable(units, "invalid_response")
    owner = ("household-control.service",)
    try:
        runtime_bus = pathlib.Path("/run/user") / str(os.getuid()) / "bus"
        info = runtime_bus.stat()
        if info.st_uid != os.getuid() or not stat.S_ISSOCK(info.st_mode):
            raise Unavailable("owner_session_unavailable")
        result.extend(parse_services(run_fixed(USERCTL, deadline, timeout=0.5, user=True), owner))
    except (FileNotFoundError, PermissionError):
        result.extend(service_unavailable(owner, "owner_session_unavailable"))
    except Unavailable as error:
        result.extend(service_unavailable(owner, error.code))
    except CollectionDeadline:
        result.extend(service_unavailable(owner, "collection_deadline"))
    except Exception:
        result.extend(service_unavailable(owner, "invalid_response"))
    return result


def parse_models(value):
    # Ollama size is resident allocation including cache, not the GGUF file size.
    if not isinstance(value, dict) or not isinstance(value.get("models"), list) or len(value["models"]) > MAX_ROWS:
        raise Unavailable("invalid_response")
    rows = []
    for model in value["models"]:
        if not isinstance(model, dict):
            raise Unavailable("invalid_response")
        size = number(model.get("size"), 2 ** 60, integer=True)
        vram = number(model.get("size_vram"), 2 ** 60, integer=True)
        if vram > size:
            raise Unavailable("invalid_response")
        context = model.get("context_length")
        rows.append({"name": label(model.get("name")),
                     "contextTokens": None if context is None else number(context, 2 ** 31, integer=True),
                     "modelSizeBytes": size, "modelVramBytes": vram})
    return {"status": "ok", "items": rows}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        return None


def models(deadline):
    timeout = remaining(deadline, 0.8)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    request = urllib.request.Request(OLLAMA_PS, headers={"Accept": "application/json"}, method="GET")
    try:
        with opener.open(request, timeout=timeout) as response:
            if response.status != 200:
                raise Unavailable("ollama_unavailable")
            raw = response.read(MAX_HTTP_BYTES + 1)
            if len(raw) > MAX_HTTP_BYTES:
                raise Unavailable("invalid_response")
        value = json.loads(raw.decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, socket.timeout, OSError):
        raise Unavailable("ollama_unavailable") from None
    except (ValueError, UnicodeError):
        raise Unavailable("invalid_response") from None
    return parse_models(value)


def section(callback, deadline):
    try:
        remaining(deadline, DEADLINE_SECONDS)
        return callback()
    except Unavailable as error:
        return {"status": "unavailable", "errorCode": error.code}
    except CollectionDeadline:
        return {"status": "unavailable", "errorCode": "collection_deadline"}
    except Exception:
        return {"status": "unavailable", "errorCode": "host_metric_unavailable"}


def collect():
    started = time.monotonic()
    deadline = started + DEADLINE_SECONDS
    observed = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    value = {"version": VERSION, "observedAt": observed,
             "gpus": section(lambda: parse_gpus(run_fixed(NVIDIA, deadline, timeout=1.5)), deadline),
             "cpu": section(cpu, deadline), "ram": section(ram, deadline), "disk": section(disk, deadline),
             "services": services(deadline),
             "models": section(lambda: models(deadline), deadline)}
    measured = [value[k]["status"] == "ok" for k in ("gpus", "cpu", "ram", "disk", "models")]
    measured.extend(row["status"] != "unavailable" for row in value["services"])
    value["status"] = "ok" if all(measured) else "partial" if any(measured) else "unavailable"
    value["durationMs"] = round(max(0, (time.monotonic() - started) * 1000), 3)
    return value


def unavailable_report(code):
    return {"version": VERSION,
            "observedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "durationMs": HARD_DEADLINE_SECONDS * 1000, "status": "unavailable",
            **{key: {"status": "unavailable", "errorCode": code}
               for key in ("gpus", "cpu", "ram", "disk", "models")},
            "services": service_unavailable(tuple(SERVICE_IDS), code)}


def hard_deadline(signum, frame):
    raise CollectionDeadline()


def main(argv=None):
    if (sys.argv[1:] if argv is None else argv):
        sys.stderr.write("arguments_not_supported\n")
        return 2
    previous = signal.signal(signal.SIGALRM, hard_deadline)
    signal.setitimer(signal.ITIMER_REAL, HARD_DEADLINE_SECONDS)
    try:
        result = collect()
    except CollectionDeadline:
        result = unavailable_report("collection_deadline")
    except Exception:
        result = unavailable_report("host_metric_unavailable")
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)
    raw = json.dumps(result, separators=(",", ":"), allow_nan=False).encode("utf-8")
    if len(raw) > MAX_OUTPUT_BYTES:
        sys.stderr.write("collection_output_limit\n")
        return 1
    sys.stdout.write(raw.decode("utf-8") + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
