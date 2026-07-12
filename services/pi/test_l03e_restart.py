import unittest
from typing import Any, Optional

import requests

from monitor import (
    L03ERestartConfig,
    L03ERestartState,
    check_l03e_once,
    load_l03e_restart_config,
)


class FakeResponse:
    def __init__(self, status_code: int = 200) -> None:
        self.status_code = status_code


class FakeSession:
    def __init__(
        self,
        get_results: list[Any],
        post_results: Optional[list[Any]] = None,
    ) -> None:
        self.get_results = get_results
        self.post_results = post_results or []
        self.calls: list[tuple[str, str, dict[str, Any]]] = []

    def get(self, url: str, **kwargs: Any) -> FakeResponse:
        self.calls.append(("GET", url, kwargs))
        result = self.get_results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result

    def post(self, url: str, **kwargs: Any) -> FakeResponse:
        self.calls.append(("POST", url, kwargs))
        result = self.post_results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


def make_config(
    *,
    threshold: int = 3,
    cooldown_sec: int = 1800,
) -> L03ERestartConfig:
    return L03ERestartConfig(
        base_url="http://192.168.225.1",
        admin_password="1234",
        profile_name="rokemoba",
        apn_static="4gn.jp",
        profile_username="roke@moba",
        profile_password="rokemoba",
        profile_authentication="PAP",
        wan_check_urls=("http://1.1.1.1/",),
        check_interval_sec=60,
        consecutive_failures_before_restart=threshold,
        restart_cooldown_sec=cooldown_sec,
        request_timeout_sec=5,
    )


class L03ERestartTest(unittest.TestCase):
    def test_non_owner_does_not_load_restart_config(self) -> None:
        self.assertIsNone(load_l03e_restart_config("device02"))

    def test_wan_healthy_does_not_restart(self) -> None:
        session = FakeSession([FakeResponse(), FakeResponse()])
        state = L03ERestartState(consecutive_wan_failures=1)

        restarted = check_l03e_once(session, make_config(), state, 100.0)

        self.assertFalse(restarted)
        self.assertEqual(state.consecutive_wan_failures, 0)
        self.assertEqual([call[0] for call in session.calls], ["GET", "GET"])

    def test_router_unreachable_does_not_restart(self) -> None:
        session = FakeSession([requests.RequestException("router down")])
        state = L03ERestartState(consecutive_wan_failures=2)

        restarted = check_l03e_once(session, make_config(), state, 100.0)

        self.assertFalse(restarted)
        self.assertEqual(state.consecutive_wan_failures, 0)
        self.assertEqual([call[0] for call in session.calls], ["GET"])

    def test_wan_failure_below_threshold_does_not_restart(self) -> None:
        session = FakeSession(
            [FakeResponse(), requests.RequestException("wan down")]
        )
        state = L03ERestartState()

        restarted = check_l03e_once(session, make_config(), state, 100.0)

        self.assertFalse(restarted)
        self.assertEqual(state.consecutive_wan_failures, 1)
        self.assertEqual([call[0] for call in session.calls], ["GET", "GET"])

    def test_threshold_reached_restarts_l03e(self) -> None:
        session = FakeSession(
            [
                FakeResponse(),
                requests.RequestException("wan down"),
                FakeResponse(),
            ],
            [FakeResponse(), FakeResponse()],
        )
        state = L03ERestartState(consecutive_wan_failures=2)

        restarted = check_l03e_once(session, make_config(), state, 100.0)

        self.assertTrue(restarted)
        self.assertEqual(state.consecutive_wan_failures, 0)
        self.assertEqual(state.last_restart_monotonic, 100.0)
        self.assertEqual(
            [(method, url) for method, url, _kwargs in session.calls],
            [
                ("GET", "http://192.168.225.1/jp/login.htm"),
                ("GET", "http://1.1.1.1/"),
                ("POST", "http://192.168.225.1/jp/login_apply.htm"),
                ("GET", "http://192.168.225.1/jp/login_apply2.htm"),
                ("POST", "http://192.168.225.1/jp/network/profile_apply.htm"),
            ],
        )

    def test_cooldown_skips_restart(self) -> None:
        session = FakeSession(
            [FakeResponse(), requests.RequestException("wan down")]
        )
        state = L03ERestartState(
            consecutive_wan_failures=2,
            last_restart_monotonic=50.0,
        )

        restarted = check_l03e_once(
            session,
            make_config(cooldown_sec=1800),
            state,
            100.0,
        )

        self.assertFalse(restarted)
        self.assertEqual(state.consecutive_wan_failures, 3)
        self.assertEqual([call[0] for call in session.calls], ["GET", "GET"])


if __name__ == "__main__":
    unittest.main()
