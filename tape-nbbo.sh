#!/usr/bin/env bash
# Do older tape files carry the NBBO and its time? Header, masked rows, and stored side counts per day. No values.
set -uo pipefail
NS=unusual-options-detector
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"; K="$KC -n $NS"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
T=$($KC -n selfagentbot get secret selfagentbot-credentials -o jsonpath='{.data.UNUSUAL_WHALES_API_TOKEN}' | base64 -d | tr -d '\r\n ')
B=https://api.unusualwhales.com
for D in 2026-08-21 2026-09-15 2026-10-15 2026-11-12; do
  U=$(curl -s -o /dev/null -w '%{redirect_url}' -H "Authorization: Bearer $T" "$B/api/option-trades/full-tape/$D")
  curl -s -r 0-6000000 "$U" -o "$TMP/head.zip"
  echo "== $D =="
  node -e '(function(){
const b=require("fs").readFileSync(process.argv[1]);const z=require("zlib");
const nlen=b.readUInt16LE(26),xlen=b.readUInt16LE(28);
const data=b.slice(30+nlen+xlen);let out=Buffer.alloc(0);
try{out=z.inflateRawSync(data,{finishFlush:z.constants.Z_SYNC_FLUSH})}catch(e){console.log("inflate: "+e.message)}
const lines=out.toString().split("\n");const h=lines[0].split(",");
console.log("cols "+h.length+"; nbbo cols: "+h.map((c,i)=>c+"@"+i).filter(c=>/nbbo|executed|ewma/.test(c)).join(" "));
const ix=(n)=>h.indexOf(n);const rows=lines.slice(1,-1).map(l=>l.split(","));
const filled=(n)=>ix(n)<0?"absent":rows.filter(r=>r[ix(n)]!==""&&r[ix(n)]!==undefined).length+"/"+rows.length;
for(const n of ["nbbo_bid","nbbo_ask","nbbo_bid_time","nbbo_ask_time","ewma_nbbo_bid","ewma_nbbo_ask"]) console.log("  "+n+" filled "+filled(n));
const mask=(s)=>String(s).replace(/[0-9]/g,"9");
for(const r of rows.slice(0,2)) console.log("  sample: executed_at="+mask(r[ix("executed_at")])+" nbbo_bid="+mask(r[ix("nbbo_bid")])+" nbbo_bid_time="+mask(r[ix("nbbo_bid_time")])+" nbbo_ask_time="+mask(r[ix("nbbo_ask_time")]));
})()' "$TMP/head.zip" 2>&1 | head -12
done
Q() { $K exec statefulset/$NS-db -c postgres -- sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -At -F ' | ' -c \"$1\"" 2>&1; }
echo "stored historical prints by day and side (first and last days):"
Q "SELECT (trade_ts AT TIME ZONE 'America/New_York')::date, count(*), count(*) FILTER (WHERE side='unknown') AS unknown, count(*) FILTER (WHERE nbbo_bid IS NULL) AS no_nbbo FROM raw_prints WHERE source='historical' GROUP BY 1 ORDER BY 1" | (head -8; echo ...; tail -4)
echo "historical quotes by day:"
Q "SELECT (quote_ts AT TIME ZONE 'America/New_York')::date, count(*) FROM quotes WHERE source='historical' GROUP BY 1 ORDER BY 1" | tail -8
