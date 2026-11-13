#!/usr/bin/env bash
# Sync the branch to main and Box's copy, wait for the image pin, deploy, then save the Unusual Whales token.
set -uo pipefail
WANT=${WANT_SHA:?}
echo "## sync"; SYNC_BRANCH=claude/unusual-whales bash sync.sh
echo "## wait for the image pin of ${WANT:0:7}"
for i in $(seq 1 60); do
  rm -rf /tmp/pinchk; git clone -q --depth 3 "https://x-access-token:${BOX_GITHUB_TOKEN}@github.com/ThirunagariHarish/unusual-options-detector.git" /tmp/pinchk 2>/dev/null
  if grep -q "unusual-options-detector:${WANT}" /tmp/pinchk/deploy/k8s.yaml 2>/dev/null; then echo "pinned after ~$((i*30))s"; break; fi
  sleep 30
done
grep -q "unusual-options-detector:${WANT}" /tmp/pinchk/deploy/k8s.yaml || { echo "STOP: not pinned yet"; exit 1; }
echo "## deploy"; bash deploy-uod.sh
echo "## vendor token"; bash set-vendor-uw.sh
