#!/usr/bin/env bash
# Runs ON THE VPS from the deploy workflow, after the repo is synced to
# /opt/scenario. Its output is committed back as deploy/last-run.log.
# Run Scenario shares the machine with Box and Pocket Box (node and Claude
# Code come from there) but has its own service, port, data and domain.
set -uo pipefail

APP_DIR=/opt/scenario
DATA=$APP_DIR/data
PORT=3402
DOMAIN=scenario.cashflowus.com
ENV_FILE=/etc/scenario.env
VENV=/opt/scenario-venv
cd "$APP_DIR"
echo "HEAD: $(git rev-parse --short HEAD)   domain: $DOMAIN   port: $PORT"

echo "== prerequisites =="
command -v node >/dev/null || { curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null && apt-get install -y -qq nodejs >/dev/null; }
command -v claude >/dev/null || npm install -g @anthropic-ai/claude-code >/dev/null 2>&1
echo "node $(node -v), claude $(claude --version 2>/dev/null | head -1), python $(python3 --version 2>/dev/null || echo missing)"
echo "machine: $(nproc) CPUs, $(free -m | awk '/Mem:/{print $2" MB RAM, "$7" MB available"}'), disk free $(df -h /opt | awk 'NR==2{print $4}')"

echo "== env file =="
clean() { printf '%s' "${1:-}" | tr -d '\r\n'; }
TOKEN=$(printf '%s' "${CLAUDE_CODE_OAUTH_TOKEN:-}" | tr -d '[:space:]')
case "$TOKEN" in sk-ant-oat01-*) ;; "") ;; *) echo "claude token: wrong format, ignored"; TOKEN= ;; esac
{
  printf 'SC_PORT=%s\nSC_DOMAIN=%s\nSC_DATA_DIR=%s\nSC_PYTHON=%s\n' "$PORT" "$DOMAIN" "$DATA" "$VENV/bin/python"
  [ -n "$TOKEN" ] && printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' "$TOKEN"
  # Mail and the first administrator password reuse Box's secrets.
  for pair in SC_SMTP_HOST:BOX_SMTP_HOST SC_SMTP_PORT:BOX_SMTP_PORT SC_SMTP_USER:BOX_SMTP_USER SC_SMTP_PASS:BOX_SMTP_PASS SC_ADMIN_PASSWORD:BOX_ADMIN_PASSWORD; do
    to=${pair%%:*}; from=${pair##*:}; v=$(clean "${!from:-}")
    case "$to" in SC_SMTP_*) v=$(printf '%s' "$v" | tr -d '[:space:]') ;; esac
    v=$(printf '%s' "$v" | tr -d '"$`\\')
    case "$v" in *" "*) [ -n "$v" ] && printf '%s="%s"\n' "$to" "$v" ;; *) [ -n "$v" ] && printf '%s=%s\n' "$to" "$v" ;; esac
  done
  # Optional data keys, each on when its GitHub secret exists.
  for k in FRED_KEY REDDIT_ID REDDIT_SECRET X_BEARER STOOQ_KEY; do
    from=SCENARIO_$k; v=$(clean "${!from:-}" | tr -d '[:space:]"$`\\')
    if [ -n "$v" ]; then printf 'SC_%s=%s\n' "$k" "$v"; fi
  done
  SMTP_ADDR=$(printf '%s' "${BOX_SMTP_USER:-}" | tr -d '[:space:]')
  [ -n "$SMTP_ADDR" ] && printf 'SC_MAIL_FROM="Run Scenario <%s>"\n' "$SMTP_ADDR"
} > "$ENV_FILE"
chmod 600 "$ENV_FILE"
echo "keys in $ENV_FILE: $(cut -d= -f1 "$ENV_FILE" | tr '\n' ' ')"

echo "== data =="
mkdir -p "$DATA"
# The same sign-in as Pocket Box: accounts are copied the first time.
if [ ! -f "$DATA/users.json" ]; then
  for src in /opt/pocketbox/data/users.json /opt/box/data/users.json; do
    [ -f "$src" ] && cp "$src" "$DATA/users.json" && echo "accounts: copied from $src" && break
  done
fi
chown root:root "$DATA"; chmod 700 "$DATA"
find "$DATA" -maxdepth 1 -type f -exec chmod 600 {} +
echo "accounts: $(node -e "try{const u=JSON.parse(require('fs').readFileSync('$DATA/users.json'));console.log(u.length+' user(s): '+u.map(x=>x.email+' ('+x.role+(x.primary?', owner':'')+', '+x.status+')').join(', '))}catch(e){console.log('none yet')}")"
echo "scenarios: $(ls "$DATA/scenarios" 2>/dev/null | grep -c '\.json$')"

