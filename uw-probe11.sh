#!/usr/bin/env bash
# Read-only: how far back do flow alerts go, and can a past alert be graded from the contract's daily and intraday history? Shapes, counts and dates only.
set -uo pipefail
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
T=$($KC -n selfagentbot get secret selfagentbot-credentials -o jsonpath='{.data.UNUSUAL_WHALES_API_TOKEN}' | base64 -d | tr -d '\r\n ')
B=https://api.unusualwhales.com
G() { curl -s --max-time 60 -o "$TMP/r" -w '%{http_code} %{time_total}s' -H "Authorization: Bearer $T" -H 'Accept: application/json' "$B$1"; }
for D in 3 7 14 21 30 45 60 90 180; do
  O=$(date -u -d "$D days ago" +%Y-%m-%dT21:00:00Z)
  echo "alerts older_than $D days ago ($O) -> $(G "/api/option-trades/flow-alerts?limit=200&min_premium=100000&is_multi_leg=false&older_than=$O")"
  node -e '(function(){const j=JSON.parse(require("fs").readFileSync(process.argv[1]));const d=j.data||[];console.log("   rows "+d.length+" span "+String((d[d.length-1]||{}).created_at).slice(0,16)+" .. "+String((d[0]||{}).created_at).slice(0,16)+" has_bid_ask "+d.filter(r=>r.bid&&r.ask).length+" has_delta "+d.filter(r=>r.delta!==null&&r.delta!==undefined).length)})()' "$TMP/r" 2>&1 | head -2
done
# one whole past day: how many alerts, and how many distinct contracts
DAY=$(date -u -d "10 days ago" +%Y-%m-%d); while [ "$(date -u -d "$DAY" +%u)" -ge 6 ]; do DAY=$(date -u -d "$DAY - 1 day" +%Y-%m-%d); done
O="${DAY}T21:30:00Z"; N=0; : > "$TMP/syms"; : > "$TMP/one"
for P in $(seq 1 80); do
  G "/api/option-trades/flow-alerts?limit=200&min_premium=100000&is_multi_leg=false&older_than=$O" >/dev/null
  R=$(node -e '(function(){const j=JSON.parse(require("fs").readFileSync(process.argv[1]));const d=(j.data||[]).filter(r=>String(r.created_at).slice(0,10)===process.argv[2]);const all=j.data||[];for(const r of d)console.log("S "+r.option_chain+" "+r.created_at+" "+r.ask+" "+r.bid+" "+r.ticker);console.log("N "+d.length+" "+all.length+" "+String((all[all.length-1]||{}).created_at||""))})()' "$TMP/r" "$DAY")
  echo "$R" | grep '^S ' >> "$TMP/syms"
  C=$(echo "$R" | grep '^N ' | cut -d' ' -f2); A=$(echo "$R" | grep '^N ' | cut -d' ' -f3); O=$(echo "$R" | grep '^N ' | cut -d' ' -f4)
  N=$((N + C)); [ "$C" -lt "$A" ] && break; [ "$A" -lt 200 ] && break
