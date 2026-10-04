#!/usr/bin/env bash
# Runs ON THE VPS from the deploy workflow (after the repo is synced).
# Its full output is committed back to the branch as deploy/last-run.log.
set -uo pipefail

APP_DIR=/opt/box
DOMAIN="${BOX_DOMAIN:-box.cashflowus.com}"
cd "$APP_DIR"
echo "HEAD: $(git rev-parse --short HEAD)   domain: $DOMAIN"

echo "== env file =="
CLAUDE_CODE_OAUTH_TOKEN=$(printf '%s' "${CLAUDE_CODE_OAUTH_TOKEN:-}" | tr -d '[:space:]')
if [ -n "$CLAUDE_CODE_OAUTH_TOKEN" ]; then
  case "$CLAUDE_CODE_OAUTH_TOKEN" in
    sk-ant-oat01-*) echo "claude token: looks valid (length ${#CLAUDE_CODE_OAUTH_TOKEN})" ;;
    *) echo "claude token: WRONG FORMAT (length ${#CLAUDE_CODE_OAUTH_TOKEN}) — ignoring it so the server's own 'claude /login' is used instead"
       CLAUDE_CODE_OAUTH_TOKEN= ;;
  esac
fi
REQUIRE_LOGIN=true   # false turns the sign-in screen off
BOX_GITHUB_TOKEN=$(printf '%s' "${BOX_GITHUB_TOKEN:-}" | tr -d '[:space:]')
{
  [ "$REQUIRE_LOGIN" = true ] && [ -n "${BOX_PASSWORD:-}" ] && printf 'BOX_PASSWORD=%s\n' "$BOX_PASSWORD"
  [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] && printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' "$CLAUDE_CODE_OAUTH_TOKEN"
  [ -n "$BOX_GITHUB_TOKEN" ] && printf 'BOX_GITHUB_TOKEN=%s\n' "$BOX_GITHUB_TOKEN"
  [ -n "${BOX_TELEGRAM_TOKEN:-}" ] && printf 'BOX_TELEGRAM_TOKEN=%s\n' "$(printf '%s' "$BOX_TELEGRAM_TOKEN" | tr -d '[:space:]')"
  [ -n "${BOX_TELEGRAM_CHAT_ID:-}" ] && printf 'BOX_TELEGRAM_CHAT_ID=%s\n' "$(printf '%s' "$BOX_TELEGRAM_CHAT_ID" | tr -d '[:space:]')"
  for k in BOX_SMTP_HOST BOX_SMTP_PORT BOX_SMTP_USER BOX_SMTP_PASS BOX_MAIL_FROM BOX_ADMIN_PASSWORD; do
    v=$(printf '%s' "${!k:-}" | tr -d '\r\n'); [ -n "$v" ] && printf '%s=%s\n' "$k" "$v"
  done
  printf 'BOX_DOMAIN=%s\n' "$DOMAIN"
} > /etc/box.env
chmod 600 /etc/box.env
echo "keys in /etc/box.env: $(cut -d= -f1 /etc/box.env 2>/dev/null | tr '\n' ' ')"
# Cluster access for deploying projects: the BOX_KUBECONFIG secret holds the
# kubeconfig, raw or base64-encoded.
if [ -n "${BOX_KUBECONFIG:-}" ]; then
  if printf '%s' "$BOX_KUBECONFIG" | grep -q 'apiVersion'; then
    printf '%s\n' "$BOX_KUBECONFIG" > /etc/box-kubeconfig
  else
    printf '%s' "$BOX_KUBECONFIG" | tr -d '[:space:]' | base64 -d > /etc/box-kubeconfig 2>/dev/null || echo "kubeconfig: could not decode BOX_KUBECONFIG"
  fi
  chmod 600 /etc/box-kubeconfig
  echo "kubeconfig: written ($(wc -c < /etc/box-kubeconfig) bytes)"
else
  echo "kubeconfig: no BOX_KUBECONFIG secret (projects can be built but not deployed)"
