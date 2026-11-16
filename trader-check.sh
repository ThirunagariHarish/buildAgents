#!/usr/bin/env bash
# After the trader rebuild deploys: wait for the live job's catch-up, then sign in as the admin and check the five tabs. Counts and statuses only.
set -uo pipefail
NS=unusual-options-detector
SITE=https://$NS.cashflowus.com
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"; K="$KC -n $NS"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
Q() { $K exec statefulset/$NS-db -c postgres -- sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -At -F ' | ' -c \"$1\"" 2>&1; }
echo "health: $(curl -s --max-time 20 $SITE/api/health | cut -c1-160)"
echo "forced daily read: $(Q "DELETE FROM markets_state WHERE key = 'daily'")"
for i in $(seq 1 60); do
  L=$($K logs deploy/$NS-worker --since=40m 2>/dev/null | grep -E '"trader( failed)?"' | tail -3)
  echo "$L" | grep -q -E '"msg":"trader' && break; sleep 15
done
echo "trader log:"; echo "$L" | cut -c1-420
for i in $(seq 1 40); do
  M=$($K logs deploy/$NS-worker --since=40m 2>/dev/null | grep -E '"markets (read|failed)"' | tail -1)
  [ -n "$M" ] && break; sleep 15
done
echo "markets log: $(echo "$M" | cut -c1-300)"
echo "settings: $(Q "SELECT key, value_plain FROM settings WHERE key IN ('legacy_signals','show_trader','show_chatter') ORDER BY 1" | tr '\n' ';')"
echo "ideas: $(Q "SELECT trade_date, horizon, count(*), count(*) FILTER (WHERE score >= 60), min(seen_at)::time(0), max(seen_at)::time(0) FROM option_ideas GROUP BY 1, 2 ORDER BY 1, 2" | tr '\n' ';')"
echo "alerts counted: $(Q "SELECT count(*) FROM idea_alerts"); marks: $(Q "SELECT count(*), count(DISTINCT option_symbol), max(marked_at)::timestamp(0) FROM idea_marks")"
echo "outcomes: $(Q "SELECT i.horizon, o.status, count(*), round(avg(o.ret)::numeric, 3) FROM idea_outcomes o JOIN option_ideas i ON i.id = o.idea_id GROUP BY 1, 2 ORDER BY 1, 2" | tr '\n' ';')"
echo "tiers: $(Q "SELECT tier, lean, count(*) FROM option_ideas GROUP BY 1, 2 ORDER BY 1, 2" | tr '\n' ';')"
echo "series: $(Q "SELECT split_part(name, ':', 1), count(DISTINCT name), count(*), max(ts)::timestamp(0) FROM live_series GROUP BY 1 ORDER BY 1" | tr '\n' ';')"
echo "models: $(Q "SELECT horizon, version, in_use, samples FROM idea_models ORDER BY version DESC LIMIT 4" | tr '\n' ';'); direction calls: $(Q "SELECT count(*) FROM direction_calls")"
echo "headlines: $(Q "SELECT count(*), count(*) FILTER (WHERE cardinality(tickers) > 0), count(*) FILTER (WHERE tone <> 0), max(created_at)::timestamp(0) FROM headlines"); vendor sentiment: $(Q "SELECT coalesce(vendor_sentiment, 'null'), count(*) FROM headlines GROUP BY 1 ORDER BY 2 DESC LIMIT 5" | tr '\n' ';')"
echo "earnings: $(Q "SELECT report_date, count(*) FROM earnings_calendar GROUP BY 1 ORDER BY 1" | tr '\n' ';')"
echo "macro: $(Q "SELECT count(DISTINCT series), count(*), max(date) FROM macro_series")"
echo "chatter: $(Q "SELECT count(*), max(posted_at)::timestamp(0) FROM chatter_mentions"); channels read: $(Q "SELECT count(*), max(last_polled_at)::timestamp(0) FROM chatter_channels")"
$K get secret $NS-env -o json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s).data;const v=k=>Buffer.from(d[k],"base64").toString();require("fs").writeFileSync(process.argv[1],JSON.stringify({email:v("FIRST_ADMIN_EMAIL"),password:v("FIRST_ADMIN_PASSWORD")}))})' "$TMP/l.json"
echo "admin sign-in: $(curl -s -o /dev/null -c "$TMP/jar" -w '%{http_code}' --max-time 20 -X POST "$SITE/api/auth/sign-in/email" -H 'Content-Type: application/json' -H "Origin: $SITE" --data-binary @"$TMP/l.json")"
rm -f "$TMP/l.json"
G() { curl -s -o "$TMP/r" -b "$TMP/jar" -w '%{http_code}' --max-time 40 "$SITE$1"; }
J() { node -e '(function(){let j;try{j=JSON.parse(require("fs").readFileSync(process.argv[1]))}catch{console.log("not json");return}try{console.log(String(eval(process.argv[2])).slice(0,420))}catch(e){console.log("shape: "+String(e).slice(0,120))}})()' "$TMP/r" "$1"; }
echo "/api/me -> $(G /api/me) $(J '"trader="+j.trader+" chatter="+j.chatter')"
for H in intraday swing; do
  echo "ideas $H -> $(G "/api/trader/ideas?horizon=$H") $(J '"date="+j.trading_date+" live="+j.live+" dates="+j.dates.length+" shown="+j.ideas.length+" total="+j.total+" card="+JSON.stringify({w:j.scorecard.wins,l:j.scorecard.losses,nq:j.scorecard.no_quote,pending:j.scorecard.pending,ahead:j.scorecard.ahead,behind:j.scorecard.behind,avg:j.scorecard.avg_ret,due:j.scorecard.due})+" tiers="+j.scorecard.by_tier.map(t=>t.tier+":"+t.ideas+"/"+t.wins+"/"+t.losses).join(",")+" model="+JSON.stringify({v:j.model.version,use:j.model.in_use,graded:j.model.graded,days:j.model.graded_days})')"
