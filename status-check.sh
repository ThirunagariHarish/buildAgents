#!/usr/bin/env bash
# Read-only: after a deploy, wait for the worker's first reads, then print the status endpoint (every feed's age) and page statuses.
set -uo pipefail
NS=unusual-options-detector
SITE=https://$NS.cashflowus.com
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"; K="$KC -n $NS"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
Q() { $K exec statefulset/$NS-db -c postgres -- sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -At -F ' | ' -c \"$1\"" 2>&1; }
echo "health: $(curl -s --max-time 20 $SITE/api/health | cut -c1-120); now ET: $(TZ=America/New_York date '+%a %T')"
for i in $(seq 1 40); do
  N=$(Q "SELECT count(*) FROM markets_state WHERE key LIKE 'feed:%' AND read_at > now() - interval '15 minutes'")
  [ "${N:-0}" -ge 3 ] 2>/dev/null && break; sleep 15
done
echo "feeds read since deploy: $N"
$K get secret $NS-env -o json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s).data;const v=k=>Buffer.from(d[k],"base64").toString();require("fs").writeFileSync(process.argv[1],JSON.stringify({email:v("FIRST_ADMIN_EMAIL"),password:v("FIRST_ADMIN_PASSWORD")}))})' "$TMP/l.json"
echo "admin sign-in: $(curl -s -o /dev/null -c "$TMP/jar" -w '%{http_code}' --max-time 20 -X POST "$SITE/api/auth/sign-in/email" -H 'Content-Type: application/json' -H "Origin: $SITE" --data-binary @"$TMP/l.json")"
rm -f "$TMP/l.json"
echo "status -> $(curl -s -o "$TMP/r" -b "$TMP/jar" -w '%{http_code}' --max-time 40 "$SITE/api/trader/status")"
node -e '(function(){const j=JSON.parse(require("fs").readFileSync(process.argv[1]));const age=(t)=>t?Math.round((Date.parse(j.as_of)-Date.parse(t))/1000)+"s":"-";console.log("market="+j.market+" session="+j.session+" next_open="+j.next_open+" late="+j.late);for(const f of j.feeds)console.log("  "+f.key.padEnd(11)+f.state.padEnd(8)+" read "+age(f.read_at).padEnd(9)+" newest "+age(f.newest_at).padEnd(9)+(f.note?" ("+f.note.slice(0,60)+")":""))})()' "$TMP/r"
echo "px freshness: $(Q "SELECT substr(name, 4), to_char(now() - max(ts), 'DD\\\"d\\\" HH24:MI') FROM live_series WHERE name IN ('px:SPY','px:QQQ','px:TLT','px:VIXY','px:NVDA') GROUP BY 1 ORDER BY 1" | tr '\n' ';')"
G() { curl -s -o "$TMP/r" -b "$TMP/jar" -w '%{http_code}' --max-time 40 "$SITE$1"; }
J() { node -e '(function(){let j;try{j=JSON.parse(require("fs").readFileSync(process.argv[1]))}catch{console.log("not json");return}try{console.log(String(eval(process.argv[2])).slice(0,400))}catch(e){console.log("shape: "+String(e).slice(0,120))}})()' "$TMP/r" "$1"; }
echo "macro -> $(G /api/trader/macro) $(J '"live_at="+j.live_at+" live="+j.live.map(l=>l.ticker+(l.change===null?"":":"+(l.change*100).toFixed(2))).join(",")+" kpis="+j.read.kpis.length+" corr="+j.read.stock_bond')"
echo "news -> $(G /api/trader/news) $(J '"newest="+j.last_headline_at+" items="+j.items.length+" with_move="+j.items.filter(i=>i.tickers.some(t=>t.move!==null)).length')"
echo "direction -> $(G /api/trader/direction) $(J '"date="+j.read.trading_date+" as_of="+j.read.as_of+" lean="+j.read.lean+" gamma="+j.gamma.net+" sectors="+j.sectors.length')"
echo "ideas -> $(G /api/trader/ideas) $(J '"date="+j.trading_date+" live="+j.live+" total="+j.total+" last_alert="+j.last_alert_at+" last_quote="+j.last_quote_at')"
for P in / /direction /chatter /news /macro /status /me /today /record /ticker/NVDA /login; do printf "%s -> %s; " "$P" "$(curl -s -o /dev/null -b "$TMP/jar" -w '%{http_code}' --max-time 30 "$SITE$P")"; done; echo
echo "font served: $(curl -s -b "$TMP/jar" --max-time 30 "$SITE/" | grep -o '/_next/static/media/[^"]*\.woff2' | head -1 | xargs -I{} curl -s -o /dev/null -w '%{http_code} %{content_type}' --max-time 20 "$SITE{}")"
echo "recent web errors: $($K logs deploy/$NS --since=10m 2>/dev/null | grep -i -E 'error|unhandled' | tail -3 | sed -E 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/<email>/g' | cut -c1-240)"
echo "recent worker errors: $($K logs deploy/$NS-worker --since=10m 2>/dev/null | grep -i -E 'failed|unhandled' | tail -3 | cut -c1-260)"
