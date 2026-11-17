#!/usr/bin/env bash
# Make the one enabled non-admin user an admin. Refuses unless there is exactly one such user. Prints counts only.
set -uo pipefail
NS=unusual-options-detector
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"; K="$KC -n $NS"
Q() { $K exec statefulset/$NS-db -c postgres -- sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -At -F ' | ' -c \"$1\"" 2>&1 | sed -E 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/<email>/g'; }
echo "before (role, enabled, count): $(Q "SELECT role, disabled_at IS NULL, count(*) FROM users GROUP BY 1, 2 ORDER BY 1, 2" | tr '\n' ';')"
echo "update: $(Q "UPDATE users SET role = 'admin', updated_at = now() WHERE role = 'user' AND disabled_at IS NULL AND created_at::date = DATE '2026-11-16' AND (SELECT count(*) FROM users WHERE role = 'user' AND disabled_at IS NULL) = 1")"
echo "after (role, enabled, count): $(Q "SELECT role, disabled_at IS NULL, count(*) FROM users GROUP BY 1, 2 ORDER BY 1, 2" | tr '\n' ';')"
