# Raspberry Pi Sender

This directory contains the Raspberry Pi process that sends:

- heartbeat every 5 minutes (default)
- activity count for each 10-minute window (default)

## Files

- `monitor.py`: main process
- `requirements.txt`: Python dependencies
- `.env.example`: environment template
- `scripts/self-update.sh`: git pull + dependency update + service restart
- `systemd/home-presence-monitor-pi.service`: service unit example
- `systemd/home-presence-monitor-pi-update.service`: oneshot update job
- `systemd/home-presence-monitor-pi-update.timer`: periodic update timer
