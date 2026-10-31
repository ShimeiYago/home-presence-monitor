# Raspberry Pi Sender

This directory contains the Raspberry Pi process that sends:

- heartbeat every 5 minutes (default)
- activity count for each 10-minute window (default)

Each Raspberry Pi is identified by its own `DEVICE_ID` in `.env`.

## L-03E の日次再起動

`packages/config/devices.json` の `l03eRestartOwnerDeviceId` に指定された
device01だけが、毎朝5:00（日本時間）に既存のHTTP処理でルーターを再起動します。
Pi自体は再起動しません。通信が正常でも実行し、一時的に2台とも通信が切れます。

```json
{
  "dailyRestartEnabled": true,
  "dailyRestartTimeJst": "05:00"
}
```

上記は `l03e` 内の設定です。設定省略時は無効、時刻の既定値は `05:00` です。
OSのタイムゾーンに関係なく日本時間で判定しますが、Piの時計自体は正確である必要があります。

- 既存の60秒間隔の監視ループで実行します。追加のsystemd設定や依存パッケージは不要です。
- 停止・更新で実行時刻を逃した場合は5:30未満まで実行し、それ以降は翌日に回します。
- 定期分は当日1回の試行のみです。管理画面に届かない場合や、要求が失敗・タイムアウトした場合も当日分を消費します。
- 直前30分以内に異常時再起動が成功していれば、当日の定期分はスキップします。
- 定期試行後は結果不明でも30分間、異常時再起動を抑制します。その後は従来の異常時再起動が可能です。
- Wi-Fi停止やルーター電源断で管理画面に届かない場合、この機能では復旧できません。

### 状態ファイル

実行日と定期試行時刻を、サービス実行ユーザーの
`~/.local/state/home-presence-monitor/l03e-restart.json` に保存します。
通常のadminユーザーでは `/home/admin/.local/state/home-presence-monitor/` です。
HTTP操作前に保存するため、直後にプロセスが停止した場合も当日分は再試行しません。
自動更新やPi・サービスの再起動後にも状態は残ります。

保存時は固定名 `l03e-restart.json.tmp` に書き、flush・fsync後に本ファイルへ置き換えます。
異常終了で残った一時ファイルは次回起動時に削除します。
日付別ファイルは作らず、通常1個、書き込み途中でも最大2個です。

状態ファイルの破損・読み書き・一時ファイル削除に失敗した場合は、日次処理だけを停止して
`daily restart disabled` をログに記録します。監視・データ送信・既存の異常時処理は継続します。
復旧時は原因を修正してサービスを再起動してください。当日分の重複実行を避けるため、
状態ファイルを安易に削除しないでください。

### 配備と確認

変更をmainへ反映すると、既存の自動更新が取得してサービスを再起動します。
現地で新しいunitを配置したり、`daemon-reload` を実行したりする必要はありません。
配備時には設定読み込みのログを確認し、翌朝の日次実行を確認します。

```sh
journalctl -u home-presence-monitor-pi --since today --no-pager \
  | grep -E 'daily restart|reason=daily|restart request|reason=cooldown'
```

`reason=daily` は試行、`restart request accepted` はHTTP要求の受付を示します。
通信復旧を保証するログではないため、ダッシュボードでも2台のheartbeatが再開したことを確認してください。
初回は試行から10分以内の受信再開を確認の目安にします。

無効化する場合は `dailyRestartEnabled: false` を配信します。状態ファイルは残し、
直前の定期試行による30分間の抑制も維持します。

### テスト

Python依存を導入した環境で、リポジトリルートから実行します。
HTTP通信はテスト用のセッションで置き換え、実機への再起動要求は送りません。

```sh
python3 -B -m unittest discover -s services/pi -p 'test_*.py' -v
```

## Files

- `monitor.py`: main process
- `requirements.txt`: Python dependencies
- `.env.example`: environment template
- `scripts/self-update.sh`: git pull + dependency update + service restart
- `systemd/home-presence-monitor-pi.service`: service unit example
- `systemd/home-presence-monitor-pi-update.service`: oneshot update job
- `systemd/home-presence-monitor-pi-update.timer`: periodic update timer
