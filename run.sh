#!/usr/bin/env bash
# Read-only checks of the Unusual Options Detector sign-in. Prints no secret
# values and masks every email (this output is public).
set -uo pipefail
NS=unusual-options-detector
SITE=https://unusual-options-detector.cashflowus.com
K="kubectl --kubeconfig /etc/box-kubeconfig -n $NS"
mask() { sed -E 's/([A-Za-z0-9._%+-]{1,2})[A-Za-z0-9._%+-]*@/\1***@/g'; }
TMP=$(mktemp -d); chmod 700 "$TMP"; trap 'rm -rf "$TMP"' EXIT

echo "== pods and jobs =="
$K get pods -o wide 2>&1 | awk '{print $1, $2, $3, $4, $5}' | column -t
$K get jobs 2>&1 | column -t
echo "images: $($K get deploy -o jsonpath='{range .items[*]}{.metadata.name}={.spec.template.spec.containers[0].image}{"\n"}{end}' 2>&1 | sed 's#ghcr.io/thirunagariharish/unusual-options-detector:##' | cut -c1-80 | tr '\n' ' ')"
echo "recent warnings:"; $K get events --field-selector type=Warning --sort-by=.lastTimestamp 2>/dev/null | tail -8 | cut -c1-200

echo "== the app's Secret (key names only) =="
$K get secret $NS-env -o json > "$TMP/secret.json" 2>/dev/null || echo "secret not readable"
node -e '
const s=JSON.parse(require("fs").readFileSync(process.argv[1])).data||{};
const d=(k)=>s[k]?Buffer.from(s[k],"base64").toString():"";
console.log("keys: "+Object.keys(s).sort().join(", "));
const e=d("FIRST_ADMIN_EMAIL"), p=d("FIRST_ADMIN_PASSWORD");
console.log("FIRST_ADMIN_EMAIL: "+(e?e.replace(/^(.{2}).*@/,"$1***@"):"MISSING"));
console.log("FIRST_ADMIN_PASSWORD: "+(p?"set, "+p.length+" chars"+(/\s/.test(p)?" (HAS WHITESPACE)":""):"MISSING"));
console.log("BETTER_AUTH_URL: "+d("BETTER_AUTH_URL")+"  APP_URL: "+d("APP_URL"));
' "$TMP/secret.json" 2>&1

echo "== does Box's stored copy match the cluster? =="
node -e '
const fs=require("fs"),path=require("path");
const s=JSON.parse(fs.readFileSync(process.argv[1])).data||{};
const d=(k)=>s[k]?Buffer.from(s[k],"base64").toString():"";
const dir="/opt/box/data/ideas"; let found=0;
for(const f of fs.readdirSync(dir).filter(f=>f.endsWith(".json"))){
  let j; try{j=JSON.parse(fs.readFileSync(path.join(dir,f)))}catch{continue}
  const p=j.project; if(!p||p.slug!=="unusual-options-detector") continue; found++;
  const env=(p.deploy&&p.deploy.env)||{};
  console.log("Box project "+f.replace(".json","")+": status "+(p.status||p.phase||"?")+", owner "+String(j.owner||j.ownerEmail||"?").replace(/^(.{2}).*@/,"$1***@"));
  for(const k of ["FIRST_ADMIN_EMAIL","FIRST_ADMIN_PASSWORD"]) console.log("  "+k+" in Box "+(env[k]?"set":"missing")+", same as cluster: "+(env[k]===d(k)?"yes":"NO"));
  const keys=Object.keys(env).filter(k=>!k.startsWith("__")).sort();
  console.log("  Box env keys: "+keys.join(", "));
  const notes=(j.messages||[]).filter(m=>/login|log in|sign in|password/i.test(m.text||m.content||"")).length;
  console.log("  messages mentioning login/password: "+notes);
}
if(!found) console.log("no Box project with slug unusual-options-detector");
let users=[];try{users=JSON.parse(fs.readFileSync("/opt/box/data/users.json"))}catch{}
const owner=users.find(u=>u.primary)||{};
console.log("Box owner email equals FIRST_ADMIN_EMAIL: "+(owner.email&&owner.email.toLowerCase()===d("FIRST_ADMIN_EMAIL").toLowerCase()?"yes":"NO ("+String(owner.email||"").replace(/^(.{2}).*@/,"$1***@")+")"));
' "$TMP/secret.json" 2>&1

