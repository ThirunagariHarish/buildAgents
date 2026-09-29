#!/usr/bin/env bash
# Box VPS setup — Ubuntu/Debian. Run as a normal user with sudo rights:
#   bash deploy/setup-vps.sh
set -euo pipefail

BOX_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BOX_USER="$(whoami)"
BOX_PORT="${BOX_PORT:-3400}"

echo "==> Installing Node.js 22 (if missing)"
if ! command -v node >/dev/null || [ "$(node -e 'console.log(process.versions.node.split(".")[0])')" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "==> Installing Claude Code CLI (if missing)"
if ! command -v claude >/dev/null; then
  sudo npm install -g @anthropic-ai/claude-code
fi

echo "==> Checking Claude login"
if claude -p "Reply with exactly: OK" --model haiku >/dev/null 2>&1; then
  echo "   Claude login OK"
else
  cat <<'EOF'
  ⚠ Claude CLI is not logged in yet — Box will start but agents will
    error until you log in. On this VPS run:

      claude setup-token

  and follow the link on your phone/laptop to authorize with your
  Claude (Max) account. Then: sudo systemctl restart box
EOF
fi

echo "==> Installing systemd service (port ${BOX_PORT})"
sudo tee /etc/systemd/system/box.service >/dev/null <<EOF
[Unit]
Description=Box — multi-agent idea refinement room
After=network.target

[Service]
Type=simple
User=${BOX_USER}
WorkingDirectory=${BOX_DIR}
Environment=BOX_PORT=${BOX_PORT}
EnvironmentFile=-/etc/box.env
ExecStart=$(command -v node) ${BOX_DIR}/server.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now box
sleep 1
sudo systemctl --no-pager -l status box | head -8

cat <<EOF

✅ Box is running on port ${BOX_PORT}.

Next steps for phone access:
  - Same network / Tailscale:  open  http://<this-server-ip>:${BOX_PORT}
  - Public internet + HTTPS:   put Caddy or nginx in front, e.g. with Caddy:
        sudo apt install caddy
        echo 'box.yourdomain.com { reverse_proxy localhost:${BOX_PORT} }' | sudo tee /etc/caddy/Caddyfile
        sudo systemctl restart caddy
    ⚠ If you expose Box publicly, protect it (Caddy basic_auth, VPN, or
      Tailscale) — Box itself has no login screen.

Update later with:  cd ${BOX_DIR} && git pull && sudo systemctl restart box
EOF
