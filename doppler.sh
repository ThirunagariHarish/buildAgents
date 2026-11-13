#!/usr/bin/env bash
# Names only: which Doppler projects sync into the cluster, and where GOOGLE_* keys exist.
set -uo pipefail
KC="kubectl --kubeconfig ${KCFG} --request-timeout=20s"
echo "== DopplerSecrets =="
$KC get dopplersecrets -A -o json 2>&1 | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{console.log(s.slice(0,300));return}
for(const d of j.items||[]){const sp=d.spec||{};const ms=sp.managedSecret||{};const ts=sp.tokenSecret||{};
console.log(`${d.metadata.namespace}/${d.metadata.name}: project=${sp.project||"(from token)"} config=${sp.config||"(from token)"} -> secret ${ms.namespace||"?"}/${ms.name||"?"}; token in ${ts.namespace||d.metadata.namespace}/${ts.name||"?"}; ready=${((d.status||{}).conditions||[]).map(c=>c.type+":"+c.status).join(",")}`)}})'
echo "== secrets in any namespace with GOOGLE or DISCORD keys (names only) =="
$KC get secrets -A -o json 2>/dev/null | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);
for(const x of j.items||[]){const ks=Object.keys(x.data||{}).filter(k=>/GOOGLE|DISCORD|OAUTH/i.test(k));if(ks.length)console.log(`${x.metadata.namespace}/${x.metadata.name}: ${ks.join(", ")}`)}})'
echo "== namespaces =="
$KC get ns --no-headers 2>/dev/null | awk '{print $1}' | tr '\n' ' '; echo
