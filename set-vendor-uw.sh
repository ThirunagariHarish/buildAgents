#!/usr/bin/env bash
# The Unusual Whales token (selfagentbot Doppler secret) into the app's encrypted Settings, replacing the Massive key, then its Test.
set -uo pipefail
NS=unusual-options-detector
SITE=https://$NS.cashflowus.com
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
$KC -n $NS get secret $NS-env -o json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s).data;const v=k=>Buffer.from(d[k],"base64").toString();require("fs").writeFileSync(process.argv[1],JSON.stringify({email:v("FIRST_ADMIN_EMAIL"),password:v("FIRST_ADMIN_PASSWORD")}),{mode:0o600})})' "$TMP/l.json"
J="$TMP/jar"
echo "sign-in: $(curl -s -o /dev/null -w '%{http_code}' -c "$J" --max-time 15 -X POST "$SITE/api/auth/sign-in/email" -H 'Content-Type: application/json' -H "Origin: $SITE" --data-binary @"$TMP/l.json")"
echo "settings label: $(curl -s -b "$J" --max-time 15 "$SITE/api/admin/settings" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const x=(j.settings||[]).find(x=>x.key==="vendor_api_key")||{};console.log((x.label||"?")+"; configured "+x.configured)}catch{console.log("unreadable")}})')"
$KC -n selfagentbot get secret selfagentbot-credentials -o json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s).data;require("fs").writeFileSync(process.argv[1],JSON.stringify({value:Buffer.from(d.UNUSUAL_WHALES_API_TOKEN,"base64").toString().trim()}),{mode:0o600})})' "$TMP/v.json"
echo "PUT vendor_api_key -> $(curl -s -o "$TMP/put.json" -w '%{http_code}' -b "$J" --max-time 15 -X PUT "$SITE/api/admin/settings/vendor_api_key" -H 'Content-Type: application/json' -H "Origin: $SITE" --data-binary @"$TMP/v.json") $(node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log(j.error?j.error+" "+(j.message||""):"configured="+j.setting.configured)}catch{}' "$TMP/put.json")"
echo "Test: $(curl -s -b "$J" --max-time 90 -X POST "$SITE/api/admin/settings/vendor_api_key/test" -H "Origin: $SITE")"
echo "health: $(curl -s --max-time 15 $SITE/api/health)"
echo "today: $(curl -s -b "$J" --max-time 15 "$SITE/api/signals" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log("state "+j.state+(j.skip_reason?" skip "+j.skip_reason:""))}catch{console.log("unreadable")}})')"
