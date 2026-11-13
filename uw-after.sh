#!/usr/bin/env bash
# After the switch: did the refresh retry read today's tape with Unusual Whales? Counts and codes only.
set -uo pipefail
NS=unusual-options-detector
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"
K="$KC -n $NS"
Q() { $K exec statefulset/$NS-db -c postgres -- sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -At -F ' | ' -c \"$1\"" 2>&1; }
sleep 5
echo "time: $(date -u +%H:%MZ)"
Q "SELECT kind, status, count(*), max(run_at) FROM jobs GROUP BY 1,2 ORDER BY 1"
Q "SELECT kind, run_key, status, coalesce(error,''), left(coalesce(result::text,''),300), run_at, created_at FROM jobs WHERE kind='refresh' ORDER BY run_at DESC LIMIT 3" | cut -c1-500
Q "SELECT trade_date, count(*), sum(print_count), round(sum(option_premium_usd)) FROM ticker_window_stats GROUP BY 1 ORDER BY 1 DESC LIMIT 3"
Q "SELECT as_of_date, vendor, count(*) FROM contract_oi GROUP BY 1,2 ORDER BY 1 DESC LIMIT 3"
Q "SELECT source, count(*), min(event_date), max(event_date) FROM ticker_events GROUP BY 1"
echo "worker: $($K logs deploy/$NS-worker --since=20m 2>/dev/null | grep -o -E '"msg":"[^"]*"' | sort | uniq -c | tr '\n' ' ' | cut -c1-600)"
echo "worker errors: $($K logs deploy/$NS-worker --since=20m 2>/dev/null | grep -i -E 'error|fail' | tail -3 | cut -c1-300)"
echo "worker memory: $($KC top pod -n $NS 2>/dev/null | tr '\n' ';')"
