#!/usr/bin/env bash
# Runs ON THE VPS from the deploy workflow, after the repo is synced to
# /opt/pocketbox. Its output is committed back as deploy/last-run.log.
# Pocket Box shares the machine with Box (node, Claude Code, the boxbuild
# user and bubblewrap come from Box's setup) but nothing else: its own
# service, port, data and domain.
set -uo pipefail

APP_DIR=/opt/pocketbox
DATA=$APP_DIR/data
PORT=3401
DOMAIN=agents.cashflowus.com
ENV_FILE=/etc/pocketbox.env
cd "$APP_DIR"
echo "HEAD: $(git rev-parse --short HEAD)   domain: $DOMAIN   port: $PORT"

echo "== prerequisites =="
command -v node >/dev/null || { curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null && apt-get install -y -qq nodejs >/dev/null; }
command -v claude >/dev/null || npm install -g @anthropic-ai/claude-code >/dev/null 2>&1
id boxbuild >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/boxbuild --shell /bin/bash boxbuild
command -v bwrap >/dev/null || apt-get install -y -qq bubblewrap >/dev/null 2>&1 || true
echo "node $(node -v), claude $(claude --version 2>/dev/null | head -1), build user $(id -u boxbuild), bwrap $(command -v bwrap || echo missing)"

echo "== env file =="
clean() { printf '%s' "${1:-}" | tr -d '\r\n'; }
TOKEN=$(printf '%s' "${CLAUDE_CODE_OAUTH_TOKEN:-}" | tr -d '[:space:]')
case "$TOKEN" in sk-ant-oat01-*) ;; "") ;; *) echo "claude token: wrong format, ignored"; TOKEN= ;; esac
{
  printf 'PB_PORT=%s\nPB_DOMAIN=%s\nPB_DATA_DIR=%s\n' "$PORT" "$DOMAIN" "$DATA"
  printf 'PB_HIDE_DIRS=/opt/box/data\n'
  [ -n "$TOKEN" ] && printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' "$TOKEN"
  # Mail, Telegram and the first administrator password reuse Box's secrets.
  for pair in PB_SMTP_HOST:BOX_SMTP_HOST PB_SMTP_PORT:BOX_SMTP_PORT PB_SMTP_USER:BOX_SMTP_USER PB_SMTP_PASS:BOX_SMTP_PASS PB_TELEGRAM_TOKEN:BOX_TELEGRAM_TOKEN PB_TELEGRAM_CHAT_ID:BOX_TELEGRAM_CHAT_ID PB_ADMIN_PASSWORD:BOX_ADMIN_PASSWORD; do
    to=${pair%%:*}; from=${pair##*:}; v=$(clean "${!from:-}")
    # App Passwords are shown with spaces; Gmail wants them without.
    case "$to" in PB_SMTP_PASS|PB_SMTP_HOST|PB_SMTP_PORT|PB_SMTP_USER) v=$(printf '%s' "$v" | tr -d '[:space:]') ;; esac
    v=$(printf '%s' "$v" | tr -d '"$`\\')
    case "$v" in *" "*) [ -n "$v" ] && printf '%s="%s"\n' "$to" "$v" ;; *) [ -n "$v" ] && printf '%s=%s\n' "$to" "$v" ;; esac
  done
  # The sender name is the app's own; the address is the SMTP account.
  SMTP_ADDR=$(printf '%s' "${BOX_SMTP_USER:-}" | tr -d '[:space:]')
  [ -n "$SMTP_ADDR" ] && printf 'PB_MAIL_FROM="Pocket Box <%s>"\n' "$SMTP_ADDR"
} > "$ENV_FILE"
chmod 600 "$ENV_FILE"
echo "keys in $ENV_FILE: $(cut -d= -f1 "$ENV_FILE" | tr '\n' ' ')"

echo "== data =="
mkdir -p "$DATA/work"
# Accounts carry over from Box the first time, so the same sign-in works.
if [ ! -f "$DATA/users.json" ] && [ -f /opt/box/data/users.json ]; then
  cp /opt/box/data/users.json "$DATA/users.json" && echo "accounts: copied from Box ($(node -e "console.log(JSON.parse(require('fs').readFileSync('$DATA/users.json')).length)") user(s))"
fi
# The build user may enter its own agents' repositories and nothing else.
chown root:root "$DATA" "$DATA/work"; chmod 711 "$DATA" "$DATA/work"
find "$DATA" -maxdepth 1 -type f -exec chmod 600 {} +
for d in agents packages keys agent-settings about runs; do [ -d "$DATA/$d" ] && chmod 700 "$DATA/$d"; done
echo "data: $(stat -c '%U %a' "$DATA"), work: $(stat -c '%U %a' "$DATA/work")"

echo "== sandbox =="
if command -v bwrap >/dev/null && sudo -u boxbuild -H bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp --tmpfs "$DATA" --unshare-pid --die-with-parent -- /bin/sh -c "[ -z \"\$(ls -A $DATA)\" ] && ! touch /usr/pb-sandbox-test 2>/dev/null" >/dev/null 2>&1; then
  echo 'PB_BWRAP=1' >> "$ENV_FILE"; echo "bubblewrap: on (read-only system, Pocket Box and Box data hidden, own repo only)"
