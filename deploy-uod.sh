#!/usr/bin/env bash
# Deploy the Unusual Options Detector from GitHub main (the image-pinned deploy/k8s.yaml), the way Box applies it,
# plus the one-time Doppler token for Google sign-in. Prints no secret values (this log is public).
set -uo pipefail
NS=unusual-options-detector
SITE=https://unusual-options-detector.cashflowus.com
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"
K="$KC -n $NS"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

# Never inside the cutoff window (the gate Job refuses it anyway).
ET=$(TZ=America/New_York date +%H%M); DOW=$(TZ=America/New_York date +%u)
if [ "$DOW" -le 5 ] && [ "$ET" -ge 0955 ] && [ "$ET" -le 1020 ]; then echo "STOP: 09:55-10:20 ET on a weekday"; exit 1; fi

echo "== code =="
git clone -q --depth 5 "https://x-access-token:${BOX_GITHUB_TOKEN}@github.com/ThirunagariHarish/$NS.git" "$TMP/repo" || { echo "STOP: clone failed"; exit 1; }
cd "$TMP/repo"
echo "main: $(git log --oneline -3 --format='%h %s' | sed -E 's/(Deploy: pin image to [0-9a-f]{7})[0-9a-f]*/\1/' | cut -c1-90 | tr '\n' ';')"
PIN=$(grep -o -m1 'unusual-options-detector:[0-9a-f]\{40\}' deploy/k8s.yaml | cut -d: -f2)
echo "manifest image: ${PIN:0:7}"
grep -q 'kind: DopplerSecret' deploy/k8s.yaml || { echo "STOP: the manifest has no DopplerSecret yet (image not pinned to the Google commit?)"; exit 1; }

echo "== Doppler token for the Google keys (copied from the ytclipper namespace: Doppler project dev-platform) =="
if $K get secret doppler-token-secret >/dev/null 2>&1; then echo "already there"; else
  $KC -n ytclipper get secret doppler-token-secret -o json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);process.stdout.write(JSON.stringify({apiVersion:"v1",kind:"Secret",type:"Opaque",metadata:{name:"doppler-token-secret",namespace:"unusual-options-detector"},data:{serviceToken:j.data.serviceToken}}))})' | $KC apply -f - 2>&1 | sed 's/^/   /'
fi

echo "== tidy: deploy Jobs for an image that was never built =="
for j in $($K get jobs -o name 2>/dev/null); do
  sha=${j##*-}; [ "$sha" = "${PIN:0:7}" ] && continue
  if $K get pods -l job-name="${j#job.batch/}" -o jsonpath='{.items[*].status.containerStatuses[*].state.waiting.reason}{.items[*].status.initContainerStatuses[*].state.waiting.reason}' 2>/dev/null | grep -q 'ImagePullBackOff\|ErrImagePull'; then
    $K delete "$j" --wait=false 2>&1 | sed 's/^/   /'
  fi
done

echo "== apply =="
$K apply -f deploy/k8s.yaml 2>&1 | grep -v unchanged | sed 's/^/   /'
for job in gate backup migrate role-check; do
  name="$job-${PIN:0:7}"
  for i in $(seq 1 60); do
    st=$($K get job "$name" -o jsonpath='{.status.succeeded}/{.status.failed}' 2>/dev/null)
    case "$st" in 1/*) echo "job $name: complete"; break ;; */[1-9]*) echo "job $name: FAILED"; $K logs "job/$name" --all-containers --tail=20 2>&1 | sed 's/^/   /' | cut -c1-200; break ;; esac
    sleep 5
  done
done
for d in $NS $NS-worker; do
  $K rollout status "deploy/$d" --timeout=420s 2>&1 | tail -1 | sed "s/^/$d: /"
done
echo "images now: $($K get deploy -o jsonpath='{range .items[*]}{.metadata.name}={.spec.template.spec.containers[0].image}{" "}{end}' | sed 's#ghcr.io/thirunagariharish/unusual-options-detector:##g' | sed -E 's/=([0-9a-f]{7})[0-9a-f]*/=\1/g')"

echo "== Google keys from Doppler =="
for i in $(seq 1 24); do $K get secret $NS-google >/dev/null 2>&1 && break; sleep 5; done
echo "synced Secret keys: $($K get secret $NS-google -o jsonpath='{.data}' 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(Object.keys(JSON.parse(s)).join(", "))}catch{console.log("none yet")}})')"
echo "DopplerSecret: $($K get dopplersecret $NS-google -o jsonpath='{range .status.conditions[*]}{.type}={.status} {.message}; {end}' 2>/dev/null | cut -c1-300)"
# The pod started before the Secret existed would not have the keys: restart once if so.
if ! $K exec deploy/$NS -c app -- sh -c 'test -n "$GOOGLE_CLIENT_ID" && test -n "$GOOGLE_CLIENT_SECRET"' 2>/dev/null; then
  if $K get secret $NS-google >/dev/null 2>&1; then echo "restarting the site to pick the keys up"; $K rollout restart deploy/$NS >/dev/null; $K rollout status deploy/$NS --timeout=300s | tail -1; fi
