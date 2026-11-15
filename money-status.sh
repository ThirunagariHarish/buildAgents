#!/usr/bin/env bash
# Did the worker read the filings? Counts and date ranges only.
set -uo pipefail
NS=unusual-options-detector
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"; K="$KC -n $NS"
for i in $(seq 1 ${WAIT_TRIES:-30}); do
  L=$($K logs deploy/$NS-worker --since=30m 2>/dev/null | grep -E '"filings (read|failed)"' | tail -1)
  [ -n "$L" ] && break; sleep 15
done
echo "worker: $(echo "$L" | cut -c1-400)"
Q() { $K exec statefulset/$NS-db -c postgres -- sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -At -F ' | ' -c \"$1\"" 2>&1; }
echo "congress: $(Q "SELECT count(*), min(filed_on), max(filed_on), count(*) FILTER (WHERE kind='purchase'), count(*) FILTER (WHERE ticker IS NULL) FROM congress_trades")"
echo "insiders: $(Q "SELECT code, count(*), min(traded_on), max(traded_on), count(*) FILTER (WHERE is_plan) FROM insider_trades GROUP BY code ORDER BY code" | tr '\n' ';')"
echo "funds: $(Q "SELECT count(*), count(report_date), count(error), max(read_at)::timestamptz(0) FROM funds")"
echo "fund errors: $(Q "SELECT name, left(error, 80) FROM funds WHERE error IS NOT NULL" | tr '\n' ';')"
echo "holdings: $(Q "SELECT count(*), count(DISTINCT cik), count(*) FILTER (WHERE put_call <> ''), count(DISTINCT security_type) FROM fund_holdings")"
echo "security types: $(Q "SELECT security_type, put_call, count(*) FROM fund_holdings GROUP BY 1,2 ORDER BY 3 DESC LIMIT 8" | tr '\n' ';')"
echo "most held: $(Q "SELECT ticker, count(DISTINCT cik) FROM fund_holdings WHERE put_call='' AND units>0 GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 8" | tr '\n' ';')"
echo "clusters: $(Q "WITH per AS (SELECT ticker, owner_name FROM insider_trades WHERE code='P' AND NOT is_plan AND price IS NOT NULL AND traded_on > current_date - 30 GROUP BY 1,2 HAVING sum(shares*price) >= 25000) SELECT count(*) FROM (SELECT ticker FROM per GROUP BY 1 HAVING count(*) >= 3) x")"
echo "site: $(curl -s -o /dev/null -w '%{http_code}' https://unusual-options-detector.cashflowus.com/api/health) money page (signed out): $(curl -s -o /dev/null -w '%{http_code}' https://unusual-options-detector.cashflowus.com/money)"
