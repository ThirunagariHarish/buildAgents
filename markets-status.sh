#!/usr/bin/env bash
# Did the worker read the market context? Counts and date ranges only.
set -uo pipefail
NS=unusual-options-detector
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"; K="$KC -n $NS"
for i in $(seq 1 ${WAIT_TRIES:-36}); do
  L=$($K logs deploy/$NS-worker --since=30m 2>/dev/null | grep -E '"markets (read|failed)"' | tail -1)
  [ -n "$L" ] && break; sleep 15
done
echo "worker: $(echo "$L" | cut -c1-400)"
Q() { $K exec statefulset/$NS-db -c postgres -- sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -At -F ' | ' -c \"$1\"" 2>&1; }
echo "tide: $(Q "SELECT count(*), min(trade_date), max(trade_date) FROM market_tide")"
echo "econ: $(Q "SELECT count(*), min(event_time)::date, max(event_time)::date FROM econ_events")"
echo "headlines: $(Q "SELECT count(*), count(*) FILTER (WHERE is_major), max(created_at)::timestamptz(0) FROM headlines")"
echo "facts: $(Q "SELECT count(*), count(name), count(next_earnings), count(seasonality_at) FROM ticker_facts")"
echo "prices: $(Q "SELECT count(*), count(DISTINCT ticker), min(date), max(date) FROM prices_daily")"
echo "seasonality: $(Q "SELECT count(*), count(DISTINCT ticker) FROM seasonality")"
echo "state: $(Q "SELECT key, read_at::timestamptz(0) FROM markets_state ORDER BY key" | tr '\n' ';')"
echo "site: $(curl -s -o /dev/null -w '%{http_code}' https://unusual-options-detector.cashflowus.com/api/health)"
