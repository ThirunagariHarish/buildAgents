#!/usr/bin/env bash
# What each Massive/Polygon key's plan allows (HTTP codes and the vendor's short reason only), then use the best one.
set -uo pipefail
NS=unusual-options-detector
SITE=https://$NS.cashflowus.com
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
key() { $KC -n "$1" get secret "$2" -o jsonpath="{.data.$3}" | base64 -d | tr -d '\r\n '; }
key midas midas-credentials MASSIVE_API_KEY > "$TMP/k1"; key selfagentbot selfagentbot-credentials POLYGON_API_KEY > "$TMP/k2"
probe() { # $1 label, $2 key file
  local K; K=$(cat "$2")
  local occ; occ=$(curl -s --max-time 20 -H "Authorization: Bearer $K" "https://api.massive.com/v3/reference/options/contracts?underlying_ticker=SPY&expired=false&limit=1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).results[0].ticker)}catch{console.log("")}})')
  local out="$1:"
  for p in "/v2/aggs/ticker/AAPL/prev" "/v3/reference/options/contracts?underlying_ticker=SPY&limit=1" "/v3/trades/${occ:-O:SPY000000C00000000}?limit=1" "/v3/quotes/${occ:-O:SPY000000C00000000}?limit=1" "/v3/snapshot/options/SPY?limit=1"; do
    code=$(curl -s -o "$TMP/r" -w '%{http_code}' --max-time 20 -H "Authorization: Bearer $K" "https://api.massive.com$p")
    why=$(node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log(j.status&&j.status!=="OK"?(j.status+" "+(j.message||"")).slice(0,90):"")}catch{}' "$TMP/r")
    out="$out ${p%%\?*}=$code${why:+ ($why)};"
  done
  echo "$out" | sed "s#O:SPY[0-9A-Z]*#<contract>#g"
}
probe "MASSIVE_API_KEY (midas)" "$TMP/k1"
probe "POLYGON_API_KEY (selfagentbot)" "$TMP/k2"
# Use the POLYGON key if it can read option trades and the Massive one cannot.
t1=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -H "Authorization: Bearer $(cat $TMP/k1)" "https://api.massive.com/v3/trades/O:SPY251219C00600000?limit=1")
t2=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -H "Authorization: Bearer $(cat $TMP/k2)" "https://api.massive.com/v3/trades/O:SPY251219C00600000?limit=1")
echo "option trades: massive key $t1, polygon key $t2"
if [ "$t2" = 200 ] && [ "$t1" != 200 ]; then
  $KC -n $NS get secret $NS-env -o json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s).data;const v=k=>Buffer.from(d[k],"base64").toString();require("fs").writeFileSync(process.argv[1],JSON.stringify({email:v("FIRST_ADMIN_EMAIL"),password:v("FIRST_ADMIN_PASSWORD")}),{mode:0o600})})' "$TMP/l.json"
  J="$TMP/jar"; curl -s -o /dev/null -c "$J" --max-time 15 -X POST "$SITE/api/auth/sign-in/email" -H 'Content-Type: application/json' -H "Origin: $SITE" --data-binary @"$TMP/l.json"
  node -e 'require("fs").writeFileSync(process.argv[2],JSON.stringify({value:require("fs").readFileSync(process.argv[1],"utf8")}),{mode:0o600})' "$TMP/k2" "$TMP/v.json"
  echo "switched to the POLYGON key: PUT $(curl -s -o /dev/null -w '%{http_code}' -b "$J" --max-time 15 -X PUT "$SITE/api/admin/settings/vendor_api_key" -H 'Content-Type: application/json' -H "Origin: $SITE" --data-binary @"$TMP/v.json")"
  echo "Test: $(curl -s -b "$J" --max-time 60 -X POST "$SITE/api/admin/settings/vendor_api_key/test" -H "Origin: $SITE")"
fi
