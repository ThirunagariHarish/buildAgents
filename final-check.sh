#!/usr/bin/env bash
# After the deploy: force one full market read, then sign in as the admin and check each new endpoint. Status codes and counts only.
set -uo pipefail
NS=unusual-options-detector
SITE=https://$NS.cashflowus.com
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"; K="$KC -n $NS"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
Q() { $K exec statefulset/$NS-db -c postgres -- sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -At -F ' | ' -c \"$1\"" 2>&1; }
echo "forced daily read: $(Q "DELETE FROM markets_state WHERE key = 'daily'")"
for i in $(seq 1 60); do
  L=$($K logs deploy/$NS-worker --since=20m 2>/dev/null | grep -E '"markets (read|failed)"' | tail -1)
  [ -n "$L" ] && break; sleep 15
done
echo "worker: $(echo "$L" | cut -c1-400)"
echo "macro: $(Q "SELECT series, max(date), count(*) FROM macro_series GROUP BY 1 ORDER BY 1" | tr '\n' ';')"
echo "ark: $(Q "SELECT count(*), count(DISTINCT date), max(date) FROM ark_holdings")"
echo "reading: $(Q "SELECT source, count(*) FROM reading_items GROUP BY 1 ORDER BY 1" | tr '\n' ';')"
echo "etf: $(Q "SELECT etf, count(*) FROM etf_holdings GROUP BY 1 ORDER BY 1" | tr '\n' ';')"
echo "darkpool: $(Q "SELECT count(*), count(DISTINCT ticker), max(trade_date) FROM darkpool_levels")"
echo "gamma: $(Q "SELECT count(*), count(DISTINCT ticker), max(date) FROM greek_exposure")"
echo "next fed on calendar: $(Q "SELECT count(*) FROM econ_events WHERE event_time >= now() AND (event ILIKE '%FOMC%' OR event ILIKE '%Fed Interest Rate%' OR event ILIKE '%Federal Funds%') AND event NOT ILIKE '%minutes%'"); calendar event kinds: $(Q "SELECT DISTINCT left(event, 28) FROM econ_events WHERE event ILIKE '%fed%' OR event ILIKE '%fomc%' LIMIT 6" | tr '\n' ';')"
$K get secret $NS-env -o json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s).data;const v=k=>Buffer.from(d[k],"base64").toString();require("fs").writeFileSync(process.argv[1],JSON.stringify({email:v("FIRST_ADMIN_EMAIL"),password:v("FIRST_ADMIN_PASSWORD")}))})' "$TMP/l.json"
echo "admin sign-in: $(curl -s -o /dev/null -c "$TMP/jar" -w '%{http_code}' --max-time 20 -X POST "$SITE/api/auth/sign-in/email" -H 'Content-Type: application/json' -H "Origin: $SITE" --data-binary @"$TMP/l.json")"
rm -f "$TMP/l.json"
COUNT='(function(){let j;try{j=JSON.parse(require("fs").readFileSync(process.argv[1]))}catch{console.log("not json");return}
const n=(v)=>Array.isArray(v)?v.length:(v&&typeof v==="object"?"{"+Object.keys(v).length+"}":v===null?"null":typeof v==="string"?"str":v);
console.log(Object.entries(j).map(([k,v])=>k+"="+n(v)).join(" ").slice(0,330))})()'
for P in /api/me /api/flow/board /api/flow/filters /api/money/funds "/api/money/insiders" /api/money/congress /api/markets /api/tickers/SPY /api/tickers/NVDA /api/watchlist /api/learn/reading "/api/search?q=nv" /api/record/summary; do
  code=$(curl -s -o "$TMP/r" -b "$TMP/jar" -w '%{http_code}' --max-time 30 "$SITE$P")
  echo "$P -> $code $(node -e "$COUNT" "$TMP/r")"
done
node -e '(function(){const j=JSON.parse(require("fs").readFileSync(process.argv[1]));const m=j.market||{};console.log("SPY market: closes "+(m.closes||[]).length+" etf "+(m.etf||[]).length+" darkpool levels "+(m.darkpool?m.darkpool.levels.length:0)+" gamma "+(m.gamma||[]).length+" seasonality "+(m.seasonality||[]).length)})()' <(curl -s -b "$TMP/jar" --max-time 30 "$SITE/api/tickers/SPY") 2>&1 | head -2
node -e '(function(){const j=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log("markets: macro ten_year "+(j.macro.ten_year?"yes":"no")+", fed "+(j.macro.fed_target?"yes":"no")+", next_fed "+(j.macro.next_fed?"yes":"no")+"; ark "+(j.ark?j.ark.changes.length+" changes":"waiting for a second day")+"; tide points "+(j.tide?j.tide.points.length:0))})()' <(curl -s -b "$TMP/jar" --max-time 30 "$SITE/api/markets") 2>&1 | head -2
for P in / /flow /money /markets /watching /search /learn /method /ticker/NVDA /record /me; do printf "%s -> %s; " "$P" "$(curl -s -o /dev/null -b "$TMP/jar" -w '%{http_code}' --max-time 30 "$SITE$P")"; done; echo
echo "recent web errors: $($K logs deploy/$NS --since=15m 2>/dev/null | grep -i -E 'error|unhandled' | tail -4 | sed -E 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/<email>/g' | cut -c1-220)"
