import importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory
import fcntl
import unittest
from unittest.mock import patch
spec = importlib.util.spec_from_file_location("fitbit_control", Path(__file__).resolve().parents[1] / "fitbit-control.py")
control = importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)

class FitbitLifecycleTests(unittest.TestCase):
    def test_another_guest_is_busy_and_is_never_stopped(self):
        def properties(name, user=True):
            if not user:
                return {"ActiveState": "active"}
            return {"LoadState": "loaded", "ActiveState": "active" if name == control.unit("guest2") else "inactive"}
        with patch.object(control, "properties", side_effect=properties), patch.object(control, "command") as command:
            with self.assertRaises(control.Failure) as raised:
                control.control("start", "guest1")
            self.assertEqual(raised.exception.code, "fitbit_radio_busy")
            self.assertEqual(raised.exception.status, 409)
            command.assert_not_called()

    def test_real_kernel_lock_blocks_a_second_session_before_boot(self):
        with TemporaryDirectory(prefix="fitbit-lock-") as directory:
            root = Path(directory)
            (root / "run").mkdir()
            with open(root / "run/sync-session.lock", "a") as first:
                fcntl.flock(first, fcntl.LOCK_EX | fcntl.LOCK_NB)
                with patch.object(control, "BASE", root), patch.object(control, "command") as command:
                    self.assertEqual(control.session("guest2"), 13)
                    command.assert_not_called()

    def test_start_of_an_already_active_unit_is_not_a_restart(self):
        def properties(name, user=True):
            return {"LoadState": "loaded", "ActiveState": "active" if name == control.unit("guest1") or not user else "inactive"}
        from subprocess import CompletedProcess
        with patch.object(control, "properties", side_effect=properties), patch.object(control, "status", return_value={"phase": "running"}), patch.object(control, "command", return_value=CompletedProcess([],0,"","")) as command:
            control.control("start","guest1")
            self.assertEqual(command.call_args.args[0], [control.SYSTEMCTL,"--user","start","--no-block",control.unit("guest1")])

    def test_cancel_during_guest_start_is_clean_and_does_not_open_the_app(self):
        from subprocess import CompletedProcess
        with TemporaryDirectory(prefix="fitbit-cancel-") as directory:
            root=Path(directory)
            def starting(*args,**kwargs):
                control.STOP.set()
                return CompletedProcess([], -15, "", "")
            try:
                with patch.object(control,"BASE",root),patch.object(control,"radio_ready",return_value=True),patch.object(control,"command",side_effect=starting),patch.object(control,"adb") as adb:
                    self.assertEqual(control.session("guest1"),0)
                    adb.assert_not_called()
            finally:
                control.STOP.clear()

    def test_timestamp_is_utc_and_invalid_values_are_not_invented(self):
        self.assertEqual(control.date("Mon 2026-11-16 23:00:00 UTC").isoformat(),"2026-11-16T23:00:00+00:00")
        self.assertIsNone(control.date("n/a"))

if __name__ == "__main__":
    unittest.main()
