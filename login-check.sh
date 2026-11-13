#!/usr/bin/env bash
# Read-only: the live login page, Google start, admin sign-in, running image. No secret printed.
set -uo pipefail
NS=unusual-options-detector
SITE=https://$NS.cashflowus.com
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"
K="$KC -n $NS"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
echo "time: $(date -u +%H:%MZ)"
echo "images: $($K get deploy -o jsonpath='{range .items[*]}{.metadata.name}={.spec.template.spec.containers[0].image}{" "}{end}' | sed 's#ghcr.io/thirunagariharish/unusual-options-detector:##g' | sed -E 's/=([0-9a-f]{7})[0-9a-f]*/=\1/g')"
$K get pods --no-headers | awk '{print "pod", $1, $2, $3, $5}'
echo "GET /login -> $(curl -s -o "$TMP/login.html" -w '%{http_code}' --max-time 20 $SITE/login); Google button: $(grep -c 'Continue with Google' "$TMP/login.html"); email field: $(grep -c 'type="email"' "$TMP/login.html")"
echo "health: $(curl -s --max-time 15 $SITE/api/health)"
curl -s --max-time 15 -X POST "$SITE/api/auth/sign-in/social" -H 'Content-Type: application/json' -H "Origin: $SITE" -d '{"provider":"google","callbackURL":"/","errorCallbackURL":"/login"}' > "$TMP/s.json"
node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1]));const u=new URL(j.url);console.log("Google start -> "+u.host+u.pathname+" redirect_uri="+u.searchParams.get("redirect_uri"))}catch{console.log("Google start failed")}' "$TMP/s.json"
# What Google says about this client and redirect URI (an error page names redirect_uri_mismatch).
URL=$(node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).url)}catch{}' "$TMP/s.json")
if [ -n "$URL" ]; then
  code=$(curl -s -L -o "$TMP/g.html" -w '%{http_code}' --max-time 20 -A 'Mozilla/5.0' "$URL")
  echo "Google answers: HTTP $code; redirect_uri_mismatch: $(grep -c -i 'redirect_uri_mismatch' "$TMP/g.html"); invalid_client: $(grep -c -i 'invalid_client' "$TMP/g.html")"
fi
$K get secret $NS-env -o json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s).data;const v=k=>Buffer.from(d[k],"base64").toString();require("fs").writeFileSync(process.argv[1],JSON.stringify({email:v("FIRST_ADMIN_EMAIL"),password:v("FIRST_ADMIN_PASSWORD")}),{mode:0o600})})' "$TMP/l.json"
echo "admin email+password sign-in: $(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -X POST "$SITE/api/auth/sign-in/email" -H 'Content-Type: application/json' -H "Origin: $SITE" --data-binary @"$TMP/l.json")"
echo "recent web errors: $($K logs deploy/$NS --tail=300 2>/dev/null | grep -i -E 'error|oauth|google' | tail -5 | sed -E 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/<email>/g' | cut -c1-250)"
