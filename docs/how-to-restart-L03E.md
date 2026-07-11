# L-03E HTTP Restart Procedure

## 結論

L-03E は HTTP 管理画面へのログイン後、`profile_apply.htm` を POST することで再起動相当の挙動を起こせる。

今回の現地確認では、`profile_apply.htm` 実行直後に約 26 秒 HTTP 応答が止まり、その後復帰した。

`system/reset.htm` は初期化の可能性が高いため、この手順では使わない。

## 前提

- L-03E の Wi-Fi に接続していること
- 管理画面 URL は `http://192.168.225.1/`
- ログイン情報:
  - ユーザ名: `Admin`
  - パスワード: `1234`
- 再起動トリガーに使ったプロファイル:
  - `select_Current_profile=rokemoba`
  - `input_text_Profile_name=rokemoba`
  - `input_text_APN_Static=4gn.jp`
  - `input_text_Username=roke@moba`
  - `input_text_Password=rokemoba`
  - `select_Authentication=PAP`

## 最小手順

```bash
OUT=docs/l03e-capture
mkdir -p "$OUT"

curl -sv \
  -c "$OUT/cookie.txt" \
  -D "$OUT/login_apply.headers.txt" \
  -e 'http://192.168.225.1/jp/login.htm' \
  --data-raw "D=$(date +%s)&input_text_Username=Admin&input_password_Password=1234&select_cn=jp" \
  http://192.168.225.1/jp/login_apply.htm \
  -o "$OUT/login_apply.out.html"

curl -sv \
  -b "$OUT/cookie.txt" \
  -e 'http://192.168.225.1/jp/login_apply.htm' \
  http://192.168.225.1/jp/login_apply2.htm \
  -o "$OUT/login_apply2.out.html"

curl -sv \
  -b "$OUT/cookie.txt" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -H 'Origin: http://192.168.225.1' \
  -e 'http://192.168.225.1/jp/network/profile.htm' \
  --data-raw 'T=1&A=1&select_Current_profile=rokemoba&input_text_Profile_name=rokemoba&input_text_APN_Static=4gn.jp&input_text_Username=roke%40moba&input_text_Password=rokemoba&select_Authentication=PAP' \
  http://192.168.225.1/jp/network/profile_apply.htm \
  -o "$OUT/profile_apply.authenticated.out.html"
```

## 成功判定

- `login_apply.htm` が `Set-Cookie: session_id=...` を返す
- `login_apply2.htm` が `200 OK`
- `profile_apply.htm` が `200 OK`
- 実行直後に `http://192.168.225.1/jp/login.htm` が一時的に応答不能になる
- 20 秒から 40 秒程度で再度 `200` に戻る

監視用コマンド:

```bash
while true; do
  printf '%s ' "$(date '+%H:%M:%S')"
  curl -m 2 -s -o /dev/null -w '%{http_code}\n' http://192.168.225.1/jp/login.htm || echo 000
  sleep 1
done
```

今回の実測では `000` が約 26 秒続いた。

## 分かったこと

- `login.htm` の事前 GET は必須ではなかった
- `login_apply.htm` の POST だけで `session_id` が払い出された
- `select_cn=jp` はログイン POST に含める
- `login_apply2.htm` はログイン完了フローに必要
- `profile_apply.htm` はブラウザだけでなく `curl` からでも再起動トリガーとして機能した

## 注意

- この手順は再起動を誘発するため、実行中は L-03E 配下の通信が止まる
- `system/reset.htm` は使わない
- プロファイル値を変えると意図せず接続設定を書き換える可能性がある
- 実運用では `profile_apply` に渡す値を固定し、監視失敗時だけ呼ぶ形が安全
