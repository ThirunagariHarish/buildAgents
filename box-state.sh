#!/usr/bin/env bash
# Read-only: where Box runs, and the state of its copy of the Unusual Options Detector.
set -uo pipefail
KC="kubectl --kubeconfig ${KCFG} --request-timeout=30s"
echo "== nodes =="
$KC get nodes -o wide --no-headers | awk '{print $1, $2, $6}'
echo "== box namespace =="
$KC -n box get pods,svc,endpointslices -o wide 2>&1 | cut -c1-160
NODE=$($KC get nodes -o wide --no-headers | awk '$6=="69.62.86.166"{print $1}')
echo "VPS node: ${NODE:-not found}"
[ -z "$NODE" ] && exit 0
$KC -n default delete pod ops-box-peek --ignore-not-found --wait=true >/dev/null 2>&1
cat <<YAML | $KC apply -f - >/dev/null
apiVersion: v1
kind: Pod
metadata: { name: ops-box-peek, namespace: default }
spec:
  nodeName: $NODE
  restartPolicy: Never
  tolerations: [{ operator: Exists }]
  containers:
    - name: peek
      image: alpine/git:2.47.2
      command: ['sh', '-c', 'sleep 600']
      volumeMounts: [{ name: box, mountPath: /box, readOnly: true }]
  volumes: [{ name: box, hostPath: { path: /opt/box, type: Directory } }]
YAML
$KC -n default wait --for=condition=Ready pod/ops-box-peek --timeout=120s >/dev/null 2>&1 || { echo "peek pod not ready"; $KC -n default describe pod ops-box-peek | tail -8; }
X="$KC -n default exec ops-box-peek --"
R=/box/data/work/unusual-options-detector/repo
echo "== Box's copy of the repo =="
$X sh -c "git config --global --add safe.directory '*'; cd $R && echo HEAD \$(git rev-parse --short HEAD) branch \$(git rev-parse --abbrev-ref HEAD) && git log --oneline -3 && echo 'uncommitted files:' \$(git status --porcelain | wc -l)" 2>&1 | cut -c1-160
echo "== Box's record of the project =="
$X sh -c 'apk add -q nodejs >/dev/null 2>&1; node -e "
const fs=require(\"fs\"),path=require(\"path\");const dir=\"/box/data/ideas\";
for(const f of fs.readdirSync(dir).filter(f=>f.endsWith(\".json\"))){let j;try{j=JSON.parse(fs.readFileSync(path.join(dir,f)))}catch{continue}
const p=j.project;if(!p||p.slug!==\"unusual-options-detector\")continue;
const tasks=p.tasks||[];const open=tasks.filter(t=>!/done|skipped|cancel/i.test(t.status||\"\"));
console.log(\"status: \"+(p.status||p.phase||\"?\")+\"; running: \"+(j.running||p.running||false)+\"; paused: \"+(j.paused||p.paused||false));
console.log(\"tasks: \"+tasks.length+\" total, \"+open.length+\" not done\");
for(const t of open.slice(0,8))console.log(\"  \"+(t.id||\"\")+\" [\"+(t.status||\"?\")+\"] \"+String(t.title||\"\").slice(0,90));
console.log(\"last activity: \"+new Date(Math.max(...(j.messages||[]).map(m=>m.at||m.ts||0),j.updatedAt||0)).toISOString());
}"' 2>&1 | cut -c1-200
$KC -n default delete pod ops-box-peek --wait=false >/dev/null 2>&1
