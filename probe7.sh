#!/usr/bin/env bash
# Public files and vendor endpoints for the remaining features: status codes, column names, value types. No private values.
set -uo pipefail
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"; NS=unusual-options-detector
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
UA="Mozilla/5.0 (compatible; reader)"
# These are fetched from inside the cluster (the worker pod), which is where the app would read them.
POD=$($KC -n $NS get pods -l app=$NS-worker -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
[ -z "$POD" ] && POD=$($KC -n $NS get pods --no-headers | awk '/worker/ && /Running/ {print $1; exit}')
echo "pod found: $([ -n "$POD" ] && echo yes || echo no)"
F() { $KC -n $NS exec "$POD" -- node -e '
const u=process.argv[1];
fetch(u,{headers:{"user-agent":"Mozilla/5.0 (compatible; reader)","accept":"*/*"},redirect:"follow",signal:AbortSignal.timeout(25000)}).then(async r=>{const t=await r.text();
const lines=t.split("\n");
console.log("  "+r.status+" "+(r.headers.get("content-type")||"")+" bytes "+t.length);
if(/csv/.test(u)){console.log("  header: "+lines[0].slice(0,200));console.log("  row1: "+(lines[1]||"").slice(0,200));console.log("  rows "+lines.length+" last: "+(lines[lines.length-2]||"").slice(0,120))}
else{const items=(t.match(/<item[\s>]|<entry[\s>]/g)||[]).length;const m=t.match(/<(item|entry)[\s>][\s\S]*?<title[^>]*>([\s\S]*?)<\/title>[\s\S]*?(<link[^>]*href="([^"]+)"|<link[^>]*>([^<]+)<\/link>)/);
console.log("  items "+items+"; first title: "+(m?m[2].replace(/<!\[CDATA\[|\]\]>/g,"").slice(0,80):"?")+"; link: "+(m?(m[4]||m[5]||"").slice(0,90):"?")+"; root: "+(t.match(/<(rss|feed)[\s>]/)||["","?"])[1])}
}).catch(e=>console.log("  failed: "+String(e.cause&&e.cause.code||e.message).slice(0,80)))' "$1" 2>&1 | head -6; }
for U in \
 "https://assets.ark-funds.com/fund-documents/funds-etf-csv/ARK_INNOVATION_ETF_ARKK_HOLDINGS.csv" \
 "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10&cosd=2026-08-01" \
 "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFEDTARU&cosd=2026-08-01" \
 "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFEDTARL&cosd=2026-08-01" \
 "https://www.federalreserve.gov/feeds/press_monetary.xml" \
 "https://aswathdamodaran.blogspot.com/feeds/posts/default" \
 "https://awealthofcommonsense.com/feed/" \
 "https://ofdollarsanddata.com/feed/" \
 "https://www.visualcapitalist.com/feed/" \
 "https://fs.blog/feed/" \
 "https://www.bridgewater.com/research-and-insights.rss" \
 "https://collabfund.com/blog/feed/" ; do echo "$U" | cut -c1-110; F "$U"; done
T=$($KC -n selfagentbot get secret selfagentbot-credentials -o jsonpath='{.data.UNUSUAL_WHALES_API_TOKEN}' | base64 -d | tr -d '\r\n ')
B=https://api.unusualwhales.com
G() { curl -s --max-time 60 -o "$TMP/r" -w '%{http_code}' -H "Authorization: Bearer $T" -H 'Accept: application/json' "$B$1"; }
SHAPE='(function(){let j;try{j=JSON.parse(require("fs").readFileSync(process.argv[1]))}catch(e){console.log("  not json");return}
const d=Array.isArray(j)?j:(j.data===undefined?j:j.data);
const t=(v)=>v===null?"null":Array.isArray(v)?"array":typeof v;
const rows=Array.isArray(d)?d:[d];const m={};for(const r of rows.slice(0,300))for(const [k,v] of Object.entries(r||{})){(m[k]=m[k]||new Set()).add(t(v))}
console.log("  rows "+rows.length+": "+Object.entries(m).map(([k,s])=>k+":"+[...s].join("/")).join(" "));
const ex=process.argv[2]?process.argv[2].split(","):[];
for(const i of [0,rows.length-1]){const r=rows[i]||{};console.log("  row"+i+": "+ex.map(k=>k+"="+JSON.stringify(r[k])).join(" ").slice(0,300))}
})()'
echo "darkpool NVDA -> $(G "/api/darkpool/NVDA?limit=500")"; node -e "$SHAPE" "$TMP/r" "executed_at,market_center,canceled,ext_hour_sold_codes,sale_cond_codes,trade_settlement"
node -e '(function(){const j=JSON.parse(require("fs").readFileSync(process.argv[1]));const d=j.data||[];const days=[...new Set(d.map(r=>String(r.executed_at).slice(0,10)))];console.log("  days in 500 rows: "+days.join(",")+"; price/size/premium types "+typeof d[0].price+"/"+typeof d[0].size+"/"+typeof d[0].premium)})()' "$TMP/r"
echo "darkpool NVDA by date -> $(G "/api/darkpool/NVDA?date=2026-11-13&limit=500")"; node -e '(function(){const j=JSON.parse(require("fs").readFileSync(process.argv[1]));const d=j.data||[];console.log("  rows "+d.length+" "+String((d[0]||{}).executed_at).slice(0,19)+" .. "+String((d[d.length-1]||{}).executed_at).slice(0,19))})()' "$TMP/r"
echo "greek-exposure NVDA -> $(G "/api/stock/NVDA/greek-exposure")"; node -e "$SHAPE" "$TMP/r" "date"
echo "etf holdings QQQ -> $(G "/api/etfs/QQQ/holdings")"; node -e '(function(){const j=JSON.parse(require("fs").readFileSync(process.argv[1]));const d=j.data||[];const w=d.map(r=>Number(r.weight));console.log("  rows "+d.length+"; weight sum "+w.reduce((a,b)=>a+b,0).toFixed(2)+"; max "+Math.max(...w)+"; types "+[...new Set(d.map(r=>r.type))].join(",")+"; null names "+d.filter(r=>!r.name).length)})()' "$TMP/r"