fi
echo "github token: $([ -n "$BOX_GITHUB_TOKEN" ] && echo "set (length ${#BOX_GITHUB_TOKEN})" || echo 'none (projects can be built but not deployed)')"

echo "== box service =="
bash deploy/setup-vps.sh 2>&1 | grep -E '==>|⚠|OK|bubblewrap' || true
# Enable the bubblewrap sandbox only if it works for the build user here (after setup loaded its profile).
if command -v bwrap >/dev/null && sudo -u boxbuild -H bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp --tmpfs /opt/box/data --unshare-pid --die-with-parent -- /bin/sh -c '[ -z "$(ls -A /opt/box/data)" ] && ! touch /usr/box-sandbox-test 2>/dev/null' >/dev/null 2>&1; then
  grep -q '^BOX_BWRAP=1' /etc/box.env || echo 'BOX_BWRAP=1' >> /etc/box.env
fi
systemctl restart box
sleep 2
echo "service: $(systemctl is-active box)"
echo "local /: HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 8 http://localhost:3400/)"
# A short-lived administrator session for the checks below (removed at the end).
CHECK_TOKEN=$(node -e "const a=require('./lib/auth');a.ensureAdmin();const u=a.admins()[0];console.log(a.createSession(u,'deploy-check'))" 2>/dev/null)
COOKIE="box_session=${CHECK_TOKEN}"
echo "api without sign-in: HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 8 http://localhost:3400/api/ideas) (401 = sign-in enforced)"
echo "accounts: $(node -e "try{const u=JSON.parse(require('fs').readFileSync('data/users.json'));console.log(u.length+' user(s): '+u.map(x=>x.email+' ('+x.role+', '+x.status+')').join(', '))}catch(e){console.log('none yet')}")"
echo "mail: $([ -n "${BOX_SMTP_HOST:-}" ] && echo "SMTP via ${BOX_SMTP_HOST}" || echo 'not configured (approval links shown in the app instead)')"
echo "security headers: $(curl -s -D - -o /dev/null --max-time 8 http://localhost:3400/ | grep -ciE 'content-security-policy|x-frame-options|x-content-type') of 3"
echo "agent pool: $(curl -s --max-time 8 -H "Cookie: $COOKIE" http://localhost:3400/api/agents | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const l=JSON.parse(d);console.log(l.length+' agents — '+l.map(a=>a.name+(a.builtin?'':' (added)')).join(', '))}catch(e){console.log('unreadable: '+d.slice(0,120))}})")"

echo "== build crew =="
echo "crew: $(curl -s --max-time 8 -H "Cookie: $COOKIE" http://localhost:3400/api/crew | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const l=JSON.parse(d);console.log(l.map(a=>a.name).join(', '))}catch(e){console.log('unreadable')}})")"
echo "build user: $(id boxbuild 2>/dev/null || echo missing)"
echo "work dir: $(stat -c "%U %a" data/work 2>/dev/null); ideas dir: $(stat -c "%U %a" data/ideas 2>/dev/null) (700 = private to Box)"
echo "postgres: $(sudo -u postgres psql -tAc "select version()" 2>&1 | head -c 60 || echo missing)"
echo "tools: node $(node -v 2>/dev/null), pnpm $(sudo -u boxbuild -H bash -lc 'pnpm -v' 2>/dev/null || echo missing), kubectl $(kubectl version --client 2>/dev/null | head -1 || echo missing), uv $(uv --version 2>/dev/null || echo missing), docker $(docker --version 2>/dev/null | cut -d, -f1 || echo missing)"
if [ -f /etc/box-kubeconfig ]; then
  echo "cluster: $(timeout 20 kubectl --kubeconfig /etc/box-kubeconfig get nodes --no-headers 2>&1 | awk '{print $1":"$2}' | tr '\n' ' ')"
fi
echo "sandbox: $(grep -q '^BOX_BWRAP=1' /etc/box.env && echo 'bubblewrap on (read-only system, own repo only)' || echo "bubblewrap OFF — agents are isolated by user permissions only; bwrap: $(command -v bwrap || echo 'not installed'); test said: $(sudo -u boxbuild -H bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp --tmpfs /opt/box/data --unshare-pid --die-with-parent -- /bin/sh -c 'ls -A /opt/box/data | wc -l' 2>&1 | head -2 | tr '\n' ' ')")"
echo "claude as build user: $(set -a; . /etc/box.env 2>/dev/null; set +a; timeout 120 sudo -u boxbuild -H --preserve-env=CLAUDE_CODE_OAUTH_TOKEN claude -p 'Reply with exactly: OK' --model haiku 2>&1 | tail -1)"

echo "== notifications =="
echo "push: $(curl -s --max-time 8 -H "Cookie: $COOKIE" http://localhost:3400/api/push/key | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log('vapid key '+(j.publicKey?'ready':'missing')+', devices subscribed: '+j.devices+', needs you: '+j.needsYou)}catch(e){console.log('unreadable')}})")"

echo "== wildcard DNS (*.cashflowus.com) =="
probe="dns-check-$(date +%s).cashflowus.com"
ip=$(getent hosts "$probe" | awk '{print $1}' | head -1)
echo "${probe} -> ${ip:-does not resolve (wildcard record not added yet)}"
echo "box login: $([ -n "$(grep -s '^BOX_PASSWORD=' /etc/box.env)" ] && echo on || echo 'off (no BOX_PASSWORD secret)')"

echo "== latest layout reports from phones =="
cat data/diag.json 2>/dev/null | head -c 3000 || echo "(none yet)"
echo
echo "== claude login =="
(set -a; . /etc/box.env 2>/dev/null; set +a; timeout 300 node deploy/check-claude.js 2>&1)

echo "== remove earlier Coolify routing attempts =="
docker rm -f box-web >/dev/null 2>&1 && echo "removed relay container box-web" || echo "no relay container"
rm -f /data/coolify/proxy/dynamic/box.yaml && echo "removed Coolify route file"

echo "== domain, as the internet reaches it (k3s Traefik on the public IP) =="
PUB=69.62.86.166
echo "http  -> HTTP $(curl -s  -o /dev/null -w '%{http_code}' --max-time 10 --resolve "$DOMAIN:80:$PUB"  "http://$DOMAIN/"  || true)"
echo "https -> HTTP $(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 --resolve "$DOMAIN:443:$PUB" "https://$DOMAIN/" || true)"
echo "cert  -> $(echo | openssl s_client -connect "$PUB:443" -servername "$DOMAIN" 2>/dev/null | openssl x509 -noout -subject -issuer 2>/dev/null | tr '\n' ' ')"
echo "(401 = Box login prompt = working; 404 = k8s route not applied yet)"
node -e "require('./lib/auth').destroySession(process.argv[1])" "$CHECK_TOKEN" 2>/dev/null
echo "== done =="
