#!/usr/bin/env bash
# Generic: sync SYNC_BRANCH to main and Box's copy, wait for the image pin of WANT_SHA, deploy. Short SHAs and statuses only.
set -uo pipefail
WANT=${WANT_SHA:?}; : "${SYNC_BRANCH:?}"
echo "## sync"; bash sync.sh
echo "## wait for the image pin of ${WANT:0:7}"
for i in $(seq 1 60); do
  rm -rf /tmp/pinchk; git clone -q --depth 3 "https://x-access-token:${BOX_GITHUB_TOKEN}@github.com/ThirunagariHarish/unusual-options-detector.git" /tmp/pinchk 2>/dev/null
  if grep -q "unusual-options-detector:${WANT}" /tmp/pinchk/deploy/k8s.yaml 2>/dev/null; then echo "pinned after ~$((i*30))s"; break; fi
  sleep 30
done
grep -q "unusual-options-detector:${WANT}" /tmp/pinchk/deploy/k8s.yaml || { echo "STOP: not pinned yet"; exit 1; }
echo "## deploy"; bash deploy-uod.sh 2>&1 | grep -E "^==|job |rolled out|images now|health|STOP|error"
