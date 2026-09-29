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
if (set -a; . /etc/box.env 2>/dev/null; set +a; timeout 90 claude -p "Reply with exactly: OK" --model haiku 2>&1 | head -c 200); then echo; fi

echo "== traefik =="
if ! docker ps --format '{{.Names}}' | grep -q '^coolify-proxy$'; then
  echo "coolify-proxy not running; skipping domain setup"; exit 0
fi
echo "--- docker engine: $(docker version --format '{{.Server.Version}} (API {{.Server.APIVersion}})') ---"
ARGS=$(docker inspect coolify-proxy --format '{{join .Config.Cmd "\n"}}'; docker inspect coolify-proxy --format '{{join .Args "\n"}}')
echo "--- traefik args ---"; echo "$ARGS" | sort -u | grep -E -- '^--' || echo "(no args found)"

HTTP_EP=$(echo "$ARGS"  | grep -oP -- '--entrypoints\.\K[^.]+(?=\.address=:80$)'  | head -1); HTTP_EP=${HTTP_EP:-http}
HTTPS_EP=$(echo "$ARGS" | grep -oP -- '--entrypoints\.\K[^.]+(?=\.address=:443$)' | head -1); HTTPS_EP=${HTTPS_EP:-https}
RESOLVER=$(echo "$ARGS" | grep -oP -- '--certificatesresolvers\.\K[^.]+' | head -1); RESOLVER=${RESOLVER:-letsencrypt}
FILE_DIR=$(echo "$ARGS" | grep -oP -- '--providers\.file\.directory=\K.*' | head -1)
NET=$(docker inspect coolify-proxy --format '{{range $k, $e := .NetworkSettings.Networks}}{{$k}} {{end}}' | awk '{print $1}')
echo "detected: http_ep=$HTTP_EP https_ep=$HTTPS_EP resolver=$RESOLVER file_dir=${FILE_DIR:-none} network=$NET"
echo "--- mounts ---"; docker inspect coolify-proxy --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'

echo "== relay container (docker provider) =="
docker rm -f box-web >/dev/null 2>&1 || true
docker run -d --restart unless-stopped --name box-web \
  --network "$NET" \
  --add-host host.docker.internal:host-gateway \
  -l traefik.enable=true \
  -l "traefik.docker.network=$NET" \
  -l "traefik.http.routers.box-https.rule=Host(\`$DOMAIN\`)" \
  -l "traefik.http.routers.box-https.entrypoints=$HTTPS_EP" \
  -l "traefik.http.routers.box-https.tls=true" \
  -l "traefik.http.routers.box-https.tls.certresolver=$RESOLVER" \
  -l traefik.http.routers.box-https.service=box-svc \
  -l "traefik.http.routers.box-http.rule=Host(\`$DOMAIN\`)" \
  -l "traefik.http.routers.box-http.entrypoints=$HTTP_EP" \
  -l traefik.http.routers.box-http.middlewares=box-redir \
  -l traefik.http.routers.box-http.service=box-svc \
  -l traefik.http.middlewares.box-redir.redirectscheme.scheme=https \
  -l traefik.http.services.box-svc.loadbalancer.server.port=3400 \
  alpine/socat tcp-listen:3400,fork,reuseaddr tcp:host.docker.internal:3400 >/dev/null
sleep 3
echo "relay: $(docker ps --filter name=box-web --format '{{.Status}}')"
echo "--- relay -> box (inside relay's network) ---"
docker run --rm --network "$NET" curlimages/curl -s -o /dev/null -w 'box-web:3400 -> HTTP %{http_code}\n' --max-time 6 http://box-web:3400/ 2>&1 | tail -1

if [ -n "$FILE_DIR" ]; then
  HOST_DIR=$(docker inspect coolify-proxy --format '{{range .Mounts}}{{.Source}}|{{.Destination}}{{"\n"}}{{end}}' \
    | awk -F'|' -v d="$FILE_DIR" 'index(d, $2)==1 && length($2)>len {len=length($2); src=$1; dst=$2} END {if (src) print src substr(d, length(dst)+1)}')
  echo "== file provider: container $FILE_DIR = host ${HOST_DIR:-unknown} =="
  if [ -n "$HOST_DIR" ]; then
    mkdir -p "$HOST_DIR"
    rm -f "$HOST_DIR/box.yaml"
    cat > "$HOST_DIR/box.yaml" <<EOF
http:
  routers:
    box-file-https:
      rule: Host(\`$DOMAIN\`)
      entryPoints: [$HTTPS_EP]
      service: box-file
      tls:
        certResolver: $RESOLVER
    box-file-http:
      rule: Host(\`$DOMAIN\`)
      entryPoints: [$HTTP_EP]
      middlewares: [box-file-redir]
      service: box-file
  middlewares:
    box-file-redir:
      redirectScheme:
        scheme: https
  services:
    box-file:
      loadBalancer:
        servers:
          - url: "http://box-web:3400"
EOF
    echo "wrote $HOST_DIR/box.yaml"
  fi
fi

sleep 10
echo "== traefik API view =="
for u in http://localhost:8080/api/http/routers http://127.0.0.1:8080/api/http/routers; do
  R=$(curl -s --max-time 5 "$u") && [ -n "$R" ] && break
done
if [ -n "${R:-}" ]; then
  echo "router count: $(echo "$R" | grep -o '"name":"[^"]*"' | wc -l)"
  echo "$R" | grep -o '"name":"[^"]*box[^"]*"[^}]*"status":"[^"]*"' | head -10 || echo "(no box routers registered)"
  echo "$R" | grep -o '"name":"[^"]*box[^"]*"' || echo "(no router names containing box)"
  echo "--- any router errors ---"
  echo "$R" | grep -o '"error":\[[^]]*\]' | head -5 || echo "(none)"
else
  echo "(traefik API not reachable on :8080)"
fi

echo "== domain checks (from the server) =="
echo "https://$DOMAIN -> HTTP $(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/" || true)"
echo "http://$DOMAIN  -> HTTP $(curl -s  -o /dev/null -w '%{http_code}' --max-time 10 --resolve "$DOMAIN:80:127.0.0.1"  "http://$DOMAIN/"  || true)"
echo "cert: $(echo | openssl s_client -connect 127.0.0.1:443 -servername "$DOMAIN" 2>/dev/null | openssl x509 -noout -subject -issuer 2>/dev/null | tr '\n' ' ')"

echo "== traefik log (filtered) =="
docker logs coolify-proxy --since 5m 2>&1 | grep -iE 'error|box|provider|acme|certif' | tail -25 || echo "(nothing relevant)"
echo "== done =="
