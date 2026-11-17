#!/usr/bin/env bash
# Read-only: after a deploy, sign in and check the Options API and pages. Statuses and counts only.
set -uo pipefail
NS=unusual-options-detector
SITE=https://$NS.cashflowus.com
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"; K="$KC -n $NS"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
sleep 60
echo "health: $(curl -s --max-time 20 $SITE/api/health | cut -c1-120); now ET: $(TZ=America/New_York date '+%a %T')"
$K get secret $NS-env -o json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s).data;const v=k=>Buffer.from(d[k],"base64").toString();require("fs").writeFileSync(process.argv[1],JSON.stringify({email:v("FIRST_ADMIN_EMAIL"),password:v("FIRST_ADMIN_PASSWORD")}))})' "$TMP/l.json"
echo "admin sign-in: $(curl -s -o /dev/null -c "$TMP/jar" -w '%{http_code}' --max-time 20 -X POST "$SITE/api/auth/sign-in/email" -H 'Content-Type: application/json' -H "Origin: $SITE" --data-binary @"$TMP/l.json")"
rm -f "$TMP/l.json"
G() { curl -s -o "$TMP/r" -b "$TMP/jar" -w '%{http_code}' --max-time 40 "$SITE$1"; }
J() { node -e '(function(){let j;try{j=JSON.parse(require("fs").readFileSync(process.argv[1]))}catch{console.log("not json");return}try{console.log(String(eval(process.argv[2])).slice(0,460))}catch(e){console.log("shape: "+String(e).slice(0,120))}})()' "$TMP/r" "$1"; }
for H in intraday swing; do
echo "ideas $H -> $(G "/api/trader/ideas?horizon=$H") $(J '"date="+j.trading_date+" live="+j.live+" total="+j.total+" shown="+j.ideas.length+" card="+JSON.stringify({n:j.scorecard.ideas,w:j.scorecard.wins,l:j.scorecard.losses,nq:j.scorecard.no_quote,pending:j.scorecard.pending,ahead:j.scorecard.ahead,behind:j.scorecard.behind,spy:j.scorecard.spy_move})+" type="+j.scorecard.by_type.map(t=>t.type+":"+t.ideas+"/"+t.wins+"/"+t.losses).join(",")+" tiers="+j.scorecard.by_tier.map(t=>t.tier+":"+t.ideas+"/"+t.wins+"/"+t.losses).join(",")+" off_list_shown="+j.ideas.filter(i=>i.off_list).length')"
done
echo "everything -> $(G "/api/trader/ideas?min_score=0") $(J '"shown="+j.ideas.length+" off_list="+JSON.stringify(j.ideas.reduce((m,i)=>{m[i.off_list||"listable"]=(m[i.off_list||"listable"]||0)+1;return m},{}))')"
echo "status -> $(G /api/trader/status) $(J '"market="+j.market+" late="+j.late')"
for P in / "/?view=swing" /direction /chatter /news /macro /status /me; do printf "%s -> %s; " "$P" "$(curl -s -o /dev/null -b "$TMP/jar" -w '%{http_code}' --max-time 30 "$SITE$P")"; done; echo
echo "recent web errors: $($K logs deploy/$NS --since=10m 2>/dev/null | grep -i -E 'error|unhandled' | tail -3 | sed -E 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/<email>/g' | cut -c1-240)"
echo "recent worker errors: $($K logs deploy/$NS-worker --since=10m 2>/dev/null | grep -i -E 'failed|unhandled' | tail -3 | cut -c1-260)"