echo "== admin rows in the database (no passwords) =="
$K exec statefulset/$NS-db -c postgres -- sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F " | " -c "
SELECT regexp_replace(u.email, '\''^(.{2}).*@'\'', '\''\1***@'\''), u.role, CASE WHEN u.disabled_at IS NULL THEN '\''enabled'\'' ELSE '\''DISABLED'\'' END,
       coalesce(string_agg(a.provider_id || CASE WHEN a.password IS NULL THEN '\'' (no password)'\'' ELSE '\'' (password set)'\'' END, '\'', '\''), '\''NO ACCOUNT ROW'\''),
       to_char(u.created_at, '\''YYYY-MM-DD HH24:MI'\'')
FROM users u LEFT JOIN accounts a ON a.user_id = u.id GROUP BY u.id ORDER BY u.created_at;"' 2>&1 | head -20
echo "sessions: $($K exec statefulset/$NS-db -c postgres -- sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "SELECT count(*) FROM sessions"' 2>&1)"

echo "== worker log lines about the seed =="
$K logs deploy/$NS-worker --tail=400 2>&1 | grep -i -E 'seed|admin|boot|error' | tail -12 | mask | cut -c1-220

echo "== sign in on the live site with the Secret's FIRST_ADMIN login =="
node -e '
const s=JSON.parse(require("fs").readFileSync(process.argv[1])).data||{};
const d=(k)=>s[k]?Buffer.from(s[k],"base64").toString():"";
require("fs").writeFileSync(process.argv[2], JSON.stringify({email:d("FIRST_ADMIN_EMAIL"),password:d("FIRST_ADMIN_PASSWORD")}),{mode:0o600});
' "$TMP/secret.json" "$TMP/login.json"
code=$(curl -s -o "$TMP/out.json" -w '%{http_code}' -X POST "$SITE/api/auth/sign-in/email" -H 'Content-Type: application/json' -H "Origin: $SITE" --data-binary @"$TMP/login.json" -c "$TMP/jar")
echo "POST /api/auth/sign-in/email -> $code $(node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log(j.code||(j.user?"signed in, role "+(j.user.role||"?"):""))}catch{}' "$TMP/out.json")"
echo "cookie set: $(grep -c session_token "$TMP/jar" 2>/dev/null || echo 0)"
[ "$code" = 200 ] && echo "GET /api/me -> $(curl -s -o /dev/null -w '%{http_code}' -b "$TMP/jar" "$SITE/api/me")"

echo "== Doppler on this machine and in the cluster =="
echo "doppler CLI: $(command -v doppler || echo none)"
kubectl --kubeconfig /etc/box-kubeconfig get crd 2>/dev/null | grep -i doppler || echo "no Doppler operator in the cluster"
grep -l -i doppler /etc/*.env 2>/dev/null | sed 's/^/env file mentioning doppler: /'
grep -h -o -i -E '^[A-Z_]*(DOPPLER|GOOGLE)[A-Z_]*' /etc/*.env /opt/box/data/shared-env.json 2>/dev/null | sort -u | sed 's/^/name found: /'
node -e 'try{console.log("Box shared keys: "+Object.keys(JSON.parse(require("fs").readFileSync("/opt/box/data/shared-env.json"))).join(", "))}catch{console.log("Box shared keys: none")}'

echo "== Discord data on this machine =="
ls -d /opt/*discord* /opt/*Discord* 2>/dev/null || echo "no Discord app folders in /opt"
echo "== done =="
