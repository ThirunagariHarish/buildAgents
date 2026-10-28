#!/usr/bin/env bash
# Runs ON THE VPS from the deploy workflow, after the repo is synced to
# /opt/jot. Its output is committed back as deploy/last-run.log (public, so
# addresses are masked and no key is ever printed).
# Jot shares the machine with Box, Reinvent and Run Scenario (node and Claude
# Code come from there) but has its own service, port, data and domain.
set -uo pipefail

APP_DIR=/opt/jot
DATA=$APP_DIR/data
PORT=3404
DOMAIN=jot.cashflowus.com
ENV_FILE=/etc/jot.env
cd "$APP_DIR"
echo "HEAD: $(git rev-parse --short HEAD)   domain: $DOMAIN   port: $PORT"

echo "== prerequisites =="
command -v node >/dev/null || { curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null && apt-get install -y -qq nodejs >/dev/null; }
command -v claude >/dev/null || npm install -g @anthropic-ai/claude-code >/dev/null 2>&1
echo "node $(node -v), claude $(claude --version 2>/dev/null | head -1)"

echo "== env file =="
clean() { printf '%s' "${1:-}" | tr -d '\r\n'; }
TOKEN=$(printf '%s' "${CLAUDE_CODE_OAUTH_TOKEN:-}" | tr -d '[:space:]')
case "$TOKEN" in sk-ant-oat01-*) ;; "") ;; *) echo "claude token: wrong format, ignored"; TOKEN= ;; esac
{
  printf 'JT_PORT=%s\nJT_DOMAIN=%s\nJT_DATA_DIR=%s\n' "$PORT" "$DOMAIN" "$DATA"
  [ -n "$TOKEN" ] && printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' "$TOKEN"
  # Mail and the first administrator password reuse Box's secrets.
  for pair in JT_SMTP_HOST:BOX_SMTP_HOST JT_SMTP_PORT:BOX_SMTP_PORT JT_SMTP_USER:BOX_SMTP_USER JT_SMTP_PASS:BOX_SMTP_PASS JT_ADMIN_PASSWORD:BOX_ADMIN_PASSWORD; do
    to=${pair%%:*}; from=${pair##*:}; v=$(clean "${!from:-}")
    case "$to" in JT_SMTP_*) v=$(printf '%s' "$v" | tr -d '[:space:]') ;; esac
    v=$(printf '%s' "$v" | tr -d '"$`\\')
    case "$v" in *" "*) printf '%s="%s"\n' "$to" "$v" ;; ?*) printf '%s=%s\n' "$to" "$v" ;; esac
  done
  SMTP_ADDR=$(printf '%s' "${BOX_SMTP_USER:-}" | tr -d '[:space:]')
  [ -n "$SMTP_ADDR" ] && printf 'JT_MAIL_FROM="Jot <%s>"\nJT_PUSH_CONTACT=mailto:%s\n' "$SMTP_ADDR" "$SMTP_ADDR"
} > "$ENV_FILE"
chmod 600 "$ENV_FILE"
echo "keys in $ENV_FILE: $(cut -d= -f1 "$ENV_FILE" | tr '\n' ' ')"

echo "== data =="
mkdir -p "$DATA"
# The owner signs in with the same password as in the other apps: only the
# owner's account is copied, never anyone else's.
if [ ! -f "$DATA/users.json" ]; then
  for src in /opt/reinvent/data/users.json /opt/pocketbox/data/users.json /opt/box/data/users.json; do
    [ -f "$src" ] || continue
    node -e "
      const fs=require('fs');const e=(process.env.JT_ADMIN_EMAIL||require('$APP_DIR/lib/auth').ADMIN_EMAIL).toLowerCase();
      const me=JSON.parse(fs.readFileSync('$src')).find(x=>x.email===e&&x.hash);
      if(!me)process.exit(1);
      const keep={id:me.id,email:me.email,firstName:me.firstName,lastName:me.lastName||'',phone:'',role:'admin',primary:true,status:'approved',createdAt:Date.now(),approvedAt:Date.now(),salt:me.salt,hash:me.hash};
      fs.writeFileSync('$DATA/users.json',JSON.stringify([keep],null,1),{mode:0o600});" && echo "accounts: the owner's sign-in copied from $src" && break
  done
fi
chown root:root "$DATA"; chmod 700 "$DATA"
find "$DATA" -maxdepth 1 -type f -exec chmod 600 {} +
echo "accounts: $(node -e "try{const u=JSON.parse(require('fs').readFileSync('$DATA/users.json'));console.log(u.length+' user(s): '+u.slice(0,12).map(x=>x.email.replace(/^([^@]{1,2})[^@]*@/,'\$1***@')+' ('+x.role+(x.primary?', owner':'')+', '+x.status+(x.plan?', '+x.plan:'')+')').join(', ')+(u.length>12?' ...':''))}catch(e){console.log('none yet')}")"
echo "jots: $(node -e "const fs=require('fs'),d='$DATA/notes';let t=0,p=0;try{for(const f of fs.readdirSync(d)){const b=JSON.parse(fs.readFileSync(d+'/'+f));t+=b.length;p++}}catch{}console.log(t+' from '+p+' people')")"
echo "settings: $(node -e "try{const s=JSON.parse(require('fs').readFileSync('$DATA/settings.json'));console.log('access '+s.access+', price '+s.priceCents+' '+s.currency)}catch(e){console.log('defaults (access open)')}")"
echo "keys set in Admin: $(node -e "try{const s=JSON.parse(require('fs').readFileSync('$DATA/secrets.json'));console.log(Object.keys(s).join(', ')||'none')}catch(e){console.log('none')}")"