fi
echo "site pod has both Google keys: $($K exec deploy/$NS -c app -- sh -c 'test -n "$GOOGLE_CLIENT_ID" && test -n "$GOOGLE_CLIENT_SECRET" && echo yes || echo no' 2>&1)"

echo "== the live site =="
echo "health: $(curl -s --max-time 15 $SITE/api/health)"
echo "login page shows the Google button: $(curl -s --max-time 15 $SITE/login | grep -c 'Continue with Google')"
curl -s --max-time 15 -X POST "$SITE/api/auth/sign-in/social" -H 'Content-Type: application/json' -H "Origin: $SITE" -d '{"provider":"google","callbackURL":"/","errorCallbackURL":"/login"}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);if(!j.url){console.log("social start: "+s.slice(0,160));return}const u=new URL(j.url);console.log("social start goes to "+u.host+u.pathname+", redirect_uri="+u.searchParams.get("redirect_uri"))}catch{console.log("social start: unreadable "+s.slice(0,120))}})'
$K get secret $NS-env -o json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s).data;const v=k=>Buffer.from(d[k],"base64").toString();require("fs").writeFileSync(process.argv[1],JSON.stringify({email:v("FIRST_ADMIN_EMAIL"),password:v("FIRST_ADMIN_PASSWORD")}),{mode:0o600})})' "$TMP/login.json"
echo "admin sign-in with the stored login: $(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -X POST "$SITE/api/auth/sign-in/email" -H 'Content-Type: application/json' -H "Origin: $SITE" --data-binary @"$TMP/login.json")"
echo "worker: $($K logs deploy/$NS-worker --tail=300 2>/dev/null | grep -o -E '"msg":"(admin password[^"]*|seed done|worker started)"' | sort | uniq -c | tr '\n' ' ')"

echo "== Chatter: Discord bot from the analyst-team Doppler secret into the app's encrypted Settings (only if empty) =="
J="$TMP/jar"
curl -s -o /dev/null -c "$J" --max-time 15 -X POST "$SITE/api/auth/sign-in/email" -H 'Content-Type: application/json' -H "Origin: $SITE" --data-binary @"$TMP/login.json"
CONF=$(curl -s -b "$J" --max-time 15 "$SITE/api/admin/settings" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const c=k=>((j.settings||[]).find(x=>x.key===k)||{}).configured;console.log(c("discord_bot_token")&&c("discord_server_id")?"yes":"no")}catch{console.log("unreadable")}})')
echo "already configured: $CONF"
if [ "$CONF" = no ]; then
  $KC -n analyst-team get secret analyst-team-credentials -o json | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s).data;const v=k=>d[k]?Buffer.from(d[k],"base64").toString().trim():"";
    const fs=require("fs");fs.writeFileSync(process.argv[1],JSON.stringify({value:v("DISCORD_BOT_TOKEN")}),{mode:0o600});fs.writeFileSync(process.argv[2],JSON.stringify({value:v("DISCORD_SERVER_ID")}),{mode:0o600});
    console.log("source has token: "+(v("DISCORD_BOT_TOKEN")?"yes":"no")+", server id: "+(/^\d{17,20}$/.test(v("DISCORD_SERVER_ID"))?"yes":"no"))})' "$TMP/tok.json" "$TMP/srv.json"
  for k in discord_bot_token:tok discord_server_id:srv; do
    key=${k%%:*}; f=${k##*:}
    echo "PUT $key -> $(curl -s -o "$TMP/put.json" -w '%{http_code}' -b "$J" --max-time 15 -X PUT "$SITE/api/admin/settings/$key" -H 'Content-Type: application/json' -H "Origin: $SITE" --data-binary @"$TMP/$f.json") $(node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log(j.error?j.error+" "+(j.message||""):"configured="+j.setting.configured)}catch{}' "$TMP/put.json")"
  done
fi
echo "Test: $(curl -s -b "$J" --max-time 30 -X POST "$SITE/api/admin/settings/discord_bot_token/test" -H "Origin: $SITE")"
echo "Chatter API: $(curl -s -b "$J" --max-time 15 "$SITE/api/chatter?window=24h" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log("configured="+j.configured+" tickers="+j.tickers.length+" last_read="+j.last_read_at)}catch{console.log(s.slice(0,120))}})')"
