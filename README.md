# Next.js CDK Static i18n Template

Template repository for a static Next.js app deployed to AWS (S3 + CloudFront via CDK).  
Build the frontend, run deployment command, and you’ll get a multi-language static site served over CloudFront.

## Setup

- Run `npm install` at the repo root to install the workspace dependencies.

## Adding dependencies

Use npm workspaces from the repo root so each package stays isolated:

- Frontend (`front/`): `npm install <package-name> --workspace front` (add `-D` for dev deps).
- CDK (`cdk/`): `npm install <package-name> --workspace cdk` (add `-D` for dev deps).

Running commands from the root keeps the lockfile consistent and avoids manually dropping into each workspace.

## Development

- フロントエンド: `npm run dev:front`
- API サーバー: `npm run dev:api`

### Backend local dev (DynamoDB Local)

ローカルでは DynamoDB Local (Docker) を起動し、API からは `DYNAMODB_ENDPOINT` で接続します。

```sh
docker compose -f packages/db/ddb.local.yaml up -d
```

テーブル作成（スキーマ駆動）↓

```sh
npm run ddb:local:bootstrap
```

なお、`http://localhost:8001/` にアクセスすることで、DynamoDB Local の中身をGUIで操作できる。

### UI コンポーネント追加

- `npm run shadcn:add:front -- button`

## Deployment

### Prerequisites

- You can run the AWS CDK CLI against the target account (credentials configured and the account bootstrapped for CDK usage).
- If you want to use a custom domain, the `hostedZoneDomain` must already exist in Route53 within the same AWS account.
- If you want to use a custom domain, a certificate for the domain you will serve (for example `*.example.com`) is issued in the account. Provide its ARN via `cdk/site-config.json` if you want to reuse it; otherwise the stack will request a DNS-validated certificate in `us-east-1` automatically using the hosted zone.

### Steps

0. **One-time prep** – Edit `front/.env` and `cdk/site-config.json`.
   - No custom domain: keep `siteNameKey` only.
   - Custom domain: set `domainName`, `hostedZoneDomain`, and (optionally) `certificateArn`.
1. **One-time prep** - Set deploy env vars in `cdk/.env` (example):
   - `CLOUDFRONT_BASIC_AUTH_USERNAME=your-user`
   - `CLOUDFRONT_BASIC_AUTH_PASSWORD=your-strong-password`
   - `LINE_CHANNEL_ACCESS_TOKEN=your-line-channel-access-token`
   - `LINE_GROUP_ID=your-line-group-id`
2. Run `npm run deploy:cdk` to upload the assets, create/update the CloudFront distribution, and (if configured) publish the DNS records.

The CDK deployment prints the CloudFront domain and S3 bucket name as stack outputs; use them for verification or DNS troubleshooting.

### Destroying the stack

- Run `npm run destroy:cdk` to tear down the CloudFront distribution, S3 bucket, and supporting Route53/CERT resources.
- CDK will prompt for confirmation; add `-- --force` after the command if you need to skip the prompt (for example `npm run destroy:cdk -- --force`).

## Raspberry Pi への配備

複数 device を使う場合も構成は同じで、`device01` 用 Pi と `device02` 用 Pi をそれぞれ 1 台ずつ用意します。各 Pi で `services/pi/.env` の `DEVICE_ID` を切り替えるだけで、API / DynamoDB 上では別 device として記録されます。

### OS イメージの書き込み

Raspberry Pi Imager で microSDに書き込む。

- Device: 選択なし
- OS: Raspberry Pi OS Lite (32-bit)
- Storage: microSDカードを選択
- Customisation
  - hostname: `device01` または `device02`
  - username: admin
  - password: (任意のパスワード)
  - WiFi (2.4GHzのWiFiを推奨)
  - SSH: 有効化

### 初期セットアップ

Raspberry Pi 側が定期的に `git pull` して自分で更新する構成。

