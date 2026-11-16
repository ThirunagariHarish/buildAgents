#!/usr/bin/env bash
# Live feeds for the rebuild: field names, value types, row counts, rate-limit headers. No values beyond public market data shapes.
set -uo pipefail
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
T=$($KC -n selfagentbot get secret selfagentbot-credentials -o jsonpath='{.data.UNUSUAL_WHALES_API_TOKEN}' | base64 -d | tr -d '\r\n ')
B=https://api.unusualwhales.com
echo "rate headers:"; curl -s -D - -o /dev/null --max-time 20 -H "Authorization: Bearer $T" "$B/api/market/market-tide" | tr -d '\r' | grep -i -E '^(x-uw|x-rate|ratelimit|retry)' | cut -c1-120
G() { curl -s --max-time 60 -o "$TMP/r" -w '%{http_code}' -H "Authorization: Bearer $T" -H 'Accept: application/json' "$B$1"; }
SHAPE='(function(){let j;try{j=JSON.parse(require("fs").readFileSync(process.argv[1]))}catch(e){console.log("  not json: "+require("fs").readFileSync(process.argv[1]).toString().slice(0,120));return}
const d=Array.isArray(j)?j:(j.data===undefined?j:j.data);
const t=(v)=>v===null?"null":Array.isArray(v)?"array":typeof v;
const rows=Array.isArray(d)?d:[d];const m={};for(const r of rows.slice(0,400))for(const [k,v] of Object.entries(r||{})){(m[k]=m[k]||new Set()).add(t(v))}
console.log("  rows "+rows.length+": "+Object.entries(m).map(([k,s])=>k+":"+[...s].join("/")).join(" ").slice(0,1500));
const ex=process.argv[2]?process.argv[2].split(","):[];
for(const i of [0,rows.length-1]){const r=rows[i]||{};console.log("  row"+i+": "+ex.map(k=>k+"="+JSON.stringify(r[k])).join(" ").slice(0,420))}
})()'
echo "flow-alerts -> $(G "/api/option-trades/flow-alerts?limit=200")"; node -e "$SHAPE" "$TMP/r" "created_at,alert_rule,type,has_sweep,has_floor,has_multileg,has_singleleg,all_opening_trades,expiry,strike,total_premium,volume_oi_ratio,total_ask_side_prem,total_bid_side_prem"
node -e '(function(){const j=JSON.parse(require("fs").readFileSync(process.argv[1]));const d=j.data||[];const c=(k)=>{const m={};for(const r of d){m[r[k]]=(m[r[k]]||0)+1}return JSON.stringify(m).slice(0,400)};console.log("  rules: "+c("alert_rule"));console.log("  issue types: "+c("issue_type")+"; span "+String((d[d.length-1]||{}).created_at).slice(0,19)+" .. "+String((d[0]||{}).created_at).slice(0,19))})()' "$TMP/r" 2>&1 | head -3
echo "flow-alerts filtered (min_premium 250k, single-leg) -> $(G "/api/option-trades/flow-alerts?limit=200&min_premium=250000&is_multi_leg=false")"; node -e '(function(){const j=JSON.parse(require("fs").readFileSync(process.argv[1]));const d=j.data||[];console.log("  rows "+d.length+"; span "+String((d[d.length-1]||{}).created_at).slice(0,19)+" .. "+String((d[0]||{}).created_at).slice(0,19))})()' "$TMP/r" 2>&1 | head -2
echo "hottest chains -> $(G "/api/screener/option-contracts?limit=50")"; node -e "$SHAPE" "$TMP/r" "option_symbol,volume,open_interest,premium,ask_side_volume,bid_side_volume,sweep_volume,implied_volatility,delta,last_fill,close,prev_oi"
echo "top-net-impact -> $(G "/api/market/top-net-impact?limit=20")"; node -e "$SHAPE" "$TMP/r" "ticker,net_premium,net_call_premium,net_put_premium"
echo "market oi-change -> $(G "/api/market/oi-change?limit=20")"; node -e "$SHAPE" "$TMP/r" "option_symbol,oi_diff_plain,curr_oi,last_oi,avg_price,prev_ask_volume,prev_bid_volume"
echo "contract intraday -> $(G "/api/option-contract/SPY261120C00680000/intraday")"; node -e "$SHAPE" "$TMP/r" "start_time,open,high,low,close,volume,avg_price,premium_ask_side,premium_bid_side,iv_low,iv_high"
echo "contract historic -> $(G "/api/option-contract/SPY261120C00680000/historic?limit=5")"; node -e "$SHAPE" "$TMP/r" "date,last_price,nbbo_bid,nbbo_ask,open_interest,implied_volatility,volume"
echo "stock option-contracts (chain) -> $(G "/api/stock/SPY/option-contracts?limit=5")"; node -e "$SHAPE" "$TMP/r" "option_symbol,nbbo_bid,nbbo_ask,last_price,implied_volatility,open_interest,volume"
echo "news -> $(G "/api/news/headlines?limit=50")"; node -e '(function(){const j=JSON.parse(require("fs").readFileSync(process.argv[1]));const d=j.data||[];const c=(k)=>{const m={};for(const r of d){m[r[k]]=(m[r[k]]||0)+1}return JSON.stringify(m).slice(0,300)};console.log("  sentiment: "+c("sentiment")+"; sources: "+c("source")+"; with tickers "+d.filter(r=>(r.tickers||[]).length).length+"/"+d.length+"; meta keys "+Object.keys((d[0]||{}).meta||{}).join(","))})()' "$TMP/r" 2>&1 | head -2
echo "vix term structure -> $(G "/api/volatility/vix-term-structure")"; node -e "$SHAPE" "$TMP/r" "date,expiry,dte"
echo "total options volume -> $(G "/api/market/total-options-volume?limit=5")"; node -e "$SHAPE" "$TMP/r" "date"
echo "movers -> $(G "/api/market/movers")"; node -e "$SHAPE" "$TMP/r" "ticker"
echo "sector etfs -> $(G "/api/market/sector-etfs")"; node -e "$SHAPE" "$TMP/r" "ticker,full_name"
echo "SPY net-prem-ticks -> $(G "/api/stock/SPY/net-prem-ticks")"; node -e "$SHAPE" "$TMP/r" "tape_time,date"
echo "SPY ohlc 5m -> $(G "/api/stock/SPY/ohlc/5m?limit=5")"; node -e "$SHAPE" "$TMP/r" "start_time,market_time,close"
echo "SPY spot-exposures (gex per min) rows -> $(G "/api/stock/SPY/spot-exposures")"; node -e '(function(){const j=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log("  rows "+(j.data||[]).length)})()' "$TMP/r"
echo "stock-state SPY -> $(G "/api/stock/SPY/stock-state")"; node -e "$SHAPE" "$TMP/r" "tape_time,market_time"
echo "market correlations -> $(G "/api/market/correlations?tickers=SPY,QQQ,IWM")"; node -e "$SHAPE" "$TMP/r" "fst,snd"
