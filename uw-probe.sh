#!/usr/bin/env bash
# Unusual Whales: the public API spec (paths only) and what this token can read (status, fields, counts; no values).
set -uo pipefail
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
T=$($KC -n selfagentbot get secret selfagentbot-credentials -o jsonpath='{.data.UNUSUAL_WHALES_API_TOKEN}' | base64 -d | tr -d '\r\n ')
echo "token: ${#T} chars"
B=https://api.unusualwhales.com
for u in /api/openapi /api/openapi.json /openapi.json /docs/openapi.json; do
  c=$(curl -s -o "$TMP/spec" -w '%{http_code}' --max-time 30 "$B$u"); echo "spec $u -> $c $(wc -c < "$TMP/spec")"
  if [ "$c" = 200 ]; then cp "$TMP/spec" "$PWD/uw-openapi.json"; head -c 120 "$TMP/spec" | tr '\n' ' '; echo; break; fi
done
if [ -f uw-openapi.json ]; then
  node -e '
  const s=JSON.parse(require("fs").readFileSync("uw-openapi.json"));
  const paths=Object.keys(s.paths||{});console.log("paths: "+paths.length);
  for(const p of paths.filter(p=>/option|flow|contract|tape|greek|oi|nbbo|quote|trade|earnings/i.test(p)))
    for(const [m,o] of Object.entries(s.paths[p])) if(m==="get") console.log("  GET "+p+" :: "+String(o.summary||"").slice(0,80));
  ' 2>&1 | head -120
fi
get() { curl -s -o "$TMP/r" -w '%{http_code}' --max-time 30 -H "Authorization: Bearer $T" -H 'Accept: application/json' "$B$1"; }
shape() { node -e '(function(){
  const t=require("fs").readFileSync(process.argv[1],"utf8");let j;try{j=JSON.parse(t)}catch{console.log("    (not json) "+t.slice(0,80).replace(/\s+/g," "));return}
  const d=Array.isArray(j)?j:(Array.isArray(j.data)?j.data:(j.data&&typeof j.data==="object"?[j.data]:null));
  if(!d){console.log("    keys: "+Object.keys(j).join(", ").slice(0,300)+(j.message?" message="+String(j.message).slice(0,120):"")+(j.error?" error="+String(j.error).slice(0,120):""));return}
  console.log("    rows: "+d.length+(d[0]?"; fields: "+Object.keys(d[0]).join(", ").slice(0,900):""));
  if(d[0]){const f=d[0];const pick=["executed_at","option_chain_id","nbbo_bid","nbbo_ask","exchange","tags","upstream_condition_detail","report_flags","price","size","date","open_interest","bid","ask","timestamp","start_time"];console.log("    types: "+pick.filter(k=>k in f).map(k=>k+"="+(f[k]===null?"null":Array.isArray(f[k])?"array":typeof f[k])+(k==="executed_at"||k==="date"||k==="timestamp"||k==="start_time"?"("+String(f[k]).length+")":"")).join(" "))}
  })()' "$TMP/r"; }
probe() { echo "GET $1 -> $(get "$1")"; shape; }
probe "/api/stock/SPY/flow-recent"
probe "/api/option-trades/flow-alerts?limit=5"
probe "/api/stock/SPY/option-contracts?limit=5"
C=$(node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1]));const d=j.data||j;console.log((d[0]&&(d[0].option_symbol||d[0].option_chain_id||d[0].symbol))||"")}catch{console.log("")}' "$TMP/r")
echo "sample contract id format: $(echo "$C" | sed -E 's/[0-9]/9/g')"
D=$(date -u -d 'last friday' +%F 2>/dev/null || date -u +%F)
[ -n "$C" ] && probe "/api/option-contract/$C/flow?date=$(date -u +%F)"
[ -n "$C" ] && probe "/api/option-contract/$C/flow?date=$D"
[ -n "$C" ] && probe "/api/option-contract/$C/intraday?date=$(date -u +%F)"
[ -n "$C" ] && probe "/api/option-contract/$C/historic"
echo "full-tape: $(curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}' --max-time 30 -H "Authorization: Bearer $T" "$B/api/option-trades/full-tape/$(date -u -d yesterday +%F)" | sed -E 's#\?.*##')"
probe "/api/stock/SPY/oi-per-strike"
probe "/api/stock/SPY/option-chains"
probe "/api/earnings/premarket"
echo "rate headers: $(curl -s -D - -o /dev/null --max-time 20 -H "Authorization: Bearer $T" "$B/api/stock/SPY/flow-recent" | grep -i -E '^x-|ratelimit|uw-' | tr -d '\r' | tr '\n' ' ' | cut -c1-300)"
