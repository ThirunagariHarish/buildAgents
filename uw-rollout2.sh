#!/usr/bin/env bash
# Memory fix: sync, wait for the pin, deploy, then re-queue today's refresh and watch it.
set -uo pipefail
WANT=${WANT_SHA:?}
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"
echo "node memory: $($KC get nodes -o jsonpath='{range .items[*]}{.metadata.name}={.status.allocatable.memory}{" "}{end}')"
$KC top nodes 2>/dev/null | sed 's/^/  /'
echo "## sync"; SYNC_BRANCH=claude/uw-memory bash sync.sh
echo "## wait for the image pin of ${WANT:0:7}"
for i in $(seq 1 60); do
  rm -rf /tmp/pinchk; git clone -q --depth 3 "https://x-access-token:${BOX_GITHUB_TOKEN}@github.com/ThirunagariHarish/unusual-options-detector.git" /tmp/pinchk 2>/dev/null
  if grep -q "unusual-options-detector:${WANT}" /tmp/pinchk/deploy/k8s.yaml 2>/dev/null; then echo "pinned after ~$((i*30))s"; break; fi
  sleep 30
done
grep -q "unusual-options-detector:${WANT}" /tmp/pinchk/deploy/k8s.yaml || { echo "STOP: not pinned yet"; exit 1; }
echo "## deploy"; bash deploy-uod.sh 2>&1 | grep -E "^==|job |rolled out|images now|health|STOP|error" 
echo "## refresh"; bash uw-rerun.sh
