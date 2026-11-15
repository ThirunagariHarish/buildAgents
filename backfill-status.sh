#!/usr/bin/env bash
# Show the history backfill Job's progress without touching it. Counts only.
set -uo pipefail
NS=unusual-options-detector
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"; K="$KC -n $NS"
echo "job: succeeded=$($K get job history-backfill -o jsonpath='{.status.succeeded}' 2>/dev/null) failed=$($K get job history-backfill -o jsonpath='{.status.failed}' 2>/dev/null) active=$($K get job history-backfill -o jsonpath='{.status.active}' 2>/dev/null)"
echo "pod: $($K get pods -l job-name=history-backfill --no-headers 2>/dev/null | awk '{print $3, $4}' | tr '\n' ';')"
echo "sessions logged: $($K logs job/history-backfill --tail=-1 2>/dev/null | grep -c 'backfill session')"
echo "log:"; $K logs job/history-backfill --tail=6 2>&1 | cut -c1-420
Q() { $K exec statefulset/$NS-db -c postgres -- sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -At -F ' | ' -c \"$1\"" 2>&1; }
echo "stats days: $(Q "SELECT count(DISTINCT trade_date), min(trade_date), max(trade_date) FROM ticker_window_stats")"
echo "historical prints: $(Q "SELECT count(*) FROM raw_prints WHERE source='historical'"); quotes: $(Q "SELECT count(*) FROM quotes WHERE source='historical'"); oi rows: $(Q "SELECT count(*) FROM contract_oi")"
echo "signals: $(Q "SELECT count(*), max(trading_date) FROM signals")"
echo "db size: $(Q "SELECT pg_size_pretty(pg_database_size(current_database()))")"
