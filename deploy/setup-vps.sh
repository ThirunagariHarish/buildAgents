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

echo "==> Build sandbox user and tools"
# Build-crew agents (developers, QA, DevOps) run as this unprivileged user,
# which owns only the project work trees under data/work.
if ! id boxbuild >/dev/null 2>&1; then
  sudo useradd --system --create-home --home-dir /home/boxbuild --shell /bin/bash boxbuild
fi
sudo mkdir -p "$BOX_DIR/data/work"
sudo chown boxbuild:boxbuild "$BOX_DIR/data/work"
sudo chmod 755 "$BOX_DIR/data" "$BOX_DIR/data/work"
# Ideas and uploads stay private to Box; the build user can't read them.
sudo mkdir -p "$BOX_DIR/data/ideas" "$BOX_DIR/data/uploads"
sudo chmod 700 "$BOX_DIR/data/ideas" "$BOX_DIR/data/uploads"
sudo corepack enable 2>/dev/null || true
if ! command -v kubectl >/dev/null; then
  curl -fsSL -o /tmp/kubectl "https://dl.k8s.io/release/$(curl -fsSL https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" \
    && sudo install -m 0755 /tmp/kubectl /usr/local/bin/kubectl && rm -f /tmp/kubectl || echo "   kubectl install skipped"
fi
command -v uv >/dev/null || (curl -LsSf https://astral.sh/uv/install.sh | sudo env UV_INSTALL_DIR=/usr/local/bin sh >/dev/null 2>&1 || true)
echo "   build user: $(id boxbuild 2>/dev/null | cut -d' ' -f1); kubectl: $(command -v kubectl || echo missing); pnpm: $(command -v pnpm || echo 'via corepack'); uv: $(command -v uv || echo missing)"

echo "==> Local Postgres for builds and tests"
# Developers and QA get a real database: role boxbuild (peer auth, can create
# databases), DATABASE_URL=postgresql://boxbuild:boxbuild@localhost:5432/<project>_dev
if ! command -v psql >/dev/null; then
  sudo apt-get install -y -qq postgresql >/dev/null 2>&1 || echo "   postgres install skipped"
fi
if command -v psql >/dev/null; then
  sudo systemctl enable --now postgresql >/dev/null 2>&1 || true
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='boxbuild'" 2>/dev/null | grep -q 1 || sudo -u postgres psql -c "CREATE ROLE boxbuild LOGIN CREATEDB" >/dev/null 2>&1
  # Local-only sandbox database; apps connect over TCP, so the role needs a password.
  sudo -u postgres psql -c "ALTER ROLE boxbuild PASSWORD 'boxbuild'" >/dev/null 2>&1
  echo "   postgres: $(psql --version 2>/dev/null | head -1), role boxbuild: $(sudo -u postgres psql -tAc "SELECT rolcreatedb FROM pg_roles WHERE rolname='boxbuild'" 2>/dev/null)"
fi
command -v redis-server >/dev/null || sudo apt-get install -y -qq redis-server >/dev/null 2>&1 || true

echo "==> Checking Claude login"
if (set -a; [ -f /etc/box.env ] && . /etc/box.env; set +a; claude -p "Reply with exactly: OK" --model haiku >/dev/null 2>&1); then
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
# Box finishes the agents' current turns before stopping (up to 15 min).
KillSignal=SIGTERM
TimeoutStopSec=960
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