else
  echo "bubblewrap: OFF — crew isolated by user permissions only"
fi

echo "== service =="
cat > /etc/systemd/system/pocketbox.service <<UNIT
[Unit]
Description=Pocket Box — personal agents, built in the Studio, run on your phone
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v node) $APP_DIR/server.js
Restart=on-failure
RestartSec=3
# Finish the crew's current turn before stopping (up to 15 min); only the
# server gets SIGTERM, its Claude processes are let finish.
KillSignal=SIGTERM
KillMode=mixed
TimeoutStopSec=960

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable pocketbox >/dev/null 2>&1
systemctl restart pocketbox
for i in $(seq 1 20); do curl -s -o /dev/null --max-time 2 "http://localhost:$PORT/api/session" && break; sleep 1; done
echo "service: $(systemctl is-active pocketbox)"
journalctl -u pocketbox -n 6 --no-pager 2>/dev/null | sed 's/^/   /'
echo "local /: HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 8 http://localhost:$PORT/)"
echo "local /runtime: HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 8 http://localhost:$PORT/runtime)"
echo "api without sign-in: HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 8 http://localhost:$PORT/api/agents) (401 = sign-in enforced)"
echo "worker policy: $(curl -s -D - -o /dev/null --max-time 8 http://localhost:$PORT/agent-worker.js | grep -i '^content-security-policy' | tr -d '\r')"
echo "accounts: $(node -e "try{const u=JSON.parse(require('fs').readFileSync('$DATA/users.json'));console.log(u.length+' user(s): '+u.map(x=>x.email+' ('+x.role+', '+x.status+')').join(', '))}catch(e){console.log('none yet')}")"
echo "service sees hidden dirs: $(tr '\0' '\n' < /proc/$(systemctl show -p MainPID --value pocketbox)/environ 2>/dev/null | grep '^PB_HIDE_DIRS=' || echo none)"
echo "mail: $(set -a; . "$ENV_FILE"; set +a; timeout 30 node -e "require('./lib/mail').verify().then(r=>console.log(r.ok?'SMTP login OK as '+process.env.PB_SMTP_USER+' via '+process.env.PB_SMTP_HOST:'NOT working: '+r.error))")"
echo "signing key: $(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$DATA/keys/signing.json')).publicKey.slice(0,16)+'… (Ed25519)')}catch(e){console.log('not created yet')}")"

# Box's port is reachable from the cluster; give Pocket Box's the same treatment.
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q 'Status: active'; then
  ufw status | grep -q "^$PORT" || { ufw status | grep -q '^3400' && ufw allow $PORT/tcp >/dev/null && echo "firewall: opened $PORT like Box's 3400"; }
fi

echo "== route (k3s Traefik) =="
if [ -f /etc/box-kubeconfig ]; then
  K="kubectl --kubeconfig /etc/box-kubeconfig"
  timeout 60 $K apply -f deploy/k8s/agents.yaml 2>&1 | sed 's/^/   /'
  echo "   certificate: $(timeout 20 $K get certificate -n pocketbox --no-headers 2>/dev/null | awk '{print $1" ready="$2}' | tr '\n' ' ')"
else
  echo "no /etc/box-kubeconfig — apply deploy/k8s/agents.yaml on the control plane by hand"
fi

echo "== claude =="
(set -a; . "$ENV_FILE"; set +a; timeout 200 node deploy/check-claude.js 2>&1)
if grep -q '^PB_BWRAP=1' "$ENV_FILE"; then
  mkdir -p "$DATA/work/_check" && chown boxbuild:boxbuild "$DATA/work/_check"
  ARGS=$(set -a; . "$ENV_FILE"; set +a; cd "$APP_DIR" && node -e "console.log(require('./lib/claude').sandboxArgs('$DATA/work/_check','/home/boxbuild').join(' '))")
  echo "claude inside the crew sandbox: $(set -a; . "$ENV_FILE"; set +a; timeout 120 sudo -u boxbuild -H --preserve-env=CLAUDE_CODE_OAUTH_TOKEN,PB_HIDE_DIRS bwrap $ARGS -- claude -p 'Reply with exactly: OK' --model haiku 2>&1 | tail -1)"
  echo "data hidden inside the sandbox: $(sudo -u boxbuild -H bwrap $ARGS -- /bin/sh -c "ls -A $DATA | grep -v work | wc -l; ls -A /opt/box/data 2>/dev/null | wc -l" | tr '\n' ' ')(0 0 = hidden)"
  rm -rf "$DATA/work/_check"
fi

echo "== the domain, as the internet reaches it =="
sleep 5
for i in 1 2 3 4 5 6; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$DOMAIN/" || echo 000)
  [ "$CODE" = 200 ] && break; sleep 10
done
echo "https://$DOMAIN/ -> HTTP $CODE"
echo "https://$DOMAIN/runtime -> HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$DOMAIN/runtime" || echo 000)"
echo "cert -> $(echo | openssl s_client -connect "$DOMAIN:443" -servername "$DOMAIN" 2>/dev/null | openssl x509 -noout -issuer -enddate 2>/dev/null | tr '\n' ' ')"
echo "== done =="
