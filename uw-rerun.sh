#!/usr/bin/env bash
# Re-queue today's refresh (failed on the old Massive adapter, retries used up) and watch it run on Unusual Whales.
set -uo pipefail
NS=unusual-options-detector
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"
K="$KC -n $NS"
Q() { $K exec statefulset/$NS-db -c postgres -- sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -At -F ' | ' -c \"$1\"" 2>&1; }
Q "UPDATE jobs SET status='pending', attempts=0, error=NULL, result=NULL WHERE kind='refresh' AND run_key='2026-11-13' AND status='failed' RETURNING kind, run_key, status"
start=$(date +%s)
for i in $(seq 1 40); do
  s=$(Q "SELECT status FROM jobs WHERE kind='refresh' AND run_key='2026-11-13'")
  [ "$s" = done ] || [ "$s" = failed ] && break
  sleep 20
done
echo "after $(( $(date +%s) - start ))s:"
Q "SELECT status, attempts, coalesce(error,''), left(coalesce(result::text,''),400) FROM jobs WHERE kind='refresh' AND run_key='2026-11-13'"
Q "SELECT trade_date, count(*), sum(print_count), round(sum(option_premium_usd)) FROM ticker_window_stats GROUP BY 1 ORDER BY 1 DESC LIMIT 3"
Q "SELECT underlying, print_count, option_contracts FROM ticker_window_stats WHERE trade_date='2026-11-13' ORDER BY print_count DESC LIMIT 5"
Q "SELECT as_of_date, vendor, count(*) FROM contract_oi GROUP BY 1,2 ORDER BY 1 DESC LIMIT 3"
Q "SELECT source, count(*), min(event_date), max(event_date) FROM ticker_events GROUP BY 1"
echo "worker: $($K logs deploy/$NS-worker --since=15m 2>/dev/null | grep -v chatter | grep -o -E '"msg":"[^"]*"|"error":"[^"]{0,200}' | sort | uniq -c | tr '\n' ' ' | cut -c1-800)"
echo "worker memory: $($KC top pod -n $NS 2>/dev/null | grep worker)"
echo "restarts: $($K get pods --no-headers | awk '{print $1, $4}' | tr '\n' ';')"
