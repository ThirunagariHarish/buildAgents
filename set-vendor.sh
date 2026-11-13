#!/usr/bin/env bash
# The Massive key from the midas Doppler secret into the app's encrypted Settings (only if empty), then its Test.
set -uo pipefail
NS=unusual-options-detector
SITE=https://$NS.cashflowus.com
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
echo "key fingerprints (sha256, first 8):"
for s in midas/midas-credentials selfagentbot/selfagentbot-credentials agent-m/project10-secrets; do
  $KC -n ${s%%/*} get secret ${s##*/} -o json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s).data||{};const h=k=>d[k]?require("crypto").createHash("sha256").update(Buffer.from(d[k],"base64").toString().trim()).digest("hex").slice(0,8):"-";console.log("  "+process.argv[1]+": MASSIVE "+h("MASSIVE_API_KEY")+" POLYGON "+h("POLYGON_API_KEY"))})' "$s"
done
$KC -n $NS get secret $NS-env -o json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s).data;const v=k=>Buffer.from(d[k],"base64").toString();require("fs").writeFileSync(process.argv[1],JSON.stringify({email:v("FIRST_ADMIN_EMAIL"),password:v("FIRST_ADMIN_PASSWORD")}),{mode:0o600})})' "$TMP/l.json"
J="$TMP/jar"
curl -s -o /dev/null -c "$J" --max-time 15 -X POST "$SITE/api/auth/sign-in/email" -H 'Content-Type: application/json' -H "Origin: $SITE" --data-binary @"$TMP/l.json"
CONF=$(curl -s -b "$J" --max-time 15 "$SITE/api/admin/settings" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(((j.settings||[]).find(x=>x.key==="vendor_api_key")||{}).configured?"yes":"no")}catch{console.log("unreadable")}})')
echo "vendor key already configured: $CONF"
if [ "$CONF" = no ]; then
  $KC -n midas get secret midas-credentials -o json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s).data;require("fs").writeFileSync(process.argv[1],JSON.stringify({value:Buffer.from(d.MASSIVE_API_KEY,"base64").toString().trim()}),{mode:0o600})})' "$TMP/v.json"
  echo "PUT vendor_api_key -> $(curl -s -o "$TMP/put.json" -w '%{http_code}' -b "$J" --max-time 15 -X PUT "$SITE/api/admin/settings/vendor_api_key" -H 'Content-Type: application/json' -H "Origin: $SITE" --data-binary @"$TMP/v.json") $(node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log(j.error?j.error+" "+(j.message||""):"configured="+j.setting.configured)}catch{}' "$TMP/put.json")"
fi
echo "Test: $(curl -s -b "$J" --max-time 60 -X POST "$SITE/api/admin/settings/vendor_api_key/test" -H "Origin: $SITE")"
echo "health: $(curl -s --max-time 15 $SITE/api/health)"
