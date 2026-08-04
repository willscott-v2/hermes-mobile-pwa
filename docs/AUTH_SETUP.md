# Auth setup for Hermes Mobile PWA

Hermes Mobile PWA is meant to connect to the **Hermes web dashboard** API, not the separate OpenAI-compatible API server.

For now, use **username/password dashboard auth**. Token mode is kept as an experimental compatibility hook, but ordinary Hermes dashboard installs do not currently expose a user-generated dashboard token that can replace the login flow for `/api/sessions` + `/api/ws`.

## Recommended: username/password over Tailscale

Use this when the dashboard is reachable from your phone over Tailscale/VPN.

## If you do not know the password

You cannot recover the current dashboard password from Hermes. Hermes stores a password hash, not the original password. Reset it by choosing a new password and replacing the stored hash.

The dashboard basic-auth config usually lives in `~/.hermes/config.yaml` on the Hermes host. If a username is already configured there, keep it; otherwise choose one for your deployment.

### Reset the password in `config.yaml`

Run this on the Hermes host and type a new password when prompted:

```bash
cd ~/.hermes/hermes-agent

read -s -p "New Hermes dashboard password: " HERMES_DASHBOARD_PASSWORD
printf '\n'

HASH=$(python -c "from plugins.dashboard_auth.basic import hash_password; import os; print(hash_password(os.environ['HERMES_DASHBOARD_PASSWORD']))")
SECRET=$(openssl rand -base64 32)
export HASH SECRET

python - <<'PY'
from pathlib import Path
import os
import yaml

config_path = Path.home() / '.hermes' / 'config.yaml'
config = yaml.safe_load(config_path.read_text()) or {}
dashboard = config.setdefault('dashboard', {})
basic = dashboard.setdefault('basic_auth', {})
basic['username'] = basic.get('username') or os.environ.get('HERMES_DASHBOARD_USERNAME', 'admin')
basic['password_hash'] = os.environ['HASH']
basic.pop('password', None)
basic['secret'] = basic.get('secret') or os.environ['SECRET']
config_path.write_text(yaml.safe_dump(config, sort_keys=False))
PY

unset HERMES_DASHBOARD_PASSWORD HASH SECRET
```

Then restart the dashboard process. Use the configured username and the new password in the PWA.


### 1. Choose credentials

Pick a username and strong password. Do not put the raw password in docs, screenshots, or git.

### 2. Add dashboard basic auth to `~/.hermes/.env`

From the Hermes machine:

```bash
cd ~/.hermes/hermes-agent

# Replace this value before running. Avoid shell history for real shared passwords.
read -s -p "Dashboard password: " HERMES_DASHBOARD_PASSWORD
printf '\n'

HASH=$(python -c "from plugins.dashboard_auth.basic import hash_password; import os; print(hash_password(os.environ['HERMES_DASHBOARD_PASSWORD']))")
SECRET=$(openssl rand -base64 32)

cat >> ~/.hermes/.env <<EOF
HERMES_DASHBOARD_BASIC_AUTH_USERNAME=admin
HERMES_DASHBOARD_BASIC_AUTH_PASSWORD_HASH=$HASH
HERMES_DASHBOARD_BASIC_AUTH_SECRET=$SECRET
EOF

chmod 600 ~/.hermes/.env
unset HERMES_DASHBOARD_PASSWORD HASH SECRET
```

Notes:

- `HERMES_DASHBOARD_BASIC_AUTH_USERNAME` activates the bundled `basic` provider.
- `HERMES_DASHBOARD_BASIC_AUTH_PASSWORD_HASH` avoids storing a plaintext password.
- `HERMES_DASHBOARD_BASIC_AUTH_SECRET` signs dashboard session cookies. Keep it stable so logins survive restarts.

### 3. Start the dashboard on a reachable private address

```bash
hermes dashboard --host 0.0.0.0 --port 9119 --no-open
```

A non-loopback bind without `--insecure` engages the auth gate. Keep this behind Tailscale/VPN.

### 4. Verify auth is active

From the Hermes machine or another tailnet device:

```bash
curl -s http://<hermes-tailnet-host>:9119/api/status | jq '.auth_required, .auth_providers'
```

Expected output:

```json
true
[
  "basic"
]
```

If you see:

- `auth_required: false` — the dashboard is probably bound to loopback, or the auth gate did not engage.
- `auth_required: true` but no `"basic"` provider — the env vars did not load or the basic auth plugin is disabled.

### 5. Connect from the PWA

Open the PWA demo URL on your phone, choose **Password**, and enter:

- Hermes URL: `http://<hermes-tailnet-host>:9119`
- Username: the configured username, e.g. `admin`
- Password: your chosen password

The PWA posts to `/auth/password-login`; Hermes sets httpOnly session cookies; the PWA asks `/api/auth/ws-ticket` for a single-use WebSocket ticket before opening `/api/ws`.

## What about tokens?

There are several different token concepts in Hermes, and they are easy to confuse:

1. **Dashboard session cookies / WS tickets** — created automatically after username/password login. This is what the PWA should use.
2. **`API_SERVER_KEY`** — bearer token for the separate OpenAI-compatible API server, usually on port `8642`. It does **not** authenticate the dashboard `/api/sessions` or `/api/ws` endpoints this PWA uses.
3. **Dashboard token providers** — Hermes has a plugin seam for route-specific bearer-token auth, but normal dashboard session/chat routes are not generally driven by a user-minted token today.
4. **Provider API keys** — OpenRouter/OpenAI/etc. model credentials. Never paste these into the PWA.

So for this MVP: **do not use token mode unless you know you have a dashboard-compatible token provider for the exact routes being called.** Use username/password over Tailscale instead.

## Public internet warning

The username/password provider is for trusted networks/VPNs. It is a shared credential with no MFA or per-user controls. For internet-facing deployments, use Nous Portal OAuth or a self-hosted OIDC provider instead of basic auth.
