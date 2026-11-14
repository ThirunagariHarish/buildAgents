#!/usr/bin/env bash
# Unusual Whales: which quota is this token on? Response header names and numeric values only; requests the worker made today.
set -uo pipefail
NS=unusual-options-detector
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"
T=$($KC -n selfagentbot get secret selfagentbot-credentials -o jsonpath='{.data.UNUSUAL_WHALES_API_TOKEN}' | base64 -d | tr -d '\r\n ')
echo "headers on a 1-row call:"
curl -s -D - -o /dev/null --max-time 20 -H "Authorization: Bearer $T" "https://api.unusualwhales.com/api/option-trades?ticker_symbol=SPY&limit=1" | tr -d '\r' | grep -i -E '^(x-|ratelimit|retry|uw-)' | grep -v -i -E 'cookie|token|request-id|trace' | cut -c1-160
for p in /api/congress/recent-trades?limit=1 /api/insider/transactions?limit=1 /api/institutions?limit=1 "/api/institution/BERKSHIRE%20HATHAWAY%20INC/holdings?limit=1" /api/market/economic-calendar /api/darkpool/recent?limit=1 /api/etfs/SPY/holdings /api/shorts/NVDA/interest-float /api/news/headlines?limit=1 /api/stock/NVDA/info /api/stock/NVDA/ohlc/1d?limit=1 /api/screener/stocks?limit=1 /api/market/market-tide /api/stock/NVDA/greek-exposure /api/seasonality/NVDA/monthly; do
  echo "GET ${p%%\?*} -> $(curl -s -o /tmp/r.json -w '%{http_code}' --max-time 25 -H "Authorization: Bearer $T" "https://api.unusualwhales.com$p") $(node -e '(function(){try{const j=JSON.parse(require("fs").readFileSync("/tmp/r.json"));const d=Array.isArray(j.data)?j.data:(j.data?[j.data]:[]);console.log("rows "+d.length+(d[0]&&typeof d[0]==="object"?"; fields "+Object.keys(d[0]).slice(0,16).join(","):"")+(j.message?" msg "+String(j.message).slice(0,90):""))}catch{console.log("")}})()')"
done
Q() { $KC -n $NS exec statefulset/$NS-db -c postgres -- sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -At -F ' | ' -c \"$1\"" 2>&1; }
echo "ingest runs by day:"; Q "SELECT (started_at AT TIME ZONE 'America/New_York')::date, status, count(*), sum(trades_fetched) FROM ingest_runs GROUP BY 1,2 ORDER BY 1 DESC LIMIT 6" | cut -c1-200
echo "worker memory: $($KC top pod -n $NS 2>/dev/null | grep worker)"
