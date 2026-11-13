#!/usr/bin/env bash
# Unusual Whales full tape: zip layout and CSV columns (digits masked); per-contract intraday fields. No values.
set -uo pipefail
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
T=$($KC -n selfagentbot get secret selfagentbot-credentials -o jsonpath='{.data.UNUSUAL_WHALES_API_TOKEN}' | base64 -d | tr -d '\r\n ')
B=https://api.unusualwhales.com
for D in 2026-11-12 2026-10-20 2026-10-01 2026-09-15; do
  echo "full-tape $D -> $(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $T" "$B/api/option-trades/full-tape/$D")"
done
U=$(curl -s -o /dev/null -w '%{redirect_url}' -H "Authorization: Bearer $T" "$B/api/option-trades/full-tape/2026-11-12")
curl -s -r 0-4000000 "$U" -o "$TMP/head.zip"
curl -s -r -200000 "$U" -o "$TMP/tail.zip"
node -e '(function(){
const b=require("fs").readFileSync(process.argv[1]);const z=require("zlib");
console.log("magic "+b.readUInt32LE(0).toString(16));
const method=b.readUInt16LE(8),flags=b.readUInt16LE(6),csize=b.readUInt32LE(18),usize=b.readUInt32LE(22),nlen=b.readUInt16LE(26),xlen=b.readUInt16LE(28);
console.log("entry "+b.slice(30,30+nlen).toString()+" method "+method+" flags "+flags+" csize "+csize.toString(16)+" usize "+usize.toString(16)+" extra "+xlen);
const data=b.slice(30+nlen+xlen);let out=Buffer.alloc(0);
try{out=z.inflateRawSync(data,{finishFlush:z.constants.Z_SYNC_FLUSH})}catch(e){console.log("inflate: "+e.message)}
const s=out.toString();const lines=s.split("\n");console.log("header: "+lines[0]);
console.log("cols "+lines[0].split(",").length);
for(const i of [1,2,3]) console.log("row"+i+": "+(lines[i]||"").replace(/[0-9]/g,"9").replace(/[a-f9]{8}-[a-f9]{4}-[a-f9]{4}-[a-f9]{4}-[a-f9]{12}/g,"<uuid>").slice(0,700));
console.log("first ts-ish fields: "+(lines[1]||"").split(",").filter(x=>/T\d\d:|\d\d:\d\d:\d\d/.test(x)).slice(0,4).join(" | "));
})()' "$TMP/head.zip" 2>&1 | head -12
node -e '(function(){const b=require("fs").readFileSync(process.argv[1]);let n=0;for(let i=b.length-22;i>=0;i--){if(b.readUInt32LE(i)===0x02014b50){n++}}console.log("central dir entries in tail: "+n);for(let i=b.length-22;i>=0;i--){if(b.readUInt32LE(i)===0x06054b50){console.log("EOCD entries "+b.readUInt16LE(i+10));break}}})()' "$TMP/tail.zip"
G() { curl -s --max-time 60 -o "$TMP/r" -w '%{http_code}' -H "Authorization: Bearer $T" -H 'Accept: application/json' "$B$1"; }
echo "intraday -> $(G "/api/option-contract/SPY261120C00680000/intraday?date=2026-11-12")"
node -e '(function(){const j=JSON.parse(require("fs").readFileSync(process.argv[1]));const d=j.data||[];console.log("  rows "+d.length+"; fields "+(d[0]?Object.entries(d[0]).map(([k,v])=>k+":"+(v===null?"null":typeof v)).join(" "):""))})()' "$TMP/r"
