#!/usr/bin/env bash
# Pre-market: does the vendor serve today's bars and prices before the open, and live VIX and gamma? Shapes and times only.
set -uo pipefail
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
T=$($KC -n selfagentbot get secret selfagentbot-credentials -o jsonpath='{.data.UNUSUAL_WHALES_API_TOKEN}' | base64 -d | tr -d '\r\n ')
B=https://api.unusualwhales.com
G() { curl -s --max-time 60 -o "$TMP/r" -w '%{http_code}' -H "Authorization: Bearer $T" -H 'Accept: application/json' "$B$1"; }
LAST='(function(){let j;try{j=JSON.parse(require("fs").readFileSync(process.argv[1]))}catch(e){console.log("  not json: "+require("fs").readFileSync(process.argv[1]).toString().slice(0,160));return}
const d=Array.isArray(j)?j:(j.data===undefined?j:j.data);const rows=Array.isArray(d)?d:[d];const k=process.argv[2].split(",");
const f=(r)=>k.map(x=>x+"="+JSON.stringify((r||{})[x])).join(" ");
console.log("  rows "+rows.length+" keys "+Object.keys(rows[0]||{}).slice(0,24).join(",")+"\n  first: "+f(rows[0]).slice(0,300)+"\n  last:  "+f(rows[rows.length-1]).slice(0,300))})()'
TODAY=$(TZ=America/New_York date +%F)
echo "now ET: $(TZ=America/New_York date '+%F %T')"
for P in "/api/stock/SPY/ohlc/5m?limit=6" "/api/stock/SPY/ohlc/5m?limit=6&date=$TODAY" "/api/stock/SPY/ohlc/5m?limit=6&end_date=$TODAY" "/api/stock/SPY/ohlc/1m?limit=6" "/api/stock/SPY/ohlc/5m?limit=6&timeframe=1D"; do
  echo "$P -> $(G "$P")"; node -e "$LAST" "$TMP/r" "start_time,end_time,market_time,close,volume"
done
echo "stock-state SPY -> $(G "/api/stock/SPY/stock-state")"; node -e "$LAST" "$TMP/r" "tape_time,market_time,close,prev_close,volume"
echo "stock-state NVDA -> $(G "/api/stock/NVDA/stock-state")"; node -e "$LAST" "$TMP/r" "tape_time,market_time,close,prev_close"
for V in VIX SPX VIXY; do echo "ohlc $V -> $(G "/api/stock/$V/ohlc/5m?limit=3")"; node -e "$LAST" "$TMP/r" "start_time,market_time,close"; echo "stock-state $V -> $(G "/api/stock/$V/stock-state")"; node -e "$LAST" "$TMP/r" "tape_time,market_time,close,prev_close"; done
echo "spot-exposures/strike SPY -> $(G "/api/stock/SPY/spot-exposures/strike")"; node -e "$LAST" "$TMP/r" "time,strike,price"
echo "spot-exposures SPY (per minute) -> $(G "/api/stock/SPY/spot-exposures")"; node -e "$LAST" "$TMP/r" "time,price,gamma_per_one_percent_move_oi,gamma_per_one_percent_move_vol"
echo "greek-exposure SPY -> $(G "/api/stock/SPY/greek-exposure?limit=3")"; node -e "$LAST" "$TMP/r" "date,call_gamma,put_gamma"
echo "market tide -> $(G "/api/market/market-tide")"; node -e "$LAST" "$TMP/r" "timestamp,date"
echo "market tide 5m -> $(G "/api/market/market-tide?interval_5m=false")"; node -e "$LAST" "$TMP/r" "timestamp,date"
echo "flow alerts newest -> $(G "/api/option-trades/flow-alerts?limit=3&min_premium=100000")"; node -e "$LAST" "$TMP/r" "created_at,ticker,issue_type"
echo "news newest -> $(G "/api/news/headlines?limit=3")"; node -e "$LAST" "$TMP/r" "created_at,source,sentiment,tickers"
echo "economic calendar -> $(G "/api/market/economic-calendar")"; node -e "$LAST" "$TMP/r" "time,event"
echo "interest/yields? treasury -> $(G "/api/market/fda-calendar?limit=1")"
echo "screener stocks (movers stand-in) -> $(G "/api/screener/stocks?limit=3&order=perc_change&order_direction=desc")"; node -e "$LAST" "$TMP/r" "ticker,close,prev_close,perc_change"
echo "market spike -> $(G "/api/market/spike")"; node -e "$LAST" "$TMP/r" "time,value"
