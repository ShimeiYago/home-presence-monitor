#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${REPO_DIR:-/home/admin/home-presence-monitor}"
PI_DIR="${PI_DIR:-$REPO_DIR/services/pi}"
VENV_DIR="${VENV_DIR:-$PI_DIR/.venv}"
PI_USER="${PI_USER:-admin}"
GIT_BRANCH="${GIT_BRANCH:-main}"
PI_SERVICE_NAME="${PI_SERVICE_NAME:-home-presence-monitor-pi.service}"

run_as_pi() {
  runuser -u "$PI_USER" -- "$@"
}

if [[ "${EUID}" -ne 0 ]]; then
  echo "self-update.sh must run as root" >&2
  exit 1
fi

if [[ ! -d "$REPO_DIR/.git" ]]; then
  echo "git repository not found: $REPO_DIR" >&2
  exit 1
fi

if ! id "$PI_USER" >/dev/null 2>&1; then
  echo "user not found: $PI_USER" >&2
  exit 1
fi

if [[ ! -f "$PI_DIR/requirements.txt" ]]; then
  echo "requirements.txt not found: $PI_DIR/requirements.txt" >&2
  exit 1
fi

echo "Fetching origin/$GIT_BRANCH"
run_as_pi git -C "$REPO_DIR" fetch origin "$GIT_BRANCH"

LOCAL_HEAD="$(run_as_pi git -C "$REPO_DIR" rev-parse HEAD)"
REMOTE_HEAD="$(run_as_pi git -C "$REPO_DIR" rev-parse "origin/$GIT_BRANCH")"

if [[ "$LOCAL_HEAD" == "$REMOTE_HEAD" ]]; then
  echo "No update available"
  exit 0
fi

echo "Updating $REPO_DIR to origin/$GIT_BRANCH"
run_as_pi git -C "$REPO_DIR" checkout "$GIT_BRANCH"
run_as_pi git -C "$REPO_DIR" reset --hard "origin/$GIT_BRANCH"

if [[ ! -x "$VENV_DIR/bin/python" ]]; then
  echo "Creating venv at $VENV_DIR"
  run_as_pi python3 -m venv "$VENV_DIR"
fi

echo "Installing Python dependencies"
run_as_pi "$VENV_DIR/bin/pip" install -r "$PI_DIR/requirements.txt"

echo "Restarting $PI_SERVICE_NAME"
systemctl restart "$PI_SERVICE_NAME"