echo "== service =="
cat > /etc/systemd/system/scenario.service <<UNIT
[Unit]
Description=Run Scenario — market claims tested against data every day
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
systemctl enable scenario >/dev/null 2>&1
systemctl restart scenario
for i in $(seq 1 20); do curl -s -o /dev/null --max-time 2 "http://localhost:$PORT/api/session" && break; sleep 1; done
echo "service: $(systemctl is-active scenario)"
journalctl -u scenario -n 5 --no-pager 2>/dev/null | sed 's/^/   /'
echo "local /: HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 8 http://localhost:$PORT/)"
echo "api without sign-in: HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 8 http://localhost:$PORT/api/scenarios) (401 = sign-in enforced)"
echo "mail: $(set -a; . "$ENV_FILE"; set +a; timeout 30 node -e "require('./lib/mail').verify().then(r=>console.log(r.ok?'SMTP login OK':'NOT working: '+r.error))")"

if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q 'Status: active'; then
  ufw status | grep -q "^$PORT" || { ufw status | grep -qE '^(3400|3401)' && ufw allow $PORT/tcp >/dev/null && echo "firewall: opened $PORT like Pocket Box"; }
fi

echo "== data sources, as this server reaches them =="
(set -a; . "$ENV_FILE"; set +a; timeout 240 node -e "require('./lib/data').probe().then(r=>r.forEach(x=>console.log('   '+(x.ok?'OK  ':'FAIL')+' '+x.name.padEnd(14)+' '+x.detail+' ('+x.ms+' ms)')))")

echo "== Hugging Face models =="
if [ -f "$DATA/models-ready" ]; then
  echo "ready: $(cat "$DATA/models-ready")"
elif pgrep -f install-models.sh >/dev/null; then
  echo "installing (started earlier): $(tail -2 /var/log/scenario-models.log 2>/dev/null | tr '\n' ' ')"
else
  MEM=$(free -m | awk '/Mem:/{print $2}'); DISK=$(df -BG /opt | awk 'NR==2{gsub("G","",$4); print $4}')
  if [ "${MEM:-0}" -ge 1800 ] && [ "${DISK:-0}" -ge 6 ]; then
    [ -f /var/log/scenario-models.log ] && echo "last attempt: $(tail -2 /var/log/scenario-models.log | tr '\n' ' ')"
    if [ ! -f "$DATA/models-tried-$(git rev-parse --short HEAD)" ]; then
      setsid nohup bash "$APP_DIR/deploy/install-models.sh" >> /var/log/scenario-models.log 2>&1 < /dev/null &
      touch "$DATA/models-tried-$(git rev-parse --short HEAD)"
      echo "installing in the background (torch CPU + chronos + transformers, a few minutes); the desk uses them once ready"
    fi
  else
    echo "skipped: needs 1.8 GB RAM and 6 GB disk (have ${MEM} MB, ${DISK} GB); the desk uses its own simulation and word list"
  fi
fi

echo "== raw samples of free sources =="
timeout 400 node deploy/peek.js

echo "== desk smoke test (live data, no Claude) =="
(set -a; . "$ENV_FILE"; set +a; timeout 300 node deploy/smoke.js)

echo "== route (k3s Traefik) =="
if [ -f /etc/box-kubeconfig ]; then
  K="kubectl --kubeconfig /etc/box-kubeconfig"
  timeout 60 $K apply -f deploy/k8s/scenario.yaml 2>&1 | sed 's/^/   /'
  sleep 3
  echo "   certificate: $(timeout 20 $K get certificate -n scenario --no-headers 2>/dev/null | awk '{print $1" ready="$2}' | tr '\n' ' ')"
else
  echo "no /etc/box-kubeconfig — apply deploy/k8s/scenario.yaml on the control plane by hand"
fi

echo "== claude =="
(set -a; . "$ENV_FILE"; set +a; timeout 120 node -e "require('./lib/claude').askClaude({prompt:'Reply with exactly: OK',system:'Connectivity check.',model:'haiku',timeoutMs:100000}).then(r=>console.log('haiku: '+r.text.trim().slice(0,20)+' ('+Math.round(r.durationMs/1000)+'s)')).catch(e=>console.log('FAILED: '+e.message))")

echo "== the domain, as the internet reaches it =="
echo "DNS: $DOMAIN -> $(getent hosts $DOMAIN | awk '{print $1}' | tr '\n' ' ')(agents.cashflowus.com -> $(getent hosts agents.cashflowus.com | awk '{print $1}' | tr '\n' ' '))"
sleep 5
for i in 1 2 3 4 5 6 7 8; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$DOMAIN/" || echo 000)
  [ "$CODE" = 200 ] && break; sleep 10
done
echo "https://$DOMAIN/ -> HTTP $CODE"
echo "cert -> $(echo | openssl s_client -connect "$DOMAIN:443" -servername "$DOMAIN" 2>/dev/null | openssl x509 -noout -issuer -enddate 2>/dev/null | tr '\n' ' ')"
echo "== done =="
