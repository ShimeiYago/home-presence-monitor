#!/usr/bin/env python3
"""Raspberry Pi motion monitor for Home Presence Monitor.

Sends:
- Heartbeat every HEARTBEAT_INTERVAL_SEC
- Activity window count every MOTION_WINDOW_SEC
"""

from __future__ import annotations

import dataclasses
import logging
import os
import signal
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Optional
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

    @classmethod
    def from_env(cls) -> "Config":
        api_key = os.getenv("API_KEY", "").strip() or None
        config = cls(
            device_id=env_str("DEVICE_ID"),
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


def heartbeat_loop(
    stop_event: threading.Event,
    config: Config,
    session: requests.Session,
) -> None:
    next_run_monotonic = time.monotonic()
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


def activity_window_loop(
    stop_event: threading.Event,
    config: Config,
    state: MotionState,
    session: requests.Session,
) -> None:
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


def configure_logging(level_name: str) -> None:
    level = getattr(logging, level_name, logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )


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

    sensor = MotionSensor(config.gpio_pin)
    state = MotionState(
        window_start=aligned_window_start(utc_now(), config.motion_window_sec),
        cooldown_sec=config.cooldown_sec,
    )
    stop_event = threading.Event()
    session = requests.Session()
    if config.api_key is not None:
        session.headers.update({config.api_key_header: config.api_key})
        LOGGER.info("api key header configured: %s", config.api_key_header)

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
            target=heartbeat_loop,
            name="heartbeat-loop",
            args=(stop_event, config, session),
            daemon=True,
        ),
        threading.Thread(
            target=activity_window_loop,
            name="activity-window-loop",
            args=(stop_event, config, state, session),
            daemon=True,
        ),
    ]
    for thread in threads:
        thread.start()

    try:
        while not stop_event.is_set():
            stop_event.wait(1.0)
    finally:
        stop_event.set()
        for thread in threads:
            thread.join(timeout=2.0)
        session.close()
        LOGGER.info("monitor stopped")


if __name__ == "__main__":
    main()
