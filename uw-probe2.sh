#!/usr/bin/env bash
# Unusual Whales details: condition values, timestamp formats, pagination, full-tape size and columns. No token, no row values beyond codes.
set -uo pipefail
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
T=$($KC -n selfagentbot get secret selfagentbot-credentials -o jsonpath='{.data.UNUSUAL_WHALES_API_TOKEN}' | base64 -d | tr -d '\r\n ')
B=https://api.unusualwhales.com
H=(-H "Authorization: Bearer $T" -H 'Accept: application/json')
# 2026-11-13 14:30-14:45 UTC (09:30-09:45 ET): SPY,NVDA page 1 and 2
N=$(date -u -d '2026-11-13T14:30:00Z' +%s); O=$(date -u -d '2026-11-13T14:45:00Z' +%s)
curl -s "${H[@]}" "$B/api/option-trades?ticker_symbol=SPY,NVDA&newer_than=$N&older_than=$O&limit=500" > "$TMP/p1.json"
node -e '
const j=JSON.parse(require("fs").readFileSync(process.argv[1]));const d=j.data||[];
const c=(k)=>{const m={};for(const r of d){for(const v of [].concat(r[k]??"null"))m[v]=(m[v]||0)+1}return JSON.stringify(m)};
console.log("page1 rows "+d.length+"; keys: "+Object.keys(j).join(","));
if(d.length){console.log("first executed_at "+d[0].executed_at+", last "+d[d.length-1].executed_at);
console.log("nbbo_bid_time sample: "+d[0].nbbo_bid_time+"; nbbo types bid="+typeof d[0].nbbo_bid);
console.log("upstream_condition_detail: "+c("upstream_condition_detail"));console.log("report_flags: "+c("report_flags"));
console.log("canceled: "+c("canceled"));console.log("exchange: "+c("exchange"));console.log("trading_hours: "+c("trading_hours"));
console.log("tags (side): "+JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(c("tags"))).filter(([k])=>/side/.test(k)))));
console.log("underlying_symbol: "+c("underlying_symbol"));console.log("option_chain_id example form: "+String(d[0].option_chain_id).replace(/\d/g,"9"));
console.log("nbbo null rows: "+d.filter(r=>r.nbbo_bid==null||r.nbbo_ask==null).length+"; nbbo time null: "+d.filter(r=>!r.nbbo_bid_time||!r.nbbo_ask_time).length);
console.log("id form: "+String(d[0].id).replace(/[0-9a-f]/g,"x"))}' "$TMP/p1.json"
LAST=$(node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1])).data||[];if(d.length)console.log(Date.parse(d[d.length-1].executed_at.replace(" ","T")))' "$TMP/p1.json")
[ -n "$LAST" ] && curl -s "${H[@]}" "$B/api/option-trades?ticker_symbol=SPY,NVDA&newer_than=$N&older_than=$LAST&limit=500" | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>{const d=JSON.parse(s).data||[];console.log("page2 (older_than=last ms): rows "+d.length+(d.length?", first "+d[0].executed_at+", last "+d[d.length-1].executed_at:""))})'
echo "count for full 15 min SPY,NVDA (paging):"
o=$O; tot=0; pages=0
while [ $pages -lt 200 ]; do
  curl -s "${H[@]}" "$B/api/option-trades?ticker_symbol=SPY,NVDA&newer_than=$N&older_than=$o&limit=500" > "$TMP/p.json"
  r=$(node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1])).data||[];console.log(d.length+" "+(d.length?Date.parse(d[d.length-1].executed_at.replace(" ","T")):0))' "$TMP/p.json")
  n=${r%% *}; l=${r##* }; tot=$((tot+n)); pages=$((pages+1)); [ "$n" -lt 500 ] && break; o=$l
done
echo "  $tot trades in $pages pages"
echo "older date via /api/option-trades: $(curl -s "${H[@]}" "$B/api/option-trades?ticker_symbol=SPY&newer_than=$(date -u -d '2026-11-12T14:30:00Z' +%s)&older_than=$(date -u -d '2026-11-12T14:45:00Z' +%s)&limit=5" | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>{try{const j=JSON.parse(s);console.log("rows "+(j.data||[]).length+(j.message?" "+j.message:""))}catch{console.log(s.slice(0,100))}})')"
echo "== full tape =="
U=$(curl -s -o /dev/null -w '%{redirect_url}' "${H[@]}" "$B/api/option-trades/full-tape/2026-11-12")
echo "size: $(curl -s -I "$U" | grep -i content-length | tr -d '\r')"
curl -s -r 0-3000000 "$U" -o "$TMP/head.zip"
node -e '
const b=require("fs").readFileSync(process.argv[1]);const z=require("zlib");
if(b.readUInt32LE(0)!==0x04034b50){console.log("not a zip local header");return}
const method=b.readUInt16LE(8),flags=b.readUInt16LE(6),csize=b.readUInt32LE(18),nlen=b.readUInt16LE(26),xlen=b.readUInt16LE(28);
const name=b.slice(30,30+nlen).toString();console.log("entry "+name+" method "+method+" flags "+flags+" csize "+csize);
const data=b.slice(30+nlen+xlen);const inf=z.createInflateRaw();let out="";
inf.on("data",c=>{out+=c.toString();if(out.length>4000){inf.destroy();const lines=out.split("\n");console.log("header: "+lines[0]);console.log("cols: "+lines[0].split(",").length+"; row2 shape: "+lines[1].replace(/[0-9]/g,"9").slice(0,400))}});
inf.on("error",()=>{});inf.write(data);' "$TMP/head.zip" 2>&1 | head -8
