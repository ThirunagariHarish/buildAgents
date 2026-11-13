#!/usr/bin/env bash
# Read-only: why health is degraded, and how the first Chatter reads went. Counts and codes only.
set -uo pipefail
NS=unusual-options-detector
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"
K="$KC -n $NS"
Q() { $K exec statefulset/$NS-db -c postgres -- sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -At -F ' | ' -c \"$1\"" 2>&1; }
echo "== health and today's jobs =="
echo "health: $(curl -s --max-time 15 https://$NS.cashflowus.com/api/health)"
Q "SELECT kind, run_key, status, coalesce(error,''), coalesce(result::text,'') FROM jobs WHERE run_at > now() - interval '20 hours' ORDER BY run_at" | cut -c1-220
Q "SELECT seq, event_type, coalesce(payload->>'reason','') FROM log_entries ORDER BY seq DESC LIMIT 5" | cut -c1-200
Q "SELECT count(*) FROM freeze_records"
echo "worker: $($K logs deploy/$NS-worker --tail=400 2>/dev/null | grep -o -E '"msg":"[^"]*(cutoff|skip|chatter|vendor|degraded)[^"]*"' | sort | uniq -c | tr '\n' ' ')"
echo "== Chatter =="
echo "worker chatter lines: $($K logs deploy/$NS-worker --tail=400 2>/dev/null | grep -i chatter | tail -3 | sed -E 's/"snippet":"[^"]*"//g' | cut -c1-300)"
Q "SELECT count(*), count(*) FILTER (WHERE error IS NOT NULL), string_agg(DISTINCT coalesce(error,''), ',') FROM chatter_channels"
Q "SELECT count(*), count(DISTINCT ticker), min(posted_at)::date, max(posted_at) FROM chatter_mentions"
Q "SELECT ticker, count(*) FROM chatter_mentions GROUP BY 1 ORDER BY 2 DESC LIMIT 8"
Q "SELECT coalesce(sum(messages),0) FROM chatter_activity"
