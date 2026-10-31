import dataclasses
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import requests

from monitor import (
    DailyRestartState,
    L03ERestartState,
    check_l03e_once,
    load_daily_restart_state,
    load_l03e_restart_config,
    save_daily_restart_state,
)
from test_l03e_restart import FakeResponse, FakeSession, make_config


# 05:00 JST, expressed in UTC to exercise timezone independence.
DUE = datetime(2026, 10, 31, 20, 0, tzinfo=timezone.utc)


class DailyRestartTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "nested/l03e-restart.json"
        self.config = dataclasses.replace(make_config(), daily_restart_enabled=True)
        self.state = L03ERestartState(daily=load_daily_restart_state(self.path))

    def run_check(self, session, now=DUE, monotonic=100.0, state=None, config=None):
        return check_l03e_once(
            session, config or self.config, state or self.state, monotonic, now,
        )

    def accepted_session(self):
        return FakeSession(
            [FakeResponse(), FakeResponse()],
            [FakeResponse(), FakeResponse()],
        )

    def healthy_session(self):
        return FakeSession([FakeResponse(), FakeResponse()])

    def test_runs_while_wan_healthy_and_reserves_before_any_http(self):
        session = self.accepted_session()
        original_get = session.get

        def checked_get(url, **kwargs):
            saved = load_daily_restart_state(self.path)
            self.assertEqual(saved.last_handled_date, "2026-11-01")
            self.assertEqual(saved.last_attempt_at, DUE)
            return original_get(url, **kwargs)

        session.get = checked_get
        self.assertTrue(self.run_check(session))
        self.assertEqual(len(session.calls), 4)
        self.assertFalse(any(url == "http://1.1.1.1/" for _, url, _ in session.calls))

    def test_window_boundaries(self):
        for seconds, expected in [(-1, False), (0, True), (1799, True), (1800, False)]:
            with self.subTest(seconds=seconds):
                state = L03ERestartState(daily=DailyRestartState(path=self.path))
                session = self.accepted_session() if expected else self.healthy_session()
                self.assertEqual(self.run_check(session, DUE + timedelta(seconds=seconds), state=state), expected)
                if not expected:
                    self.assertEqual(state.daily.last_handled_date, None)

    def test_equivalent_local_timezone_and_midnight_window(self):
        local_due = DUE.astimezone(timezone(timedelta(hours=-7)))
        self.assertTrue(self.run_check(self.accepted_session(), local_due))
        config = dataclasses.replace(self.config, daily_restart_time_jst="23:50")
        now = datetime(2026, 11, 2, 15, 10, tzinfo=timezone.utc)  # Nov 3 00:10 JST
        self.assertTrue(self.run_check(self.accepted_session(), now, 90000, config=config))
        self.assertEqual(self.state.daily.last_handled_date, "2026-11-02")

    def test_once_per_day_across_service_restart_and_next_day(self):
        self.assertTrue(self.run_check(self.accepted_session()))
        for state in [self.state, L03ERestartState(daily=load_daily_restart_state(self.path))]:
            session = self.healthy_session()
            self.assertFalse(self.run_check(session, DUE + timedelta(minutes=5), state=state))
            self.assertEqual(len(session.calls), 2)
        self.assertTrue(self.run_check(self.accepted_session(), DUE + timedelta(days=1), 86500))

    def test_clock_rollback_does_not_repeat_prior_dates(self):
        self.run_check(self.accepted_session())
        state = L03ERestartState(daily=load_daily_restart_state(self.path))
        session = self.healthy_session()
        self.assertFalse(self.run_check(session, DUE - timedelta(days=1), state=state))
        self.assertEqual(len(session.calls), 2)

    def test_failures_consume_the_day_without_retries(self):
        failures = [
            FakeSession([requests.ConnectionError("unreachable")]),
            FakeSession([FakeResponse()], [FakeResponse(403)]),
            FakeSession([FakeResponse()], [requests.Timeout("ambiguous")]),
            FakeSession([FakeResponse(), FakeResponse()], [FakeResponse(), requests.Timeout("ambiguous")]),
        ]
        for session in failures:
            with self.subTest(session=session):
                state = L03ERestartState(daily=DailyRestartState(path=self.path))
                self.assertFalse(self.run_check(session, state=state))
                reloaded = L03ERestartState(daily=load_daily_restart_state(self.path))
                later = self.healthy_session()
                self.assertFalse(self.run_check(later, DUE + timedelta(minutes=5), state=reloaded))
                self.assertEqual(len(later.calls), 2)

    def test_recent_emergency_restart_skips_daily_and_consumes_day(self):
        self.state.last_restart_monotonic = 50
        session = FakeSession([])
        self.assertFalse(self.run_check(session))
        self.assertEqual(session.calls, [])
        self.assertEqual(load_daily_restart_state(self.path).last_handled_date, "2026-11-01")
        self.assertIsNone(self.state.daily.last_attempt_at)

    def test_daily_failure_suppresses_emergency_after_service_restart(self):
        self.run_check(FakeSession([requests.ConnectionError("down")]))
        for seconds, expected in [(1799, False), (1800, True)]:
            with self.subTest(seconds=seconds):
                state = L03ERestartState(
                    consecutive_wan_failures=2,
                    daily=load_daily_restart_state(self.path),
                )
                session = FakeSession(
                    [FakeResponse(), requests.ConnectionError("WAN down"), FakeResponse()],
                    [FakeResponse(), FakeResponse()],
                )
                self.assertEqual(self.run_check(session, DUE + timedelta(seconds=seconds), 10, state=state), expected)
                self.assertEqual(len(session.calls), 5 if expected else 2)

    def test_disabled_config_still_honors_persisted_cooldown(self):
        self.run_check(FakeSession([requests.ConnectionError("down")]))
        state = L03ERestartState(consecutive_wan_failures=2, daily=load_daily_restart_state(self.path))
        session = FakeSession([FakeResponse(), requests.ConnectionError("WAN down")])
        config = dataclasses.replace(self.config, daily_restart_enabled=False)
        self.assertFalse(self.run_check(session, DUE + timedelta(minutes=1), state=state, config=config))
        self.assertEqual(len(session.calls), 2)

    def test_state_failure_disables_daily_but_preserves_emergency_restart(self):
        with patch("monitor.os.replace", side_effect=OSError("disk error")):
            session = self.healthy_session()
            self.assertFalse(self.run_check(session))
            self.assertEqual(len(session.calls), 2)
            self.assertIsNone(self.state.daily.last_attempt_at)
            self.assertTrue(self.state.daily.disabled)
        # Even if storage becomes writable, this process stays fail-closed for
        # daily scheduling while continuing the ordinary health checks.
        session = self.healthy_session()
        self.assertFalse(self.run_check(session))
        self.assertEqual(len(session.calls), 2)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text("invalid json")
        self.state = L03ERestartState(consecutive_wan_failures=2, daily=load_daily_restart_state(self.path))
        session = FakeSession(
            [FakeResponse(), requests.ConnectionError("WAN down"), FakeResponse()],
            [FakeResponse(), FakeResponse()],
        )
        self.assertTrue(self.run_check(session))

    def test_no_retry_logs_credentials(self):
        secret = "credential-must-not-be-logged"
        session = FakeSession([FakeResponse()], [requests.Timeout(secret)])
        with self.assertLogs("pi-monitor", level="INFO") as logs:
            self.run_check(session)
        self.assertNotIn(secret, "\n".join(logs.output))


class DailyRestartStorageTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "l03e-restart.json"

    def test_repeated_atomic_saves_do_not_accumulate_files(self):
        state = DailyRestartState(path=self.path, last_handled_date="2026-11-01", last_attempt_at=DUE)
        for day in range(1, 20):
            state.last_handled_date = f"2026-11-{day:02}"
            self.assertTrue(save_daily_restart_state(state))
            self.assertEqual(list(self.path.parent.iterdir()), [self.path])
            self.assertEqual(load_daily_restart_state(self.path).last_handled_date, state.last_handled_date)

    def test_stale_tmp_is_deleted_without_replacing_committed_state(self):
        state = DailyRestartState(path=self.path, last_handled_date="2026-11-01", last_attempt_at=DUE)
        self.assertTrue(save_daily_restart_state(state))
        temporary = self.path.with_suffix(".json.tmp")
        temporary.write_text("partial write")
        loaded = load_daily_restart_state(self.path)
        self.assertFalse(temporary.exists())
        self.assertEqual(loaded.last_attempt_at, DUE)
        self.path.unlink()
        temporary.write_text("partial first write")
        self.assertIsNone(load_daily_restart_state(self.path).last_handled_date)
        self.assertFalse(temporary.exists())

    def test_corrupt_and_invalid_state_disable_daily(self):
        invalid = [
            "invalid json", "[]", "{}",
            json.dumps({"lastHandledDateJst": "not-a-date", "lastAttemptAtUtc": None}),
            json.dumps({"lastHandledDateJst": "2026-11-01", "lastAttemptAtUtc": "2026-11-01T05:00:00"}),
        ]
        for contents in invalid:
            with self.subTest(contents=contents):
                self.path.write_text(contents)
                self.assertTrue(load_daily_restart_state(self.path).disabled)

    def test_failed_replace_preserves_committed_state(self):
        state = DailyRestartState(path=self.path, last_handled_date="2026-11-01", last_attempt_at=DUE)
        self.assertTrue(save_daily_restart_state(state))
        state.last_handled_date = "2026-11-02"
        with patch("monitor.os.replace", side_effect=OSError("disk error")):
            self.assertFalse(save_daily_restart_state(state))
        self.assertLessEqual(len(list(self.path.parent.iterdir())), 2)
        self.assertEqual(load_daily_restart_state(self.path).last_handled_date, "2026-11-01")
        self.assertEqual(list(self.path.parent.iterdir()), [self.path])

    def test_cleanup_read_and_write_errors_disable_daily(self):
        for method in ["unlink", "read_text"]:
            with self.subTest(method=method), patch.object(Path, method, side_effect=PermissionError()):
                self.assertTrue(load_daily_restart_state(self.path).disabled)
        for target in ["monitor.os.fsync", "monitor.os.replace", "pathlib.Path.open"]:
            with self.subTest(target=target), patch(target, side_effect=OSError()):
                state = DailyRestartState(path=self.path, last_handled_date="2026-11-01")
                self.assertFalse(save_daily_restart_state(state))
                self.assertTrue(state.disabled)


class DailyRestartConfigTest(unittest.TestCase):
    def config_with(self, **changes):
        source = Path(__file__).resolve().parents[2] / "packages/config/devices.json"
        raw = json.loads(source.read_text())
        raw["l03e"].pop("dailyRestartEnabled", None)
        raw["l03e"].pop("dailyRestartTimeJst", None)
        raw["l03e"].update(changes)
        return raw

    def load_config(self, raw, device="device01"):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "devices.json"
            path.write_text(json.dumps(raw))
            return load_l03e_restart_config(device, path)

    def test_legacy_config_disabled_and_owner_only(self):
        raw = self.config_with()
        self.assertFalse(self.load_config(raw).daily_restart_enabled)
        raw["l03e"]["dailyRestartEnabled"] = True
        self.assertTrue(self.load_config(raw).daily_restart_enabled)
        self.assertIsNone(self.load_config(raw, "device02"))

    def test_invalid_time_or_enabled_flag_rejected(self):
        for value in ["5:00", "24:00", "05:60", "xx:yy", None, 500]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.load_config(self.config_with(dailyRestartTimeJst=value))
        with self.assertRaises(ValueError):
            self.load_config(self.config_with(dailyRestartEnabled="true"))


if __name__ == "__main__":
    unittest.main()
