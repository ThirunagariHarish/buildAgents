#!/usr/bin/env bash
# Put a branch's commits on top of Box's own copy of a project, push that to GitHub main, and move Box's copy to
# the same commit (Box force-pushes its copy when it deploys, so both must agree). Stops without changing
# anything when GitHub main has commits Box does not know (other than the image-pin bot), when the cherry-pick
# conflicts, or when Box's copy is busy. Prints short SHAs and counts only (this log is public).
set -uo pipefail
SLUG=unusual-options-detector
BRANCH=claude/google-signin
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
X 'git bundle create /tmp/box.bundle HEAD >/dev/null 2>&1 && echo bundled' || { echo "STOP: bundle failed"; exit 1; }
$KC -n default cp $POD:/tmp/box.bundle box.bundle >/dev/null 2>&1 || { echo "STOP: copy failed"; exit 1; }

rm -rf work && git clone -q "https://x-access-token:${BOX_GITHUB_TOKEN}@github.com/ThirunagariHarish/$SLUG.git" work || { echo "STOP: clone failed"; exit 1; }
cd work
git config user.name "ThirunagariHarish"; git config user.email "ThirunagariHarish@users.noreply.github.com"
git fetch -q ../box.bundle HEAD:refs/box/main && git fetch -q origin "$BRANCH"
GH_MAIN=$(git rev-parse origin/main)
echo "GitHub main ${GH_MAIN:0:7}; Box main $(git rev-parse --short refs/box/main)"
UNKNOWN=$(git log refs/box/main..origin/main --format='%s' | grep -v -c '^Deploy: pin image')
echo "commits on GitHub main that Box's copy lacks (not counting image pins): $UNKNOWN"
[ "$UNKNOWN" = 0 ] || { echo "STOP: GitHub has work Box does not; nothing changed"; exit 1; }
PICKS=$(git rev-list --reverse "$(git merge-base origin/main origin/$BRANCH)..origin/$BRANCH")
echo "commits to add: $(echo "$PICKS" | wc -w)"
git checkout -q -B merged refs/box/main
for c in $PICKS; do
  if ! git cherry-pick -x "$c" >/dev/null 2>&1; then
    echo "STOP: cherry-pick ${c:0:7} conflicts in: $(git diff --name-only --diff-filter=U | tr '\n' ' ')"; git cherry-pick --abort; exit 1
  fi
done
MERGED=$(git rev-parse HEAD)
git push -q --force-with-lease=main:"$GH_MAIN" origin merged:main 2>&1 | grep -v -i "location\|moved" || true
[ "$(git ls-remote origin refs/heads/main | cut -c1-40)" = "$MERGED" ] && echo "GitHub main is now ${MERGED:0:7}" || { echo "STOP: push did not land"; exit 1; }

# Move Box's copy to the same commit, only if it did not change meanwhile.
git bundle create ../merged.bundle merged >/dev/null 2>&1
cd ..
$KC -n default cp merged.bundle $POD:/tmp/merged.bundle >/dev/null 2>&1
NOW=$(X 'git rev-parse HEAD'); NOWDIRTY=$(X 'git status --porcelain | wc -l')
if [ "$NOW" != "$BOX_HEAD" ] || [ "$NOWDIRTY" != 0 ]; then echo "WARNING: Box's copy changed meanwhile; not moved (GitHub main has the change)"; exit 0; fi
X "git fetch -q /tmp/merged.bundle merged:refs/heads/ops-merged && git reset -q --hard ops-merged && git branch -q -D ops-merged && chown -R $OWNER /work/repo && echo \"Box copy moved to \$(git rev-parse --short HEAD)\""