done
echo "one past day $DAY: alerts $N in $P pages, distinct contracts $(cut -d' ' -f2 "$TMP/syms" | sort -u | wc -l), distinct tickers $(cut -d' ' -f6 "$TMP/syms" | sort -u | wc -l), first alert $(tail -1 "$TMP/syms" | cut -d' ' -f3 | cut -c1-16), last $(head -1 "$TMP/syms" | cut -d' ' -f3 | cut -c1-16)"
SYM=$(sed -n '40p' "$TMP/syms" | cut -d' ' -f2); TK=$(sed -n '40p' "$TMP/syms" | cut -d' ' -f6)
echo "sample alert (line 40): ask $(sed -n '40p' "$TMP/syms" | cut -d' ' -f4) bid $(sed -n '40p' "$TMP/syms" | cut -d' ' -f5) at $(sed -n '40p' "$TMP/syms" | cut -d' ' -f3 | cut -c1-19)"
echo "contract historic -> $(G "/api/option-contract/$SYM/historic")"
node -e '(function(){const j=JSON.parse(require("fs").readFileSync(process.argv[1]));const d=j.chains||j.data||[];const rows=Array.isArray(d)?d:[];console.log("   top keys "+Object.keys(j).join(",")+" rows "+rows.length+" keys "+Object.keys(rows[0]||{}).join(","));const day=process.argv[2];const hit=rows.filter(r=>String(r.date).slice(0,10)>=day).slice(-4);for(const r of hit)console.log("   "+String(r.date).slice(0,10)+" bid "+r.nbbo_bid+" ask "+r.nbbo_ask+" last "+r.last_price+" high "+r.high_price+" low "+r.low_price+" open "+r.open_price+" vol "+r.volume+" oi "+r.open_interest);console.log("   dates "+String((rows[rows.length-1]||{}).date).slice(0,10)+" .. "+String((rows[0]||{}).date).slice(0,10))})()' "$TMP/r" "$DAY" 2>&1 | head -8
echo "contract intraday for that day -> $(G "/api/option-contract/$SYM/intraday?date=$DAY")"
node -e '(function(){const j=JSON.parse(require("fs").readFileSync(process.argv[1]));const d=j.data||[];console.log("   rows "+d.length+" keys "+Object.keys(d[0]||{}).join(",")+"\n   first "+JSON.stringify(d[0]||{}).slice(0,260)+"\n   last "+JSON.stringify(d[d.length-1]||{}).slice(0,200))})()' "$TMP/r" 2>&1 | head -4
echo "ticker daily bars -> $(G "/api/stock/$TK/ohlc/1d?limit=30")"
node -e '(function(){const j=JSON.parse(require("fs").readFileSync(process.argv[1]));const d=j.data||[];console.log("   rows "+d.length+" keys "+Object.keys(d[0]||{}).join(",")+" dates "+String((d[d.length-1]||{}).start_time||(d[d.length-1]||{}).date).slice(0,10)+" .. "+String((d[0]||{}).start_time||(d[0]||{}).date).slice(0,10))})()' "$TMP/r" 2>&1 | head -2
echo "ticker 5m bars on a past day -> $(G "/api/stock/$TK/ohlc/5m?date=$DAY&limit=120")"
node -e '(function(){const j=JSON.parse(require("fs").readFileSync(process.argv[1]));const d=j.data||[];console.log("   rows "+d.length+" span "+String((d[d.length-1]||{}).start_time).slice(0,16)+" .. "+String((d[0]||{}).start_time).slice(0,16))})()' "$TMP/r" 2>&1 | head -2
echo "SPY 5m bars 45 days ago -> $(G "/api/stock/SPY/ohlc/5m?date=$(date -u -d '45 days ago' +%Y-%m-%d)&limit=120")"
node -e '(function(){const j=JSON.parse(require("fs").readFileSync(process.argv[1]));const d=j.data||[];console.log("   rows "+d.length+" span "+String((d[d.length-1]||{}).start_time).slice(0,16)+" .. "+String((d[0]||{}).start_time).slice(0,16))})()' "$TMP/r" 2>&1 | head -2
# speed: 40 contract histories, 8 at a time
cut -d' ' -f2 "$TMP/syms" | sort -u | head -40 > "$TMP/s40"; S=$(date +%s.%N)
xargs -P 8 -I{} curl -s --max-time 60 -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $T" "$B/api/option-contract/{}/historic" < "$TMP/s40" | sort | uniq -c | tr '\n' ' '; echo "in $(echo "$(date +%s.%N) - $S" | bc | cut -c1-5)s for 40 contract histories"
echo "runner: $(python3 --version 2>&1), cores $(nproc), mem $(free -g | awk '/Mem/{print $2}')G"
