#!/usr/bin/env bash
# Fast-forward GitHub main to a branch built on top of it, then move Box's own copy of the project to the same
# commit (Box force-pushes its copy when it deploys, so both must agree). Stops without changing anything when
# the branch does not sit on top of GitHub main, when Box's copy is not an ancestor of it, or when Box's copy has
# uncommitted work. Prints short SHAs and counts only (this log is public).
set -uo pipefail
SLUG=unusual-options-detector
BRANCH=${SYNC_BRANCH:-claude/google-signin-v2}
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"
NODE=srv1349789
POD=ops-box-sync
cleanup() { $KC -n default delete pod $POD --wait=false >/dev/null 2>&1; }
trap cleanup EXIT
$KC -n default delete pod $POD --ignore-not-found --wait=true >/dev/null 2>&1
cat <<YAML | $KC apply -f - >/dev/null
apiVersion: v1
kind: Pod
metadata: { name: $POD, namespace: default }
spec:
  nodeName: $NODE
  restartPolicy: Never
  tolerations: [{ operator: Exists }]
  containers:
    - name: git
      image: alpine/git:2.47.2
      command: ['sh', '-c', 'sleep 900']
      volumeMounts: [{ name: work, mountPath: /work }]
  volumes: [{ name: work, hostPath: { path: /opt/box/data/work/$SLUG, type: Directory } }]
YAML
$KC -n default wait --for=condition=Ready pod/$POD --timeout=120s >/dev/null || { echo "STOP: pod not ready"; exit 1; }
X() { $KC -n default exec $POD -- sh -c "git config --global --add safe.directory '*'; cd /work/repo && $1"; }

BOX_HEAD=$(X 'git rev-parse HEAD')
DIRTY=$(X 'git status --porcelain | wc -l')
OWNER=$(X 'stat -c %u:%g .')
echo "Box copy: HEAD ${BOX_HEAD:0:7}, uncommitted files ${DIRTY}"
[ "$DIRTY" = 0 ] || { echo "STOP: Box's copy has uncommitted changes (a task may be running)"; exit 1; }

rm -rf work && git clone -q "https://x-access-token:${BOX_GITHUB_TOKEN}@github.com/ThirunagariHarish/$SLUG.git" work || { echo "STOP: clone failed"; exit 1; }
cd work
git fetch -q origin "$BRANCH"
GH_MAIN=$(git rev-parse origin/main); TIP=$(git rev-parse "origin/$BRANCH")
echo "GitHub main ${GH_MAIN:0:7}; branch ${TIP:0:7}"
git merge-base --is-ancestor "$GH_MAIN" "$TIP" || { echo "STOP: the branch is not on top of GitHub main"; exit 1; }
git cat-file -e "$BOX_HEAD" 2>/dev/null && git merge-base --is-ancestor "$BOX_HEAD" "$TIP" || { echo "STOP: Box's copy has commits GitHub does not; nothing changed"; exit 1; }
if [ "$GH_MAIN" != "$TIP" ]; then
  git push -q origin "$TIP:refs/heads/main" 2>&1 | grep -v -i "location\|moved" || true
fi
[ "$(git ls-remote origin refs/heads/main | cut -c1-40)" = "$TIP" ] && echo "GitHub main is now ${TIP:0:7}" || { echo "STOP: push did not land"; exit 1; }

# Move Box's copy to the same commit, only if it did not change meanwhile.
git bundle create ../tip.bundle "origin/$BRANCH" >/dev/null 2>&1
cd ..
$KC -n default cp tip.bundle $POD:/tmp/tip.bundle >/dev/null 2>&1
NOW=$(X 'git rev-parse HEAD'); NOWDIRTY=$(X 'git status --porcelain | wc -l')
if [ "$NOW" != "$BOX_HEAD" ] || [ "$NOWDIRTY" != 0 ]; then echo "WARNING: Box's copy changed meanwhile; not moved (GitHub main has the change)"; exit 0; fi
X "git fetch -q /tmp/tip.bundle 'refs/remotes/origin/$BRANCH:refs/heads/ops-tip' && git merge -q --ff-only ops-tip && git branch -q -D ops-tip && chown -R $OWNER /work/repo && echo \"Box copy moved to \$(git rev-parse --short HEAD)\""
