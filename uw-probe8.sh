#!/usr/bin/env bash
# Gamma by strike and sector tide: field names, value types and row counts only.
set -uo pipefail
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
T=$($KC -n selfagentbot get secret selfagentbot-credentials -o jsonpath='{.data.UNUSUAL_WHALES_API_TOKEN}' | base64 -d | tr -d '\r\n ')
B=https://api.unusualwhales.com
G() { curl -s --max-time 60 -o "$TMP/r" -w '%{http_code}' -H "Authorization: Bearer $T" -H 'Accept: application/json' "$B$1"; }
SHAPE='(function(){let j;try{j=JSON.parse(require("fs").readFileSync(process.argv[1]))}catch(e){console.log("  not json");return}
const d=Array.isArray(j)?j:(j.data===undefined?j:j.data);
const t=(v)=>v===null?"null":Array.isArray(v)?"array":typeof v;
const rows=Array.isArray(d)?d:[d];const m={};for(const r of rows.slice(0,400))for(const [k,v] of Object.entries(r||{})){(m[k]=m[k]||new Set()).add(t(v))}
console.log("  top "+(Array.isArray(j)?"array":Object.keys(j).join(","))+"; rows "+rows.length+": "+Object.entries(m).map(([k,s])=>k+":"+[...s].join("/")).join(" "));
const ex=process.argv[2]?process.argv[2].split(","):[];
for(const i of [0,rows.length-1]){const r=rows[i]||{};console.log("  row"+i+": "+ex.map(k=>k+"="+JSON.stringify(r[k])).join(" ").slice(0,300))}
})()'
echo "spot-exposures/strike NVDA -> $(G "/api/stock/NVDA/spot-exposures/strike")"; node -e "$SHAPE" "$TMP/r" "strike,time,price"
node -e '(function(){const j=JSON.parse(require("fs").readFileSync(process.argv[1]));const d=j.data||[];const s=d.map(r=>Number(r.strike));const sign=(k)=>{let p=0,n=0;for(const r of d){const v=Number(r[k]);if(v>0)p++;else if(v<0)n++}return k+" +"+p+"/-"+n};console.log("  strikes "+Math.min(...s)+".."+Math.max(...s)+"; "+["call_gamma_oi","put_gamma_oi","call_gamma_vol","put_gamma_vol"].map(sign).join("; "))})()' "$TMP/r" 2>&1 | head -2
echo "spot-exposures/strike NVDA limited -> $(G "/api/stock/NVDA/spot-exposures/strike?limit=500")"; node -e '(function(){const j=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log("  rows "+(j.data||[]).length)})()' "$TMP/r"
echo "sector-tide Technology -> $(G "/api/market/Technology/sector-tide")"; node -e "$SHAPE" "$TMP/r" "timestamp,date"
echo "sector-tide Financial Services -> $(G "/api/market/Financial%20Services/sector-tide")"; node -e "$SHAPE" "$TMP/r" "timestamp,date"
echo "stock price in spot-exposures (per 1min) NVDA -> $(G "/api/stock/NVDA/spot-exposures")"; node -e "$SHAPE" "$TMP/r" "time,price"
