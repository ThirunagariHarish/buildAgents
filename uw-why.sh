#!/usr/bin/env bash
# Why did the worker restart during the refresh? Last state, previous log tail (messages only), job row.
set -uo pipefail
NS=unusual-options-detector
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"
K="$KC -n $NS"
P=$($K get pods -o name | grep worker | head -1)
echo "pod $P"
$K get $P -o json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);for(const c of j.status.containerStatuses||[])console.log(c.name+" restarts "+c.restartCount+" last "+JSON.stringify(c.lastState))})'
echo "previous log (last 15, no chatter):"
$K logs $P --previous --tail=60 2>&1 | grep -v chatter | tail -15 | cut -c1-400
Q() { $K exec statefulset/$NS-db -c postgres -- sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -At -F ' | ' -c \"$1\"" 2>&1; }
Q "SELECT status, attempts, locked_at, coalesce(error,'') FROM jobs WHERE kind='refresh' AND run_key='2026-11-13'"
Q "SELECT count(*) FROM ticker_window_stats"
Q "SELECT count(DISTINCT underlying) FROM ticker_window_stats"
