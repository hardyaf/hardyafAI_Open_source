"""Provider-free checks for the fixed read-only system status collector."""
import contextlib
import importlib.util
import io
import json
import os
import pathlib
import signal
import stat
import sys
import types
import unittest
from unittest import mock

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location(
    "system_status", pathlib.Path(__file__).resolve().parents[1] / "read-system-status.py")
STATUS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(STATUS)


class CollectorTests(unittest.TestCase):
    def setUp(self):
        self.kill_group = mock.patch.object(STATUS.os, "killpg", side_effect=ProcessLookupError).start()
        self.addCleanup(mock.patch.stopall)

    def expect_code(self, code, callback):
        with self.assertRaises(STATUS.Unavailable) as error:
            callback()
        self.assertEqual(error.exception.code, code)

    def test_gpu_units_and_optional_unavailable_are_distinct(self):
        value = STATUS.parse_gpus(
            "0, NVIDIA GeForce RTX 3090, 8000, 24576, 16576, 22, 51, 185.4, 350\n"
            "1, NVIDIA GeForce RTX 3090, 9000, 24576, 15576, N/A, [N/A], Not Supported, 350\n")
        self.assertEqual(value["devices"][0]["memoryUsedMiB"], 8000)
        self.assertEqual(value["devices"][1]["memoryFreeMiB"], 15576)
        self.assertIsNone(value["devices"][1]["temperatureC"])
        self.assertIsNone(value["devices"][1]["powerDrawW"])
        self.assertIsNone(value["devices"][1]["utilizationPercent"])

    def test_gpu_malformed_nonfinite_out_of_range_and_duplicate_refused(self):
        good = "0,GPU,1,24,23,0,50,80,100"
        for bad in ["0,GPU,1", good.replace(",1,24,", ",NaN,24,"),
                    good.replace(",1,24,", ",25,24,"), good.replace(",0,50,", ",101,50,"),
                    good + "\n" + good, good.replace("GPU", "bad\nname")]:
            with self.subTest(bad=bad):
                self.expect_code("invalid_response", lambda: STATUS.parse_gpus(bad))

    def test_gpu_row_and_label_bounds(self):
        row = "0,GPU,1,24,23,0,50,80,100"
        self.expect_code("invalid_response", lambda: STATUS.parse_gpus("\n".join([row] * 17)))
        self.expect_code("invalid_response", lambda: STATUS.parse_gpus(row.replace("GPU", "A" * 161)))

    def test_numeric_types_are_not_coerced_from_bool(self):
        for value in [True, False, float("inf"), float("nan"), -1, "inf"]:
            self.expect_code("invalid_response", lambda: STATUS.number(value, 100))
        self.expect_code("invalid_response", lambda: STATUS.number(1.5, 100, integer=True))

    def test_cpu_loads_and_core_count(self):
        with mock.patch.object(STATUS.os, "cpu_count", return_value=12), mock.patch.object(
                STATUS.os, "getloadavg", return_value=(1.25, 2, 3)):
            self.assertEqual(STATUS.cpu(), {"status": "ok", "logicalCores": 12,
                                           "load1": 1.25, "load5": 2.0, "load15": 3.0})

    def test_ram_only_reads_fixed_bounded_meminfo(self):
        handle = io.BytesIO(b"MemTotal: 8192 kB\nMemAvailable: 3072 kB\nSecret: ignored\n")
        with mock.patch.object(STATUS.pathlib.Path, "open", return_value=handle) as opened:
            self.assertEqual(STATUS.ram(), {"status": "ok", "totalMiB": 8.0,
                                           "availableMiB": 3.0, "usedMiB": 5.0})
        self.assertEqual(opened.call_args.args, ("rb",))

    def test_ram_inconsistent_or_oversized_refused(self):
        for text in [b"MemTotal: 10 kB\nMemAvailable: 11 kB\n",
                     b"MemTotal: 10 kB\n", b"x" * 16385]:
            with mock.patch.object(STATUS.pathlib.Path, "open", return_value=io.BytesIO(text)):
                self.expect_code("host_metric_unavailable", STATUS.ram)

    def test_disk_only_root_and_reserved_space_not_labeled_used(self):
        value = types.SimpleNamespace(f_frsize=1024**3, f_bsize=4096,
                                      f_blocks=100, f_bfree=25, f_bavail=20)
        with mock.patch.object(STATUS.os, "statvfs", return_value=value) as read:
            self.assertEqual(STATUS.disk(), {"status": "ok", "path": "/", "totalGiB": 100,
                                            "availableGiB": 20, "usedGiB": 75})
        read.assert_called_once_with("/")

    def test_services_fixed_ids_and_no_raw_status_text(self):
        output = ("Id=openclaw-gateway.service\nActiveState=active\nLoadState=loaded\n\n"
                  "Id=hardy-home-credentials.service\nActiveState=activating\nLoadState=loaded\n")
        value = STATUS.parse_services(output, ("openclaw-gateway.service", "hardy-home-credentials.service"))
        self.assertEqual(value, [{"id": "native_gateway", "scope": "system", "status": "active"},
                                 {"id": "credential_ingress", "scope": "system", "status": "activating"}])
        value = STATUS.parse_services("Id=household-control.service\nActiveState=deactivating\nLoadState=loaded",
                                      ("household-control.service",))
        self.assertEqual(value[0]["status"], "unknown")

    def test_service_extra_fields_unknown_unit_and_duplicates_refused(self):
        good = "Id=household-control.service\nActiveState=active\nLoadState=loaded"
        for text in [good + "\nEnvironment=do-not-return",
                     good.replace("household-control", "other"), good + "\n\n" + good]:
            self.expect_code("invalid_response", lambda: STATUS.parse_services(text, ("household-control.service",)))

    def test_owner_bus_absent_does_not_query_other_user(self):
        with mock.patch.object(STATUS, "run_fixed", return_value=
                               "Id=openclaw-gateway.service\nActiveState=active\nLoadState=loaded\n\n"
                               "Id=hardy-home-credentials.service\nActiveState=failed\nLoadState=loaded"), \
                mock.patch.object(STATUS.pathlib.Path, "stat", side_effect=FileNotFoundError):
            rows = STATUS.services(100)
        self.assertEqual(len(rows), 3)
        self.assertEqual(rows[2], {"id": "household_control", "scope": "user",
                                  "status": "unavailable", "errorCode": "owner_session_unavailable"})
        self.assertEqual(rows[1]["status"], "failed")

    def test_not_loaded_unit_is_unavailable_instead_of_inactive(self):
        for state in ("not-found", "unloaded", "masked", "error"):
            rows = STATUS.parse_services(
                "Id=household-control.service\nActiveState=inactive\nLoadState=" + state,
                ("household-control.service",))
            self.assertEqual(rows, [{"id": "household_control", "scope": "user",
                                     "status": "unavailable", "errorCode": "host_metric_unavailable"}])

    def test_models_projection_keeps_context_and_vram_separate(self):
        value = STATUS.parse_models({"models": [{"name": "example:27b", "size": 2000,
            "size_vram": 1500, "context_length": 131072, "digest": "do-not-return",
            "details": {"private": "do-not-return"}}]})
        self.assertEqual(value, {"status": "ok", "items": [{"name": "example:27b",
            "contextTokens": 131072, "modelSizeBytes": 2000, "modelVramBytes": 1500}]})
        self.assertNotIn("do-not-return", json.dumps(value))

    def test_models_missing_context_is_null_not_inferred(self):
        self.assertIsNone(STATUS.parse_models({"models": [{"name": "model", "size": 3, "size_vram": 2}]})
                          ["items"][0]["contextTokens"])
        self.assertEqual(STATUS.parse_models({"models": []}), {"status": "ok", "items": []})

    def test_models_invalid_types_names_rows_and_size_refused(self):
        model = {"name": "model", "size": 3, "size_vram": 2, "context_length": 100}
        for bad in [{**model, "context_length": True}, {**model, "size_vram": 4},
                    {**model, "name": "name\ninjected"}, {**model, "size": -1}]:
            self.expect_code("invalid_response", lambda: STATUS.parse_models({"models": [bad]}))
        self.expect_code("invalid_response", lambda: STATUS.parse_models({"models": [model] * 17}))

    def test_http_has_no_proxy_redirect_or_inference(self):
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.status = 200
        response.read.return_value = b'{"models":[]}'
        opener = mock.Mock()
        opener.open.return_value = response
        with mock.patch.object(STATUS.urllib.request, "build_opener", return_value=opener) as build:
            self.assertEqual(STATUS.models(STATUS.time.monotonic() + 1), {"status": "ok", "items": []})
        handlers = build.call_args.args
        self.assertEqual(handlers[0].proxies, {})
        self.assertIsInstance(handlers[1], STATUS.NoRedirect)
        self.assertIsNone(handlers[1].redirect_request(None, None, 302, "", {}, "http://example.invalid"))
        request = opener.open.call_args.args[0]
        self.assertEqual(request.full_url, "http://127.0.0.1:11434/api/ps")
        self.assertEqual(request.get_method(), "GET")
        self.assertIsNone(request.data)
        response.read.assert_called_once_with(STATUS.MAX_HTTP_BYTES + 1)

    def test_http_oversized_malformed_and_network_errors_are_fixed(self):
        for raw in [b"x" * (STATUS.MAX_HTTP_BYTES + 1), b'{"models":NaN}', b"not-json"]:
            response = mock.MagicMock()
            response.__enter__.return_value = response
            response.status = 200
            response.read.return_value = raw
            opener = mock.Mock()
            opener.open.return_value = response
            with mock.patch.object(STATUS.urllib.request, "build_opener", return_value=opener):
                self.expect_code("invalid_response", lambda: STATUS.models(STATUS.time.monotonic() + 1))
        opener = mock.Mock()
        opener.open.side_effect = OSError("SECRET transport failure")
        with mock.patch.object(STATUS.urllib.request, "build_opener", return_value=opener):
            self.expect_code("ollama_unavailable", lambda: STATUS.models(STATUS.time.monotonic() + 1))

    def pipe_process(self, output, code=0):
        read_fd, write_fd = os.pipe()
        os.write(write_fd, output)
        os.close(write_fd)
        process = mock.Mock()
        process.stdout = os.fdopen(read_fd, "rb", buffering=0)
        process.pid = 123456
        process.wait.return_value = code
        process.poll.return_value = code
        return process

    def test_subprocess_environment_and_bounded_capture(self):
        process = self.pipe_process(b"safe")
        with mock.patch.dict(os.environ, {"TOKEN": "not-inherited", "HOME": "/secret"}), \
                mock.patch.object(STATUS.subprocess, "Popen", return_value=process) as popen:
            self.assertEqual(STATUS.run_fixed(STATUS.NVIDIA, STATUS.time.monotonic() + 1), "safe")
        options = popen.call_args.kwargs
        self.assertEqual(options["env"], {"PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C"})
        self.assertFalse(options["shell"])
        self.assertEqual(options["stderr"], STATUS.subprocess.DEVNULL)
        self.assertTrue(options["start_new_session"])
        process = self.pipe_process(b"x" * 65)
        with mock.patch.object(STATUS.subprocess, "Popen", return_value=process):
            self.expect_code("command_output_limit", lambda:
                             STATUS.run_fixed(STATUS.NVIDIA, STATUS.time.monotonic() + 1, limit=64))

    def test_arbitrary_subprocess_arguments_never_run(self):
        with mock.patch.object(STATUS.subprocess, "Popen") as popen:
            self.expect_code("invalid_response", lambda:
                             STATUS.run_fixed(("/bin/sh", "-c", "echo private"), 100))
        popen.assert_not_called()

    def test_subprocess_missing_nonzero_and_timeout_fixed(self):
        with mock.patch.object(STATUS.subprocess, "Popen", side_effect=FileNotFoundError):
            self.expect_code("command_missing", lambda:
                             STATUS.run_fixed(STATUS.NVIDIA, STATUS.time.monotonic() + 1))
        process = self.pipe_process(b"discarded failure", code=1)
        with mock.patch.object(STATUS.subprocess, "Popen", return_value=process):
            self.expect_code("command_failed", lambda:
                             STATUS.run_fixed(STATUS.NVIDIA, STATUS.time.monotonic() + 1))
        process = self.pipe_process(b"")
        process.poll.return_value = None
        process.pid = 123456
        with mock.patch.object(STATUS.subprocess, "Popen", return_value=process), \
                mock.patch.object(STATUS.time, "monotonic", side_effect=[0, 0, 2]), \
                mock.patch.object(STATUS.os, "killpg") as kill:
            self.expect_code("command_timeout", lambda: STATUS.run_fixed(STATUS.NVIDIA, 10))
        kill.assert_called_once_with(123456, signal.SIGKILL)

    def test_timeout_cleans_group_even_after_leader_exited(self):
        process = self.pipe_process(b"")
        process.poll.return_value = 0
        with (mock.patch.object(STATUS.subprocess, "Popen", return_value=process),
              mock.patch.object(STATUS.time, "monotonic", side_effect=[0, 0, 2])):
            self.expect_code("command_timeout", lambda: STATUS.run_fixed(STATUS.NVIDIA, 10))
        self.kill_group.assert_called_once_with(123456, signal.SIGKILL)

    def test_all_sections_and_exact_three_services_when_unavailable(self):
        with mock.patch.object(STATUS, "section", return_value={"status": "unavailable",
                                                              "errorCode": "collection_deadline"}), \
                mock.patch.object(STATUS, "services", return_value=STATUS.service_unavailable(
                    tuple(STATUS.SERVICE_IDS), "collection_deadline")):
            value = STATUS.collect()
        self.assertEqual(value["status"], "unavailable")
        self.assertEqual(len(value["services"]), 3)
        self.assertTrue(value["observedAt"].endswith("Z"))
        self.assertGreaterEqual(value["durationMs"], 0)
        self.assertEqual(set(value), {"version", "observedAt", "durationMs", "status",
                                     "gpus", "cpu", "ram", "disk", "services", "models"})

    def test_deadline_and_unexpected_exception_do_not_leak_messages(self):
        self.assertEqual(STATUS.section(lambda: (_ for _ in ()).throw(RuntimeError("SECRET")),
                                        STATUS.time.monotonic() + 1),
                         {"status": "unavailable", "errorCode": "host_metric_unavailable"})
        self.assertEqual(STATUS.section(lambda: None, STATUS.time.monotonic() - 1),
                         {"status": "unavailable", "errorCode": "collection_deadline"})

    def test_cli_rejects_all_arguments_without_echo(self):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            self.assertEqual(STATUS.main(["secret-user-argument"]), 2)
        self.assertEqual(out.getvalue(), "")
        self.assertEqual(err.getvalue(), "arguments_not_supported\n")

    def test_cli_deadline_returns_complete_fixed_unavailable_report(self):
        out = io.StringIO()
        with mock.patch.object(STATUS, "collect", side_effect=STATUS.CollectionDeadline), \
                mock.patch.object(STATUS.signal, "signal"), mock.patch.object(STATUS.signal, "setitimer"), \
                contextlib.redirect_stdout(out):
            self.assertEqual(STATUS.main([]), 0)
        value = json.loads(out.getvalue())
        self.assertEqual(value["status"], "unavailable")
        self.assertEqual(len(value["services"]), 3)
        self.assertEqual(value["models"]["errorCode"], "collection_deadline")
        self.assertLess(len(out.getvalue().encode()), STATUS.MAX_OUTPUT_BYTES)


if __name__ == "__main__":
    unittest.main()
