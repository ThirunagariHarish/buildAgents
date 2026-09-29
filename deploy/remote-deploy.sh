#!/usr/bin/env bash
# Runs ON THE VPS from the deploy workflow (after the repo is synced).
# Its full output is committed back to the branch as deploy/last-run.log.
set -uo pipefail

APP_DIR=/opt/box
DOMAIN="${BOX_DOMAIN:-box.cashflowus.com}"
cd "$APP_DIR"
echo "HEAD: $(git rev-parse --short HEAD)   domain: $DOMAIN"

echo "== env file =="
{
  [ -n "${BOX_PASSWORD:-}" ] && printf 'BOX_PASSWORD=%s\n' "$BOX_PASSWORD"
  [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] && printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' "$CLAUDE_CODE_OAUTH_TOKEN"
} > /etc/box.env.new
if [ -s /etc/box.env.new ]; then mv /etc/box.env.new /etc/box.env; chmod 600 /etc/box.env; else rm -f /etc/box.env.new; fi
echo "keys in /etc/box.env: $(cut -d= -f1 /etc/box.env 2>/dev/null | tr '\n' ' ')"

echo "== box service =="
bash deploy/setup-vps.sh 2>&1 | grep -E '==>|⚠|OK' || true
systemctl restart box
sleep 2
echo "service: $(systemctl is-active box)"
echo "local /: HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 8 http://localhost:3400/)"

echo "== claude login =="
(set -a; . /etc/box.env 2>/dev/null; set +a; timeout 90 claude -p "Reply with exactly: OK" --model haiku 2>&1 | head -c 200); echo

echo "== remove earlier Coolify routing attempts =="
docker rm -f box-web >/dev/null 2>&1 && echo "removed relay container box-web" || echo "no relay container"
rm -f /data/coolify/proxy/dynamic/box.yaml && echo "removed Coolify route file"

echo "== domain, as the internet reaches it (k3s Traefik on the public IP) =="
PUB=69.62.86.166
echo "http  -> HTTP $(curl -s  -o /dev/null -w '%{http_code}' --max-time 10 --resolve "$DOMAIN:80:$PUB"  "http://$DOMAIN/"  || true)"
echo "https -> HTTP $(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 --resolve "$DOMAIN:443:$PUB" "https://$DOMAIN/" || true)"
echo "cert  -> $(echo | openssl s_client -connect "$PUB:443" -servername "$DOMAIN" 2>/dev/null | openssl x509 -noout -subject -issuer 2>/dev/null | tr '\n' ' ')"
echo "(401 = Box login prompt = working; 404 = k8s route not applied yet)"
echo "== done =="