0. Raspberry Pi にSSH接続

```sh
ssh admin@device01.local
```

Raspberry Pi Imager で設定したパスワードを入力してログイン。

1. 必要パッケージをインストールする

Raspberry Pi OS / Debian 系を前提としています。

```sh
sudo apt update
sudo apt install -y git
```

2. git でプライベートリポジトリを参照するために、Pi 側の `admin` ユーザーに deploy key を作る

```sh
sudo install -d -m 700 -o admin -g admin /home/admin/.ssh
sudo -u admin ssh-keygen -t ed25519 -f /home/admin/.ssh/home-presence-monitor-deploy -N ""
sudo -u admin ssh-keyscan -H github.com | sudo tee -a /home/admin/.ssh/known_hosts >/dev/null
sudo chown admin:admin /home/admin/.ssh/known_hosts
sudo chmod 600 /home/admin/.ssh/known_hosts
cat <<'EOF' | sudo tee /home/admin/.ssh/config >/dev/null
Host github-hpm
  HostName github.com
  User git
  IdentityFile /home/admin/.ssh/home-presence-monitor-deploy
  IdentitiesOnly yes
EOF
sudo chown admin:admin /home/admin/.ssh/config
sudo chmod 600 /home/admin/.ssh/config
sudo -u admin cat /home/admin/.ssh/home-presence-monitor-deploy.pub
```

表示された公開鍵を GitHub の対象 repository (home-presence-monitor) の `Settings > Deploy keys` に read-only で登録します。

3. Github への SSH 接続を確認する

public repository の場合はこの手順をスキップして次へ進んでください。

```sh
sudo -u admin ssh -T git@github-hpm
```

4. Raspberry Pi 上で repo を clone する

```sh
cd $HOME
git clone git@github-hpm:ShimeiYago/home-presence-monitor.git
cd $HOME/home-presence-monitor
```

5. Pi プロセス用の virtualenv を作る

```sh
cd $HOME/home-presence-monitor/services/pi
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

6. `services/pi/.env` を環境に合わせて編集する

- `DEVICE_ID` (`device01` または `device02`)
- `API_BASE_URL`
- `API_KEY`

device を 2 台にする場合は、2 台目の Pi でも同じ手順を繰り返し、`DEVICE_ID=device02` にして配備します。

7. systemd unit を配置する

```sh
cd $HOME/home-presence-monitor/services/pi
sudo cp systemd/home-presence-monitor-pi.service /etc/systemd/system/
sudo cp systemd/home-presence-monitor-pi-update.service /etc/systemd/system/
sudo cp systemd/home-presence-monitor-pi-update.timer /etc/systemd/system/
```

8. 必要なら unit 内の `User`, `Group`, `REPO_DIR`, `PI_DIR`, `VENV_DIR`, `GIT_BRANCH` を環境に合わせて修正する

9. サービスと timer を有効化する

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now home-presence-monitor-pi
sudo systemctl enable --now home-presence-monitor-pi-update.timer
```

10. 初回更新を即時実行したい場合は手動で起動する

```sh
sudo systemctl start home-presence-monitor-pi-update.service
```

### 更新の流れ

上記Setupが終われば、自動的に以下の流れで更新がかかります。

- `home-presence-monitor-pi-update.timer` が 30 分ごとに起動
- `scripts/self-update.sh` が `origin/<branch>` を fetch
- 差分があれば `origin/<branch>` に強制追従する
- `services/pi/requirements.txt` を再インストール
- `home-presence-monitor-pi` を再起動

### 確認コマンド

```sh
# ログの確認
journalctl -u home-presence-monitor-pi -f
journalctl -u home-presence-monitor-pi-update.service -n 100 --no-pager

# 状態確認
systemctl status home-presence-monitor-pi
systemctl status home-presence-monitor-pi-update.timer

# 手動再起動
sudo systemctl restart home-presence-monitor-pi
```
