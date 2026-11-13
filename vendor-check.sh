#!/usr/bin/env bash
# Read-only: secret key NAMES that look like a market-data vendor key, in any namespace. No values.
set -uo pipefail
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"
$KC get secrets -A -o json 2>/dev/null | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);
for(const x of j.items||[]){const ks=Object.keys(x.data||{}).filter(k=>/POLYGON|MASSIVE|UNUSUAL|WHALES|TRADIER|THETA|DATABENTO|INTRINIO|TRADIER|ALPACA|IEX|FINNHUB|OPRA|CBOE|TASTY|SCHWAB/i.test(k));
if(ks.length)console.log(`${x.metadata.namespace}/${x.metadata.name}: ${ks.join(", ")}`)}})'
echo "settings rows in the app (configured or not):"
NS=unusual-options-detector
$KC -n $NS exec statefulset/$NS-db -c postgres -- sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "SELECT key, (value_enc IS NOT NULL OR value_plain IS NOT NULL) FROM settings WHERE key LIKE '"'"'%key%'"'"' OR key LIKE '"'"'discord%'"'"' ORDER BY key"' 2>&1
