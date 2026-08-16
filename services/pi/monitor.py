#!/usr/bin/env python3
"""Raspberry Pi motion monitor for Home Presence Monitor.

Sends:
- Heartbeat every HEARTBEAT_INTERVAL_SEC
- Activity window count every MOTION_WINDOW_SEC
"""

from __future__ import annotations

import dataclasses
import json
import logging
import os
import signal
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Optional
from urllib.parse import quote

import requests

try:
    from gpiozero import MotionSensor
except Exception as gpio_import_error:  # pragma: no cover - runtime environment dependent
    MotionSensor = None  # type: ignore[assignment]
    GPIO_IMPORT_ERROR = gpio_import_error
else:
    GPIO_IMPORT_ERROR = None

LOGGER = logging.getLogger("pi-monitor")

API_KEY_HEADER = "x-api-key"
GPIO_PIN = 17
HEARTBEAT_INTERVAL_SEC = 300 # 5 minutes
MOTION_WINDOW_SEC = 600 # 10 minutes
REQUEST_TIMEOUT_SEC = 10
POST_MAX_ATTEMPTS = 3
POST_RETRY_BACKOFF_SEC = 1.0
COOLDOWN_SEC = 2.0
LOG_LEVEL = "INFO"
SHARED_DEVICES_CONFIG_PATH = (
    Path(__file__).resolve().parents[2] / "packages" / "config" / "devices.json"
)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def to_iso8601(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def aligned_window_start(now: datetime, window_sec: int) -> datetime:
    epoch = int(now.timestamp())
    aligned_epoch = epoch - (epoch % window_sec)
    return datetime.fromtimestamp(aligned_epoch, tz=timezone.utc)


def env_str(name: str, default: Optional[str] = None) -> str:
    value = os.getenv(name, default)
    if value is None or value == "":
        raise ValueError(f"Missing environment variable: {name}")
    return value


def require_str(value: Any, name: str) -> str:
    if not isinstance(value, str) or value.strip() == "":
        raise ValueError(f"{name} must be a non-empty string")
    return value


def require_positive_int(value: Any, name: str) -> int:
    if not isinstance(value, int) or value <= 0:
        raise ValueError(f"{name} must be a positive integer")
    return value


@dataclasses.dataclass(frozen=True)
class L03ERestartConfig:
    base_url: str
    admin_password: str
    profile_name: str
    apn_static: str
    profile_username: str
    profile_password: str
    profile_authentication: str
    wan_check_urls: tuple[str, ...]
    check_interval_sec: int
    consecutive_failures_before_restart: int
    restart_cooldown_sec: int
    request_timeout_sec: int

    @property
    def login_apply_url(self) -> str:
        return f"{self.base_url}/jp/login_apply.htm"

    @property
    def login_apply2_url(self) -> str:
        return f"{self.base_url}/jp/login_apply2.htm"

    @property
    def login_page_url(self) -> str:
        return f"{self.base_url}/jp/login.htm"

    @property
    def profile_page_url(self) -> str:
        return f"{self.base_url}/jp/network/profile.htm"

    @property
    def profile_apply_url(self) -> str:
        return f"{self.base_url}/jp/network/profile_apply.htm"


@dataclasses.dataclass
class L03ERestartState:
    consecutive_wan_failures: int = 0
    last_restart_monotonic: Optional[float] = None


def load_l03e_restart_config(
    device_id: str,
    config_path: Path = SHARED_DEVICES_CONFIG_PATH,
) -> Optional[L03ERestartConfig]:
    with config_path.open(encoding="utf-8") as config_file:
        config = json.load(config_file)

    owner_device_id = require_str(
        config.get("l03eRestartOwnerDeviceId"),
        "l03eRestartOwnerDeviceId",
    )
    if owner_device_id != device_id:
        return None

    raw_l03e = config.get("l03e")
    if not isinstance(raw_l03e, dict):
        raise ValueError("l03e must be an object")

    raw_wan_check_urls = raw_l03e.get("wanCheckUrls")
    if not isinstance(raw_wan_check_urls, list) or len(raw_wan_check_urls) == 0:
        raise ValueError("l03e.wanCheckUrls must be a non-empty list")

    wan_check_urls = tuple(
        require_str(url, f"l03e.wanCheckUrls[{index}]")
        for index, url in enumerate(raw_wan_check_urls)
    )

    return L03ERestartConfig(
        base_url=require_str(raw_l03e.get("baseUrl"), "l03e.baseUrl").rstrip("/"),
        admin_password=require_str(raw_l03e.get("adminPassword"), "l03e.adminPassword"),
        profile_name=require_str(raw_l03e.get("profileName"), "l03e.profileName"),
        apn_static=require_str(raw_l03e.get("apnStatic"), "l03e.apnStatic"),
        profile_username=require_str(
            raw_l03e.get("profileUsername"),
            "l03e.profileUsername",
        ),
        profile_password=require_str(
            raw_l03e.get("profilePassword"),
            "l03e.profilePassword",
        ),
        profile_authentication=require_str(
            raw_l03e.get("profileAuthentication"),
            "l03e.profileAuthentication",
        ),
        wan_check_urls=wan_check_urls,
        check_interval_sec=require_positive_int(
            raw_l03e.get("checkIntervalSec"),
            "l03e.checkIntervalSec",
        ),
        consecutive_failures_before_restart=require_positive_int(
            raw_l03e.get("consecutiveFailuresBeforeRestart"),
            "l03e.consecutiveFailuresBeforeRestart",
        ),
        restart_cooldown_sec=require_positive_int(
            raw_l03e.get("restartCooldownSec"),
            "l03e.restartCooldownSec",
        ),
        request_timeout_sec=require_positive_int(
            raw_l03e.get("requestTimeoutSec"),
            "l03e.requestTimeoutSec",
        ),
    )


@dataclasses.dataclass(frozen=True)
class Config:
    device_id: str
    api_base_url: str
    api_key: Optional[str]
    api_key_header: str
    gpio_pin: int
    heartbeat_interval_sec: int
    motion_window_sec: int
    request_timeout_sec: int
    post_max_attempts: int
    post_retry_backoff_sec: float
    cooldown_sec: float
    log_level: str
    l03e_restart_config: Optional[L03ERestartConfig]

    @classmethod
    def from_env(cls) -> "Config":
        api_key = os.getenv("API_KEY", "").strip() or None
        device_id = env_str("DEVICE_ID")
        config = cls(
            device_id=device_id,
            api_base_url=env_str("API_BASE_URL"),
            api_key=api_key,
            api_key_header=API_KEY_HEADER,
            gpio_pin=GPIO_PIN,
            heartbeat_interval_sec=HEARTBEAT_INTERVAL_SEC,
            motion_window_sec=MOTION_WINDOW_SEC,
            request_timeout_sec=REQUEST_TIMEOUT_SEC,
            post_max_attempts=POST_MAX_ATTEMPTS,
            post_retry_backoff_sec=POST_RETRY_BACKOFF_SEC,
            cooldown_sec=COOLDOWN_SEC,
            log_level=LOG_LEVEL,
            l03e_restart_config=load_l03e_restart_config(device_id),
        )

        if config.heartbeat_interval_sec <= 0:
            raise ValueError("HEARTBEAT_INTERVAL_SEC must be > 0")
        if config.motion_window_sec <= 0:
            raise ValueError("MOTION_WINDOW_SEC must be > 0")
        if config.request_timeout_sec <= 0:
            raise ValueError("REQUEST_TIMEOUT_SEC must be > 0")
        if config.post_max_attempts <= 0:
            raise ValueError("POST_MAX_ATTEMPTS must be > 0")
        if config.post_retry_backoff_sec < 0:
            raise ValueError("POST_RETRY_BACKOFF_SEC must be >= 0")
        if config.cooldown_sec < 0:
            raise ValueError("COOLDOWN_SEC must be >= 0")
        if config.api_key_header.strip() == "":
            raise ValueError("API_KEY_HEADER must not be empty")

        return config

    @property
    def heartbeat_url(self) -> str:
        base = self.api_base_url.rstrip("/")
        encoded_device_id = quote(self.device_id, safe="")
        return f"{base}/v1/devices/{encoded_device_id}/heartbeats"

    @property
    def activities_url(self) -> str:
        base = self.api_base_url.rstrip("/")
        encoded_device_id = quote(self.device_id, safe="")
        return f"{base}/v1/devices/{encoded_device_id}/activities"


class MotionState:
    def __init__(self, window_start: datetime, cooldown_sec: float) -> None:
        self.lock = threading.Lock()
        self.window_start = window_start
        self.cooldown_sec = cooldown_sec
        self.motion_count = 0
        self.last_motion_at: Optional[str] = None
        self.last_counted_monotonic = 0.0

    def on_motion(self, now_monotonic: float, now_dt: datetime) -> tuple[bool, int, str]:
        now_iso = to_iso8601(now_dt)
        with self.lock:
            self.last_motion_at = now_iso
            counted = now_monotonic - self.last_counted_monotonic >= self.cooldown_sec
            if counted:
                self.motion_count += 1
                self.last_counted_monotonic = now_monotonic
            return counted, self.motion_count, now_iso

    def close_window(self, window_sec: int) -> tuple[str, str, int]:
        with self.lock:
            window_end = self.window_start + timedelta(seconds=window_sec)
            count_to_send = self.motion_count
            self.motion_count = 0
            window_start_iso = to_iso8601(self.window_start)
            window_end_iso = to_iso8601(window_end)
            self.window_start = window_end
            return window_start_iso, window_end_iso, count_to_send

    def seconds_until_next_window(self, window_sec: int) -> float:
        with self.lock:
            window_end = self.window_start + timedelta(seconds=window_sec)
        return (window_end - utc_now()).total_seconds()


def post_json(
    session: requests.Session,
    url: str,
    payload: dict,
    timeout_sec: int,
    max_attempts: int,
    retry_backoff_sec: float,
) -> None:
    for attempt in range(1, max_attempts + 1):
        try:
            response = session.post(url, json=payload, timeout=timeout_sec)
        except requests.RequestException as exc:
            if attempt >= max_attempts:
                LOGGER.error(
                    "POST failed url=%s attempt=%s/%s error=%s payload=%s",
                    url,
                    attempt,
                    max_attempts,
                    exc,
                    payload,
                )
                return

            LOGGER.warning(
                "POST retrying after request error url=%s attempt=%s/%s error=%s payload=%s",
                url,
                attempt,
                max_attempts,
                exc,
                payload,
            )
            time.sleep(retry_backoff_sec * attempt)
            continue

        if 200 <= response.status_code < 300:
            LOGGER.info(
                "POST ok url=%s status=%s attempt=%s/%s payload=%s",
                url,
                response.status_code,
                attempt,
                max_attempts,
                payload,
            )
            return

        body = response.text.strip()
        body_preview = body[:500] if body else "(empty)"
        is_retriable_status = response.status_code == 429 or response.status_code >= 500
        if not is_retriable_status or attempt >= max_attempts:
            LOGGER.warning(
                "POST non-2xx url=%s status=%s attempt=%s/%s body=%s payload=%s",
                url,
                response.status_code,
                attempt,
                max_attempts,
                body_preview,
                payload,
            )
            return

        LOGGER.warning(
            "POST retrying after non-2xx url=%s status=%s attempt=%s/%s body=%s payload=%s",
            url,
            response.status_code,
            attempt,
            max_attempts,
            body_preview,
            payload,
        )
        time.sleep(retry_backoff_sec * attempt)


def is_url_reachable(
    session: requests.Session,
    url: str,
    timeout_sec: int,
) -> bool:
    try:
        response = session.get(url, timeout=timeout_sec, allow_redirects=False)
    except requests.RequestException as exc:
        LOGGER.debug("L-03E reachability failed url=%s error=%s", url, exc)
        return False

    LOGGER.debug("L-03E reachability ok url=%s status=%s", url, response.status_code)
    return True


def has_wan_connectivity(
    session: requests.Session,
    l03e_config: L03ERestartConfig,
) -> bool:
    for url in l03e_config.wan_check_urls:
        if is_url_reachable(session, url, l03e_config.request_timeout_sec):
            return True
    return False


def restart_l03e(
    session: requests.Session,
    l03e_config: L03ERestartConfig,
) -> bool:
    login_response = session.post(
        l03e_config.login_apply_url,
        data={
            "D": str(int(time.time())),
            "input_text_Username": "Admin",
            "input_password_Password": l03e_config.admin_password,
            "select_cn": "jp",
        },
        headers={"Referer": l03e_config.login_page_url},
        timeout=l03e_config.request_timeout_sec,
    )
    if not 200 <= login_response.status_code < 300:
        LOGGER.warning(
            "L-03E login_apply failed status=%s",
            login_response.status_code,
        )
        return False

    login_apply2_response = session.get(
        l03e_config.login_apply2_url,
        headers={"Referer": l03e_config.login_apply_url},
        timeout=l03e_config.request_timeout_sec,
        allow_redirects=False,
    )
    if not 200 <= login_apply2_response.status_code < 300:
        LOGGER.warning(
            "L-03E login_apply2 failed status=%s",
            login_apply2_response.status_code,
        )
        return False

    profile_apply_response = session.post(
        l03e_config.profile_apply_url,
        data={
            "T": "1",
            "A": "1",
            "select_Current_profile": l03e_config.profile_name,
            "input_text_Profile_name": l03e_config.profile_name,
            "input_text_APN_Static": l03e_config.apn_static,
            "input_text_Username": l03e_config.profile_username,
            "input_text_Password": l03e_config.profile_password,
            "select_Authentication": l03e_config.profile_authentication,
        },
        headers={
            "Origin": l03e_config.base_url,
            "Referer": l03e_config.profile_page_url,
        },
        timeout=l03e_config.request_timeout_sec,
    )
    if not 200 <= profile_apply_response.status_code < 300:
        LOGGER.warning(
            "L-03E profile_apply failed status=%s",
            profile_apply_response.status_code,
        )
        return False

    LOGGER.warning("L-03E restart triggered via profile_apply")
    return True


def check_l03e_once(
    session: requests.Session,
    l03e_config: L03ERestartConfig,
    state: L03ERestartState,
    now_monotonic: float,
) -> bool:
    if not is_url_reachable(
        session,
        l03e_config.login_page_url,
        l03e_config.request_timeout_sec,
    ):
        state.consecutive_wan_failures = 0
        LOGGER.warning("L-03E router unreachable; skipping restart check")
        return False

    if has_wan_connectivity(session, l03e_config):
        if state.consecutive_wan_failures > 0:
            LOGGER.info(
                "L-03E WAN recovered after failures=%s",
                state.consecutive_wan_failures,
            )
        state.consecutive_wan_failures = 0
        return False

    state.consecutive_wan_failures += 1
    LOGGER.warning(
        "L-03E WAN check failed consecutive_failures=%s threshold=%s",
        state.consecutive_wan_failures,
        l03e_config.consecutive_failures_before_restart,
    )

    if (
        state.consecutive_wan_failures
        < l03e_config.consecutive_failures_before_restart
    ):
        return False

    if (
        state.last_restart_monotonic is not None
        and now_monotonic - state.last_restart_monotonic
        < l03e_config.restart_cooldown_sec
    ):
        LOGGER.warning(
            "L-03E restart skipped during cooldown elapsed=%.1fs cooldown=%ss",
            now_monotonic - state.last_restart_monotonic,
            l03e_config.restart_cooldown_sec,
        )
        return False

    try:
        restarted = restart_l03e(session, l03e_config)
    except requests.RequestException as exc:
        LOGGER.error("L-03E restart request failed error=%s", exc)
        return False

    if restarted:
        state.last_restart_monotonic = now_monotonic
        state.consecutive_wan_failures = 0
        return True

    return False


def l03e_restart_loop(
    stop_event: threading.Event,
    l03e_config: L03ERestartConfig,
) -> None:
    state = L03ERestartState()
    session = requests.Session()
    try:
        while not stop_event.is_set():
            check_l03e_once(session, l03e_config, state, time.monotonic())
            stop_event.wait(l03e_config.check_interval_sec)
    finally:
        session.close()


def create_api_session(config: Config) -> requests.Session:
    session = requests.Session()
    if config.api_key is not None:
        session.headers.update({config.api_key_header: config.api_key})
    return session


def heartbeat_loop(
    stop_event: threading.Event,
    config: Config,
) -> None:
    session = create_api_session(config)
    next_run_monotonic = time.monotonic()
    try:
        while not stop_event.is_set():
            payload = {"timestamp": to_iso8601(utc_now())}
            post_json(
                session,
                config.heartbeat_url,
                payload,
                config.request_timeout_sec,
                config.post_max_attempts,
                config.post_retry_backoff_sec,
            )

            next_run_monotonic += config.heartbeat_interval_sec
            wait_sec = max(0.0, next_run_monotonic - time.monotonic())
            stop_event.wait(wait_sec)
    finally:
        session.close()


def activity_window_loop(
    stop_event: threading.Event,
    config: Config,
    state: MotionState,
) -> None:
    session = create_api_session(config)
    try:
        while not stop_event.is_set():
            wait_sec = state.seconds_until_next_window(config.motion_window_sec)
            if wait_sec > 0 and stop_event.wait(wait_sec):
                break

            window_start, window_end, count_to_send = state.close_window(config.motion_window_sec)
            payload = {
                "windowStart": window_start,
                "windowEnd": window_end,
                "motionCount": count_to_send,
            }
            post_json(
                session,
                config.activities_url,
                payload,
                config.request_timeout_sec,
                config.post_max_attempts,
                config.post_retry_backoff_sec,
            )
    finally:
        session.close()


def configure_logging(level_name: str) -> None:
    level = getattr(logging, level_name, logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )


class WorkerFailure:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.name: Optional[str] = None
        self.error: Optional[BaseException] = None

    def record(self, name: str, error: BaseException) -> None:
        with self.lock:
            if self.error is None:
                self.name = name
                self.error = error

    def get(self) -> tuple[Optional[str], Optional[BaseException]]:
        with self.lock:
            return self.name, self.error


def run_worker(
    name: str,
    stop_event: threading.Event,
    failures: WorkerFailure,
    target: Callable[[], None],
) -> None:
    try:
        target()
    except BaseException as exc:
        failures.record(name, exc)
        LOGGER.exception("worker failed name=%s", name)
        stop_event.set()
        return

    if not stop_event.is_set():
        error = RuntimeError(f"worker exited unexpectedly: {name}")
        failures.record(name, error)
        LOGGER.error("worker exited unexpectedly name=%s", name)
        stop_event.set()


def main() -> None:
    config = Config.from_env()
    configure_logging(config.log_level)

    if MotionSensor is None:
        raise RuntimeError(
            "gpiozero import failed. Install gpiozero on Raspberry Pi and enable GPIO."
        ) from GPIO_IMPORT_ERROR

    LOGGER.info("monitor start device_id=%s gpio_pin=%s", config.device_id, config.gpio_pin)
    LOGGER.info(
        "heartbeat=%ss motion_window=%ss retry_attempts=%s retry_backoff=%.2fs cooldown=%.2fs api=%s",
        config.heartbeat_interval_sec,
        config.motion_window_sec,
        config.post_max_attempts,
        config.post_retry_backoff_sec,
        config.cooldown_sec,
        config.api_base_url,
    )
    if config.api_key is not None:
        LOGGER.info("api key header configured: %s", config.api_key_header)
    if config.l03e_restart_config is None:
        LOGGER.info("L-03E restart owner disabled for device_id=%s", config.device_id)
    else:
        LOGGER.info(
            "L-03E restart owner enabled base_url=%s check_interval=%ss threshold=%s cooldown=%ss",
            config.l03e_restart_config.base_url,
            config.l03e_restart_config.check_interval_sec,
            config.l03e_restart_config.consecutive_failures_before_restart,
            config.l03e_restart_config.restart_cooldown_sec,
        )

    sensor = MotionSensor(config.gpio_pin)
    state = MotionState(
        window_start=aligned_window_start(utc_now(), config.motion_window_sec),
        cooldown_sec=config.cooldown_sec,
    )
    stop_event = threading.Event()
    worker_failures = WorkerFailure()

    def on_motion() -> None:
        counted, total, now_iso = state.on_motion(time.monotonic(), utc_now())
        if counted:
            LOGGER.info("motion detected count=%s at=%s", total, now_iso)

    sensor.when_motion = on_motion

    def handle_shutdown(signum: int, _frame: object) -> None:
        LOGGER.info("received signal=%s shutting down", signum)
        stop_event.set()

    signal.signal(signal.SIGINT, handle_shutdown)
    signal.signal(signal.SIGTERM, handle_shutdown)

    threads = [
        threading.Thread(
            target=run_worker,
            name="heartbeat-loop",
            args=(
                "heartbeat-loop",
                stop_event,
                worker_failures,
                lambda: heartbeat_loop(stop_event, config),
            ),
        ),
        threading.Thread(
            target=run_worker,
            name="activity-window-loop",
            args=(
                "activity-window-loop",
                stop_event,
                worker_failures,
                lambda: activity_window_loop(stop_event, config, state),
            ),
        ),
    ]
    if config.l03e_restart_config is not None:
        threads.append(
            threading.Thread(
                target=run_worker,
                name="l03e-restart-loop",
                args=(
                    "l03e-restart-loop",
                    stop_event,
                    worker_failures,
                    lambda: l03e_restart_loop(stop_event, config.l03e_restart_config),
                ),
            )
        )
    for thread in threads:
        thread.start()

    try:
        while not stop_event.is_set():
            failed_name, failed_error = worker_failures.get()
            if failed_error is not None:
                raise RuntimeError(f"worker failed: {failed_name}") from failed_error

            stop_event.wait(1.0)
    finally:
        stop_event.set()
        for thread in threads:
            thread.join(timeout=2.0)
        LOGGER.info("monitor stopped")

    failed_name, failed_error = worker_failures.get()
    if failed_error is not None:
        raise RuntimeError(f"worker failed: {failed_name}") from failed_error


if __name__ == "__main__":
    main()