done
echo "top idea -> $(G "/api/trader/ideas") $(J 'const i=j.ideas[0];i?JSON.stringify({score:i.score,tier:i.tier,lean:i.lean,type:i.option_type,dte:i.dte,premium:Math.round(i.premium),ask_share:i.ask_share&&+i.ask_share.toFixed(2),has_ask:i.ask!==null,itm:i.prob_itm,be:i.prob_break_even&&+i.prob_break_even.toFixed(2),factors:i.factors.length,now:!!i.now,outcome:i.outcome&&i.outcome.status}):"none"')"
echo "direction -> $(G /api/trader/direction) $(J '"date="+j.read.trading_date+" lean="+j.read.lean+" score="+j.read.score+" spot="+(j.read.spot!==null)+" prev="+(j.read.prev_close!==null)+" inputs="+j.read.inputs.map(i=>i.key+":"+(i.value===null?"na":i.vote)).join(",")+" price="+j.price.length+" tide="+j.tide.length+" spyflow="+j.spy_flow.length+" sectors="+j.sectors.length+" gamma="+(j.gamma.net===null?"na":(j.gamma.net>=0?"pos":"neg"))+" vix="+(j.vix?j.vix.date:"na")+" calls="+j.calls.length+" caldays="+j.calendar.length+" events="+j.calendar.reduce((a,d)=>a+d.events.length,0)+" earnings="+j.calendar.reduce((a,d)=>a+d.earnings.length+d.earnings_more,0)+" expirations="+j.calendar.filter(d=>d.expiration).map(d=>d.date).join(",")')"
for S in 1h 24h; do echo "chatter $S -> $(G "/api/trader/chatter?span=$S") $(J '"span="+j.span+" widened="+j.widened+" configured="+j.configured+" rows="+j.rows.length+" read="+(j.last_read_at||"").slice(0,19)+" newest="+(j.last_message_at||"").slice(0,19)+" top="+j.rows.slice(0,5).map(r=>r.ticker+":"+r.mentions+"/"+r.people+"p/"+(r.surge===null?"new":r.surge)).join(",")')"; done
echo "news -> $(G /api/trader/news) $(J '"items="+j.items.length+" newest="+(j.last_headline_at||"").slice(0,19)+" pos="+j.items.filter(i=>i.direction==="positive").length+" neg="+j.items.filter(i=>i.direction==="negative").length+" vendor_basis="+j.items.filter(i=>i.basis==="vendor").length+" with_tickers="+j.items.filter(i=>i.tickers.length).length+" with_move="+j.items.filter(i=>i.tickers.some(t=>t.move!==null)).length+" board="+j.board.slice(0,6).map(b=>b.ticker+":"+b.headlines).join(",")')"
echo "macro -> $(G /api/trader/macro) $(J '"kpis="+j.read.kpis.length+" tail="+j.read.tailwinds+" head="+j.read.headwinds+" growth="+j.read.growth+" inflation="+j.read.inflation+" regime="+j.read.regime+" corr="+(j.read.stock_bond===null?"na":j.read.stock_bond.toFixed(2))+" summary="+j.read.summary.length+" live="+j.live.map(l=>l.ticker+(l.change===null?"":":"+(l.change*100).toFixed(2))).join(",")+" tags="+j.read.kpis.map(k=>k.key+":"+k.tag[0]).join(",")')"
for P in / "/?view=swing" /direction "/direction?view=calendar" /chatter /news /macro /me /today /record /ticker/NVDA; do printf "%s -> %s; " "$P" "$(curl -s -o /dev/null -b "$TMP/jar" -w '%{http_code}' --max-time 30 "$SITE$P")"; done; echo
echo "recent web errors: $($K logs deploy/$NS --since=15m 2>/dev/null | grep -i -E 'error|unhandled' | tail -4 | sed -E 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/<email>/g' | cut -c1-240)"
echo "recent worker errors: $($K logs deploy/$NS-worker --since=30m 2>/dev/null | grep -i -E 'failed|unhandled|error' | tail -5 | sed -E 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/<email>/g' | cut -c1-260)"
