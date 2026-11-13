#!/usr/bin/env bash
# Read-only: does Box's working copy still contain the Google sign-in and Chatter commits? Short SHAs and counts only.
set -uo pipefail
SLUG=unusual-options-detector
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"
POD=ops-box-check
$KC -n default delete pod $POD --ignore-not-found --wait=true >/dev/null 2>&1
cat <<YAML | $KC apply -f - >/dev/null
apiVersion: v1
kind: Pod
metadata: { name: $POD, namespace: default }
spec:
  nodeName: srv1349789
  restartPolicy: Never
  tolerations: [{ operator: Exists }]
  containers:
    - name: git
      image: alpine/git:2.47.2
      command: ['sh', '-c', 'sleep 300']
      volumeMounts: [{ name: work, mountPath: /work, readOnly: true }]
  volumes: [{ name: work, hostPath: { path: /opt/box/data/work/$SLUG, type: Directory } }]
YAML
$KC -n default wait --for=condition=Ready pod/$POD --timeout=120s >/dev/null || { echo "pod not ready"; exit 1; }
$KC -n default exec $POD -- sh -c "git config --global --add safe.directory '*'; cd /work/repo
echo \"Box HEAD: \$(git rev-parse --short HEAD), uncommitted files: \$(git status --porcelain | wc -l)\"
for c in 7bc433f e13c9a2; do git merge-base --is-ancestor \$c HEAD 2>/dev/null && echo \"\$c in Box's copy: yes\" || echo \"\$c in Box's copy: NO\"; done
echo \"Box commits since e13c9a2: \$(git rev-list --count e13c9a2..HEAD 2>/dev/null)\"
echo \"Google sign-in code present: \$(grep -c socialProviders apps/web/lib/auth.ts)\"
echo \"Chatter code present: \$(ls apps/web/components/chatter 2>/dev/null | wc -l) files, migration 0005: \$(ls packages/db/migrations | grep -c 0005)\"
echo \"ae60a46: \$(git cat-file -t ae60a46 2>/dev/null || echo missing); in HEAD history: \$(git merge-base --is-ancestor ae60a46 HEAD 2>/dev/null && echo yes || echo no); date \$(git log -1 --format=%cI ae60a46 2>/dev/null)\"
echo \"branches: \$(git branch -a --format='%(refname:short)=%(objectname:short)' | tr '\\n' ' ')\"
echo \"worktrees: \$(git worktree list | wc -l); last reflog: \$(git reflog -3 --format='%h %gs' | cut -c1-60 | tr '\\n' ';')\"
echo \"files Box changed since e13c9a2: \$(git diff --name-only e13c9a2..HEAD 2>/dev/null | wc -l); touching my files: \$(git diff --name-only e13c9a2..HEAD 2>/dev/null | grep -c -E 'auth.ts|login|chatter|env.ts|k8s.yaml|settings.ts|schema.ts')\""
$KC -n default delete pod $POD --wait=false >/dev/null 2>&1
