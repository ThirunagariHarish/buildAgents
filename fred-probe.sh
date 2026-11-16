#!/usr/bin/env bash
# Which public FRED series answer from the cluster, with their last two readings (public data).
set -uo pipefail
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"; NS=unusual-options-detector
POD=$($KC -n $NS get pods --no-headers | awk '/worker/ && /Running/ {print $1; exit}')
$KC -n $NS exec "$POD" -c worker -- node -e '
const ids=process.argv.slice(1);
(async()=>{for(const id of ids){try{const r=await fetch("https://fred.stlouisfed.org/graph/fredgraph.csv?id="+id+"&cosd=2025-06-01",{headers:{"user-agent":"Mozilla/5.0 (compatible; reader)"},signal:AbortSignal.timeout(25000)});const t=await r.text();const l=t.trim().split("\n").filter(x=>!/,\.?$/.test(x)&&!x.endsWith(",."));console.log(id+" "+r.status+" rows "+(l.length-1)+" | "+l.slice(-2).join(" ; "))}catch(e){console.log(id+" failed "+String(e.cause&&e.cause.code||e.message).slice(0,60))}}})()' \
  CPIAUCSL CPILFESL PCEPILFE UNRATE PAYEMS ICSA DGS2 DGS10 T10Y2Y T10Y3M DFF BAMLH0A0HYM2 DTWEXBGS NFCI VIXCLS DCOILWTI UMCSENT INDPRO RSAFS HOUST GACDFSA066MSFRBPHI SP500 NASDAQCOM T5YIE WALCL MORTGAGE30US 2>&1 | cut -c1-200