echo "== service =="
cat > /etc/systemd/system/jot.service <<UNIT
[Unit]
Description=Jot - text it once, find it any time
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v node) $APP_DIR/server.js
Restart=on-failure
RestartSec=3
KillMode=mixed
TimeoutStopSec=15

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable jot >/dev/null 2>&1
systemctl restart jot
for i in $(seq 1 20); do curl -s -o /dev/null --max-time 2 "http://localhost:$PORT/api/public" && break; sleep 1; done
echo "service: $(systemctl is-active jot)"
journalctl -u jot -n 8 --no-pager 2>/dev/null | grep -v 'reset/' | sed 's/^/   /'
journalctl -u jot -n 40 --no-pager 2>/dev/null | grep -q 'reset/' && echo "   (a one-time set-password link for the owner is in the server log: journalctl -u jot | grep reset)"
echo "local /: HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 8 http://localhost:$PORT/)"
echo "api without sign-in: HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 8 http://localhost:$PORT/api/notes) (401 = sign-in enforced)"
echo "public: $(curl -s --max-time 8 http://localhost:$PORT/api/public)"
echo "mail: $(set -a; . "$ENV_FILE"; set +a; timeout 30 node -e "require('./lib/mail').verify().then(r=>console.log(r.ok?'SMTP login OK':'NOT working: '+r.error))")"
(set -a; . "$ENV_FILE"; set +a; timeout 30 node deploy/mail-check.js JT "$DATA/mail-log.jsonl") || true

if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q 'Status: active'; then
  ufw status | grep -q "^$PORT" || { ufw status | grep -qE '^(3400|3401|3402|3403)' && ufw allow $PORT/tcp >/dev/null && echo "firewall: opened $PORT like the other apps"; }
fi

echo "== outside services, as this server reaches them =="
echo "Telegram API: HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 10 https://api.telegram.org/)"
echo "Twilio API: HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 10 https://api.twilio.com/)"
echo "Stripe API: HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 10 https://api.stripe.com/v1/)"

echo "== speech (shared with Run Scenario) =="
if [ -x /opt/scenario-venv/bin/python ] && [ -f /opt/scenario/models/sidecar.py ]; then
  echo "speech model: installed ($( [ -f /opt/scenario/data/speech-ready ] && echo 'warmed up' || echo 'not warmed up yet: the first recording takes longer'))"
else
  echo "speech model: not installed; phones that dictate by themselves still work"
fi
command -v ffmpeg >/dev/null || timeout 300 apt-get install -y -qq ffmpeg >/dev/null 2>&1 || true
echo "ffmpeg (Telegram voice notes): $(command -v ffmpeg >/dev/null && ffmpeg -version 2>/dev/null | head -1 | cut -c1-40 || echo missing)"

echo "== route (k3s Traefik) =="
if [ -f /etc/box-kubeconfig ]; then
  K="kubectl --kubeconfig /etc/box-kubeconfig"
  timeout 60 $K apply -f deploy/k8s/jot.yaml 2>&1 | sed 's/^/   /'
  sleep 3
  echo "   certificate: $(timeout 20 $K get certificate -n jot --no-headers 2>/dev/null | awk '{print $1" ready="$2}' | tr '\n' ' ')"
else
  echo "no /etc/box-kubeconfig - apply deploy/k8s/jot.yaml on the control plane by hand"
fi

echo "== claude =="
(set -a; . "$ENV_FILE"; set +a; timeout 120 node -e "require('./lib/claude').askClaude({prompt:'Reply with exactly: OK',system:'Connectivity check.',model:'haiku',timeoutMs:100000}).then(r=>console.log('haiku: '+r.text.trim().slice(0,20)+' ('+Math.round(r.durationMs/1000)+'s)')).catch(e=>console.log('FAILED: '+e.message))")

echo "== the domain, as the internet reaches it =="
echo "DNS: $DOMAIN -> $(getent hosts $DOMAIN | awk '{print $1}' | tr '\n' ' ')"
sleep 5
for i in $(seq 1 18); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$DOMAIN/" || echo 000)
  [ "$CODE" = 200 ] && break; sleep 10
done
echo "https://$DOMAIN/ -> HTTP $CODE"
echo "cert -> $(echo | openssl s_client -connect "$DOMAIN:443" -servername "$DOMAIN" 2>/dev/null | openssl x509 -noout -issuer -enddate 2>/dev/null | tr '\n' ' ')"
echo "== done =="
