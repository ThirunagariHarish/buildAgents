#!/usr/bin/env bash
# Runs ON THE VPS from the deploy workflow, after the repo is synced to
# /opt/reinvent. Its output is committed back as deploy/last-run.log.
# Reinvent shares the machine with Box, Pocket Box and Run Scenario (node and
# Claude Code come from there) but has its own service, port, data and domain.
set -uo pipefail

APP_DIR=/opt/reinvent
DATA=$APP_DIR/data
PORT=3403
DOMAIN=reinvent.cashflowus.com
ENV_FILE=/etc/reinvent.env
cd "$APP_DIR"
echo "HEAD: $(git rev-parse --short HEAD)   domain: $DOMAIN   port: $PORT"

echo "== prerequisites =="
command -v node >/dev/null || { curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null && apt-get install -y -qq nodejs >/dev/null; }
command -v claude >/dev/null || npm install -g @anthropic-ai/claude-code >/dev/null 2>&1
echo "node $(node -v), claude $(claude --version 2>/dev/null | head -1)"
echo "machine: $(nproc) CPUs, $(free -m | awk '/Mem:/{print $2" MB RAM, "$7" MB available"}'), disk free $(df -h /opt | awk 'NR==2{print $4}')"

echo "== env file =="
clean() { printf '%s' "${1:-}" | tr -d '\r\n'; }
TOKEN=$(printf '%s' "${CLAUDE_CODE_OAUTH_TOKEN:-}" | tr -d '[:space:]')
case "$TOKEN" in sk-ant-oat01-*) ;; "") ;; *) echo "claude token: wrong format, ignored"; TOKEN= ;; esac
{
  printf 'RV_PORT=%s\nRV_DOMAIN=%s\nRV_DATA_DIR=%s\n' "$PORT" "$DOMAIN" "$DATA"
  [ -n "$TOKEN" ] && printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' "$TOKEN"
  # Mail and the first administrator password reuse Box's secrets.
  for pair in RV_SMTP_HOST:BOX_SMTP_HOST RV_SMTP_PORT:BOX_SMTP_PORT RV_SMTP_USER:BOX_SMTP_USER RV_SMTP_PASS:BOX_SMTP_PASS RV_ADMIN_PASSWORD:BOX_ADMIN_PASSWORD; do
    to=${pair%%:*}; from=${pair##*:}; v=$(clean "${!from:-}")
    case "$to" in RV_SMTP_*) v=$(printf '%s' "$v" | tr -d '[:space:]') ;; esac
    v=$(printf '%s' "$v" | tr -d '"$`\\')
    case "$v" in *" "*) printf '%s="%s"\n' "$to" "$v" ;; ?*) printf '%s=%s\n' "$to" "$v" ;; esac
  done
  SMTP_ADDR=$(printf '%s' "${BOX_SMTP_USER:-}" | tr -d '[:space:]')
  [ -n "$SMTP_ADDR" ] && printf 'RV_MAIL_FROM="Reinvent <%s>"\n' "$SMTP_ADDR"
} > "$ENV_FILE"
chmod 600 "$ENV_FILE"
echo "keys in $ENV_FILE: $(cut -d= -f1 "$ENV_FILE" | tr '\n' ' ')"

echo "== data =="
mkdir -p "$DATA"
# The same sign-in as the other apps: accounts are copied the first time.
if [ ! -f "$DATA/users.json" ]; then
  for src in /opt/pocketbox/data/users.json /opt/scenario/data/users.json /opt/box/data/users.json; do
    [ -f "$src" ] && cp "$src" "$DATA/users.json" && echo "accounts: copied from $src" && break
  done
fi
chown root:root "$DATA"; chmod 700 "$DATA"
find "$DATA" -maxdepth 1 -type f -exec chmod 600 {} +
echo "accounts: $(node -e "try{const u=JSON.parse(require('fs').readFileSync('$DATA/users.json'));console.log(u.length+' user(s): '+u.map(x=>x.email.replace(/^([^@]{1,2})[^@]*@/,'\$1***@')+' ('+x.role+(x.primary?', owner':'')+', '+x.status+')').join(', '))}catch(e){console.log('none yet')}")"
echo "products so far: $(ls "$DATA/posts" 2>/dev/null | grep -c '\.json$')"

