# Raspberry Pi Sender

This directory contains the Raspberry Pi process that sends:

- heartbeat every 5 minutes (default)
- activity count for each 10-minute window (default)

## Files

- `monitor.py`: main process
- `requirements.txt`: Python dependencies
- `.env.example`: environment template
- `systemd/home-presence-monitor-pi.service`: service unit example

## Setup on Raspberry Pi

```bash
cd $HOME/home-presence-monitor
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Edit `.env` for your environment:

- `DEVICE_ID`: device identifier
- `API_BASE_URL`: API base URL (example: `http://localhost:3001`)
- `API_KEY`: API key value (optional)
- `API_KEY_HEADER`: header name for API key (default: `x-api-key`)
- `GPIO_PIN`: PIR pin
- intervals and cooldown as needed

If your API expects bearer auth, set:

- `API_KEY_HEADER=Authorization`
- `API_KEY=Bearer <token>`

## Run manually

```bash
cd $HOME/home-presence-monitor
. .venv/bin/activate
set -a
. ./.env
set +a
python monitor.py
```

## systemd

1. Copy service file:

```bash
sudo cp systemd/home-presence-monitor-pi.service /etc/systemd/system/
```

2. Adjust `User`, `Group`, `WorkingDirectory`, `EnvironmentFile`, and `ExecStart`
   in the service file to match your host path.

3. Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now home-presence-monitor-pi
```

4. Check logs:

```bash
journalctl -u home-presence-monitor-pi -f
```
