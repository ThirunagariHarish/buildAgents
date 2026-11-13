#!/usr/bin/env bash
# Unusual Whales: historical chain with OI and volume, per-contract day flow size/order/time format, earnings fields. Shapes and counts only.
set -uo pipefail
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
T=$($KC -n selfagentbot get secret selfagentbot-credentials -o jsonpath='{.data.UNUSUAL_WHALES_API_TOKEN}' | base64 -d | tr -d '\r\n ')
B=https://api.unusualwhales.com
g() { curl -s --max-time 60 -o "$TMP/r" -w '%{http_code}' -H "Authorization: Bearer $T" -H 'Accept: application/json' "$B$1"; }
D=2026-11-12
echo "chains plain -> $(g "/api/stock/SPY/option-chains?date=$D")"; node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log("  symbols "+(j.data||[]).length)' "$TMP/r"
echo "chains greeks p0 -> $(g "/api/stock/SPY/option-chains?date=$D&greeks=true&limit=500&page=0")"
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1]));const d=j.data||[];console.log("  rows "+d.length+"; keys "+Object.keys(j).join(",")+"; fields "+(d[0]?Object.entries(d[0]).map(([k,v])=>k+":"+(v===null?"null":typeof v)).join(" "):""));console.log("  with volume>0: "+d.filter(r=>Number(r.volume)>0).length+"; oi>0: "+d.filter(r=>Number(r.open_interest)>0).length)' "$TMP/r"
n=0; tv=0; for p in $(seq 0 40); do g "/api/stock/SPY/option-chains?date=$D&greeks=true&limit=500&page=$p" >/dev/null; r=$(node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1])).data||[];console.log(d.length+" "+d.filter(r=>Number(r.volume)>0).length)' "$TMP/r"); a=${r%% *}; b=${r##* }; n=$((n+a)); tv=$((tv+b)); [ "$a" -lt 500 ] && break; done
echo "  SPY $D chain total $n, traded $tv, pages $((p+1))"
# busiest contract that day
g "/api/stock/SPY/option-chains?date=$D&greeks=true&limit=500&page=0" >/dev/null
C=$(node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1])).data||[];d.sort((a,b)=>Number(b.volume)-Number(a.volume));console.log(d[0]?d[0].option_symbol:"")' "$TMP/r")
echo "contract form $(echo $C | sed 's/[0-9]/9/g')"
for q in "" "&limit=500" "&limit=100000"; do
  c=$(g "/api/option-contract/$C/flow?date=$D$q")
  node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1]));const d=j.data||[];console.log("  flow'"$q"' -> '"$c"' rows "+d.length+(d.length?"; first "+d[0].executed_at+" last "+d[d.length-1].executed_at+"; nbbo_bid_time "+d[0].nbbo_bid_time+"; volume field "+d[0].volume+"; canceled "+d.filter(r=>r.canceled).length+"; codes "+JSON.stringify([...new Set(d.map(r=>r.upstream_condition_detail))])+"; flags "+JSON.stringify([...new Set(d.flatMap(r=>r.report_flags||[]))]):""))' "$TMP/r"
done
echo "flow today no date -> $(g "/api/option-contract/$C/flow?limit=5")"
echo "option-trades by contract (today) -> $(g "/api/option-trades?option_contracts[]=$C&limit=5")"; node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1])).data||[];console.log("  rows "+d.length)' "$TMP/r"
for e in premarket afterhours; do echo "earnings $e -> $(g "/api/earnings/$e?date=2026-11-12&limit=5")"; node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1]));const d=j.data||[];console.log("  rows "+d.length+"; fields "+(d[0]?Object.entries(d[0]).map(([k,v])=>k+":"+(v===null?"null":typeof v)).join(" "):""))' "$TMP/r"; done
echo "option-trades older than 30 days via newer_than (expect 400) -> $(g "/api/option-trades?ticker_symbol=SPY&limit=1&older_than=2026-11-12T15:00:00Z")"
echo "codes seen, wider sample (5 x 500 trades, all tickers):"
o=""; for i in 1 2 3 4 5; do g "/api/option-trades?limit=500$o" >/dev/null; cat "$TMP/r" >> "$TMP/all"; echo >> "$TMP/all"; l=$(node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1])).data||[];console.log(d.length?d[d.length-1].executed_at:"")' "$TMP/r"); o="&older_than=$l"; done
node -e 'const L=require("fs").readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean);const m={},f={};let c=0;for(const l of L)for(const r of JSON.parse(l).data||[]){m[r.upstream_condition_detail]=(m[r.upstream_condition_detail]||0)+1;for(const x of r.report_flags||[])f[x]=(f[x]||0)+1;if(r.canceled)c++}console.log("  codes "+JSON.stringify(m)+"\n  flags "+JSON.stringify(f)+"\n  canceled "+c)' "$TMP/all"
