#!/usr/bin/env bash
# Unusual Whales filings endpoints: field names and value types only, plus which manager CIKs resolve (public names).
set -uo pipefail
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
T=$($KC -n selfagentbot get secret selfagentbot-credentials -o jsonpath='{.data.UNUSUAL_WHALES_API_TOKEN}' | base64 -d | tr -d '\r\n ')
B=https://api.unusualwhales.com
G() { curl -s --max-time 60 -o "$TMP/r" -w '%{http_code}' -H "Authorization: Bearer $T" -H 'Accept: application/json' "$B$1"; }
SHAPE='(function(){let j;try{j=JSON.parse(require("fs").readFileSync(process.argv[1]))}catch(e){console.log("  not json");return}
const d=Array.isArray(j)?j:(j.data||[]);const top=Array.isArray(j)?"array":Object.keys(j).join(",");
const t=(v)=>v===null?"null":Array.isArray(v)?"array("+(v.length?typeof v[0]:"")+")":typeof v;
const m={};for(const r of (Array.isArray(d)?d:[d]).slice(0,200))for(const [k,v] of Object.entries(r)){(m[k]=m[k]||new Set()).add(t(v))}
console.log("  top: "+top+"; rows "+(Array.isArray(d)?d.length:1));
console.log("  "+Object.entries(m).map(([k,s])=>k+":"+[...s].join("/")).join(" "));
const ex=process.argv[2]?process.argv[2].split(","):[];const r0=(Array.isArray(d)?d:[d])[0]||{};
for(const k of ex) console.log("  example "+k+": "+JSON.stringify(r0[k]).slice(0,80));
})()'
echo "congress recent-trades -> $(G "/api/congress/recent-trades?limit=200")"; node -e "$SHAPE" "$TMP/r" "member_type,txn_type,amounts,transaction_date,filed_at_date,is_active"
node -e '(function(){const j=JSON.parse(require("fs").readFileSync(process.argv[1]));const d=j.data||[];const c=(k)=>{const m={};for(const r of d){m[r[k]]=(m[r[k]]||0)+1}return JSON.stringify(m).slice(0,300)};console.log("  txn_type values: "+c("txn_type"));console.log("  member_type values: "+c("member_type"));console.log("  amounts values: "+c("amounts"));console.log("  null tickers: "+d.filter(r=>!r.ticker).length+"; dates "+d.map(r=>r.filed_at_date).sort()[0]+" .. "+d.map(r=>r.filed_at_date).sort().pop())})()' "$TMP/r"
echo "congress page 2 -> $(G "/api/congress/recent-trades?limit=200&page=2")"; node -e "$SHAPE" "$TMP/r"
echo "insider transactions -> $(G "/api/insider/transactions?limit=200&common_stock_only=true")"; node -e "$SHAPE" "$TMP/r" "transaction_code,security_ad_code,amount,price,transactions,formtype,transaction_date,filing_date,is_10b5_1,ids"
node -e '(function(){const j=JSON.parse(require("fs").readFileSync(process.argv[1]));const d=j.data||[];const c=(k)=>{const m={};for(const r of d){m[r[k]]=(m[r[k]]||0)+1}return JSON.stringify(m).slice(0,300)};console.log("  codes: "+c("transaction_code")+" ad: "+c("security_ad_code")+" form: "+c("formtype"));console.log("  top keys: "+Object.keys(j).join(",")+"; cursor "+JSON.stringify(j.cursor||null).replace(/[0-9]/g,"9").slice(0,120)+"; filing dates "+d.map(r=>r.filing_date).sort()[0]+" .. "+d.map(r=>r.filing_date).sort().pop()+"; negative amounts "+d.filter(r=>r.amount<0).length)})()' "$TMP/r"
echo "insider purchases -> $(G "/api/insider/transactions?limit=200&common_stock_only=true&transaction_codes[]=P")"; node -e '(function(){const j=JSON.parse(require("fs").readFileSync(process.argv[1]));const d=j.data||[];console.log("  rows "+d.length+"; filing dates "+d.map(r=>r.filing_date).sort()[0]+" .. "+d.map(r=>r.filing_date).sort().pop()+"; codes "+[...new Set(d.map(r=>r.transaction_code))].join(","))})()' "$TMP/r"
echo "holdings (berkshire by cik) -> $(G "/api/institution/0001067983/holdings?limit=500")"; node -e "$SHAPE" "$TMP/r" "date,security_type,put_call,perc_of_total,units,units_change,value,first_buy,historical_units"
echo "institution by cik -> $(G "/api/institutions?name=0001067983")"; node -e "$SHAPE" "$TMP/r" "date,filing_date,total_value,share_value,is_hedge_fund,people,tags"
for C in 0001067983 0001350694 0001336528 0001649339 0001656456 0001536411 0001061768 0001040273 0001079114 0001167483 0001135730 0001037389 0001029160 0001061165 0001103804 0000949509 0001697748 0000921669 0001709323 0001112520; do
  code=$(G "/api/institutions?name=$C")
  node -e '(function(){let j;try{j=JSON.parse(require("fs").readFileSync(process.argv[1]))}catch(e){console.log(process.argv[2]+" "+process.argv[3]+" not json");return}const d=j.data||[];console.log(process.argv[2]+" "+process.argv[3]+" rows "+d.length+" | "+d.slice(0,2).map(r=>r.name+" ["+r.cik+"] filed "+r.filing_date+" for "+r.date).join(" ; "))})()' "$TMP/r" "$C" "$code"
done
