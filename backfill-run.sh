#!/usr/bin/env bash
# Start (or restart) the history backfill Job with SESSIONS sessions and show its progress. Counts only.
set -uo pipefail
NS=unusual-options-detector
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"; K="$KC -n $NS"
SESSIONS=${SESSIONS:-2}; WAIT=${WAIT_MIN:-25}
ET=$(TZ=America/New_York date +%H%M); DOW=$(TZ=America/New_York date +%u)
if [ "$DOW" -le 5 ] && [ "$ET" -ge 0925 ] && [ "$ET" -le 1020 ]; then echo "STOP: not during the morning window"; exit 1; fi
IMG=$($K get deploy $NS-worker -o jsonpath='{.spec.template.spec.containers[0].image}')
echo "image: ${IMG##*:}" | cut -c1-14
MAN="$PWD/backfill-job.yaml"
$K delete job history-backfill --ignore-not-found --wait=true >/dev/null 2>&1
sed -e "s|IMAGE_PLACEHOLDER|$IMG|" -e "s|SESSIONS_PLACEHOLDER|$SESSIONS|" "$MAN" | $KC apply -f - 2>&1 | sed 's/^/  /'
for i in $(seq 1 $((WAIT*4))); do
  s=$($K get job history-backfill -o jsonpath='{.status.succeeded}/{.status.failed}' 2>/dev/null)
  [ "${s%%/*}" = 1 ] && { echo "job: succeeded"; break; }
  [ -n "${s##*/}" ] && [ "${s##*/}" != "" ] && [ "${s##*/}" -ge 3 ] 2>/dev/null && { echo "job: failed"; break; }
  sleep 15
done
echo "pod: $($K get pods -l job-name=history-backfill --no-headers 2>/dev/null | awk '{print $3, $4}' | tr '\n' ';')"
echo "log:"; $K logs job/history-backfill --tail=40 2>&1 | cut -c1-420
echo "memory: $($KC top pod -n $NS 2>/dev/null | grep backfill)"
Q() { $K exec statefulset/$NS-db -c postgres -- sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -At -F ' | ' -c \"$1\"" 2>&1; }
echo "stats days: $(Q "SELECT count(DISTINCT trade_date), min(trade_date), max(trade_date) FROM ticker_window_stats")"
echo "historical prints: $(Q "SELECT count(*) FROM raw_prints WHERE source='historical'"); quotes: $(Q "SELECT count(*) FROM quotes WHERE source='historical'"); oi rows: $(Q "SELECT count(*) FROM contract_oi")"
echo "db size: $(Q "SELECT pg_size_pretty(pg_database_size(current_database()))")"
