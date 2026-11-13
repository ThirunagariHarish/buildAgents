#!/usr/bin/env bash
set -uo pipefail
KC="kubectl --kubeconfig ${KCFG} --request-timeout=20s"
echo "== DopplerSecret spec fields the operator supports =="
$KC get crd dopplersecrets.secrets.doppler.com -o json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);for(const v of j.spec.versions){const p=v.schema.openAPIV3Schema.properties.spec.properties;console.log(v.name+": "+Object.keys(p).join(", "));}})'
$KC get deploy -n doppler-operator-system -o jsonpath='{range .items[*]}{.metadata.name}: {.spec.template.spec.containers[*].image}{"\n"}{end}' 2>/dev/null
echo "== Google client fingerprints (sha256, first 10) =="
for ns in idea-deck jobplatform midas plainview selfagentbot ytclipper; do
  for s in $($KC -n $ns get secrets -o name 2>/dev/null); do
    $KC -n $ns get $s -o json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s),d=j.data||{};if(!d.GOOGLE_CLIENT_ID)return;const h=k=>d[k]?require("crypto").createHash("sha256").update(Buffer.from(d[k],"base64")).digest("hex").slice(0,10):"none";console.log(`${j.metadata.namespace}/${j.metadata.name}: id ${h("GOOGLE_CLIENT_ID")} secret ${h("GOOGLE_CLIENT_SECRET")}`)})'
  done
done
echo "== secrets in the doppler namespaces (names and key names) =="
for ns in doppler doppler-operator-system; do $KC -n $ns get secrets -o json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const x of JSON.parse(s).items)console.log(`${x.metadata.namespace}/${x.metadata.name} (${x.type}): ${Object.keys(x.data||{}).join(", ")}`)})'; done
echo "== what each Doppler token can see (no values) =="
for ns in analyst-team jobplatform midas selfagentbot ytclipper; do
  t=$($KC -n $ns get secret doppler-token-secret -o jsonpath='{.data.serviceToken}' 2>/dev/null | base64 -d)
  [ -z "$t" ] && { echo "$ns: no serviceToken key"; continue; }
  curl -s -u "$t:" "https://api.doppler.com/v3/configs/config/secrets/download?format=json&include_dynamic_secrets=false" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(process.argv[1]+": project "+(j.DOPPLER_PROJECT||"?")+", config "+(j.DOPPLER_CONFIG||"?")+", has google: "+(j.GOOGLE_CLIENT_ID?"yes":"no"))}catch{console.log(process.argv[1]+": unreadable")}})' "$ns"
done
