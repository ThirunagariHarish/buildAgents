#!/usr/bin/env bash
# Unusual Whales market and reference endpoints: field names and value types only (no values beyond public calendar text).
set -uo pipefail
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
T=$($KC -n selfagentbot get secret selfagentbot-credentials -o jsonpath='{.data.UNUSUAL_WHALES_API_TOKEN}' | base64 -d | tr -d '\r\n ')
B=https://api.unusualwhales.com
G() { curl -s --max-time 60 -o "$TMP/r" -w '%{http_code}' -H "Authorization: Bearer $T" -H 'Accept: application/json' "$B$1"; }
SHAPE='(function(){let j;try{j=JSON.parse(require("fs").readFileSync(process.argv[1]))}catch(e){console.log("  not json");return}
const d=Array.isArray(j)?j:(j.data===undefined?j:j.data);const top=Array.isArray(j)?"array":Object.keys(j).join(",");
const t=(v)=>v===null?"null":Array.isArray(v)?"array("+(v.length?typeof v[0]:"")+")":typeof v;
const rows=Array.isArray(d)?d:[d];const m={};for(const r of rows.slice(0,300))for(const [k,v] of Object.entries(r||{})){(m[k]=m[k]||new Set()).add(t(v))}
console.log("  top: "+top+"; rows "+(Array.isArray(d)?d.length:1));
console.log("  "+Object.entries(m).map(([k,s])=>k+":"+[...s].join("/")).join(" "));
const ex=process.argv[2]?process.argv[2].split(","):[];
for(const i of [0,rows.length-1]){const r=rows[i]||{};console.log("  row"+i+": "+ex.map(k=>k+"="+JSON.stringify(r[k])).join(" ").slice(0,420))}
})()'
echo "economic-calendar -> $(G "/api/market/economic-calendar")"; node -e "$SHAPE" "$TMP/r" "time,event,type,prev,forecast,reported_period"
echo "market-tide -> $(G "/api/market/market-tide")"; node -e "$SHAPE" "$TMP/r" "timestamp,date"
echo "market-tide 5m -> $(G "/api/market/market-tide?interval_5m=true")"; node -e "$SHAPE" "$TMP/r" "timestamp,date"
echo "headlines -> $(G "/api/news/headlines?limit=100")"; node -e "$SHAPE" "$TMP/r" "created_at,source,is_major,sentiment,tickers,tags"
echo "headlines major -> $(G "/api/news/headlines?limit=100&major_only=true")"; node -e "$SHAPE" "$TMP/r" "created_at,is_major"
echo "stock info -> $(G "/api/stock/NVDA/info")"; node -e "$SHAPE" "$TMP/r" "symbol,sector,marketcap,next_earnings_date,announce_time,avg30_volume,issue_type,has_options"
echo "ohlc 1d -> $(G "/api/stock/NVDA/ohlc/1d?limit=200")"; node -e "$SHAPE" "$TMP/r" "date,start_time,end_time,market_time,open,close,volume"
echo "ohlc 1d default -> $(G "/api/stock/NVDA/ohlc/1d")"; node -e '(function(){const j=JSON.parse(require("fs").readFileSync(process.argv[1]));const d=j.data||[];const days=[...new Set(d.map(r=>String(r.start_time||r.date||r.market_time||"").slice(0,10)))];const mt={};for(const r of d){mt[r.market_time]=(mt[r.market_time]||0)+1}console.log("  rows "+d.length+" distinct days "+days.length+" "+days[days.length-1]+" .. "+days[0]+" market_time "+JSON.stringify(mt))})()' "$TMP/r"
echo "shorts interest-float -> $(G "/api/shorts/NVDA/interest-float")"; node -e "$SHAPE" "$TMP/r" "market_date,created_at"
echo "seasonality monthly -> $(G "/api/seasonality/NVDA/monthly")"; node -e "$SHAPE" "$TMP/r" "month,years"
echo "etf holdings -> $(G "/api/etfs/SPY/holdings")"; node -e "$SHAPE" "$TMP/r" "ticker,type,sector"
echo "earnings afterhours -> $(G "/api/earnings/afterhours?limit=50")"; node -e "$SHAPE" "$TMP/r" "symbol,report_date,report_time"