echo "== service =="
cat > /etc/systemd/system/reinvent.service <<UNIT
[Unit]
Description=Reinvent - everyday products reinvented by AI agents
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v node) $APP_DIR/server.js
Restart=on-failure
RestartSec=3
KillMode=mixed
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable reinvent >/dev/null 2>&1
systemctl restart reinvent
for i in $(seq 1 20); do curl -s -o /dev/null --max-time 2 "http://localhost:$PORT/api/session" && break; sleep 1; done
echo "service: $(systemctl is-active reinvent)"
journalctl -u reinvent -n 6 --no-pager 2>/dev/null | sed 's/^/   /'
echo "local /: HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 8 http://localhost:$PORT/)"
echo "api without sign-in: HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 8 http://localhost:$PORT/api/feed) (401 = sign-in enforced)"
echo "mail: $(set -a; . "$ENV_FILE"; set +a; timeout 30 node -e "require('./lib/mail').verify().then(r=>console.log(r.ok?'SMTP login OK':'NOT working: '+r.error))")"
(set -a; . "$ENV_FILE"; set +a; timeout 30 node deploy/mail-check.js RV "$DATA/mail-log.jsonl") || true

if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q 'Status: active'; then
  ufw status | grep -q "^$PORT" || { ufw status | grep -qE '^(3400|3401|3402)' && ufw allow $PORT/tcp >/dev/null && echo "firewall: opened $PORT like the other apps"; }
fi

echo "== product photos, as this server reaches them =="
echo "Wikimedia Commons: HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 10 'https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=kettle&format=json')"

echo "== route (k3s Traefik) =="
if [ -f /etc/box-kubeconfig ]; then
  K="kubectl --kubeconfig /etc/box-kubeconfig"
  timeout 60 $K apply -f deploy/k8s/reinvent.yaml 2>&1 | sed 's/^/   /'
  sleep 3
  echo "   certificate: $(timeout 20 $K get certificate -n reinvent --no-headers 2>/dev/null | awk '{print $1" ready="$2}' | tr '\n' ' ')"
else
  echo "no /etc/box-kubeconfig - apply deploy/k8s/reinvent.yaml on the control plane by hand"
fi

echo "== claude =="
(set -a; . "$ENV_FILE"; set +a; timeout 120 node -e "require('./lib/claude').askClaude({prompt:'Reply with exactly: OK',system:'Connectivity check.',model:'haiku',timeoutMs:100000}).then(r=>console.log('haiku: '+r.text.trim().slice(0,20)+' ('+Math.round(r.durationMs/1000)+'s)')).catch(e=>console.log('FAILED: '+e.message))")

echo "== studio =="
node -e "try{const s=JSON.parse(require('fs').readFileSync('$DATA/settings.json'));console.log('every '+s.intervalMin+' min, '+(s.paused?'paused':'running')+', last run '+(s.lastRunAt?new Date(s.lastRunAt).toISOString():'never')+(s.holdUntil>Date.now()?', on hold until '+new Date(s.holdUntil).toISOString():''))}catch(e){console.log('defaults (first product about 20 seconds after start)')}"

echo "== the domain, as the internet reaches it =="
echo "DNS: $DOMAIN -> $(getent hosts $DOMAIN | awk '{print $1}' | tr '\n' ' ')"
sleep 5
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$DOMAIN/" || echo 000)
  [ "$CODE" = 200 ] && break; sleep 10
done
echo "https://$DOMAIN/ -> HTTP $CODE"
echo "cert -> $(echo | openssl s_client -connect "$DOMAIN:443" -servername "$DOMAIN" 2>/dev/null | openssl x509 -noout -issuer -enddate 2>/dev/null | tr '\n' ' ')"
echo "== done =="
