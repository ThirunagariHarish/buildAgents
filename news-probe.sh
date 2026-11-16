#!/usr/bin/env bash
# Read-only: are the vendor's ticker tags on headlines real companies or everyday words? Public headlines only.
set -uo pipefail
NS=unusual-options-detector
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"; K="$KC -n $NS"
Q() { $K exec statefulset/$NS-db -c postgres -- sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -At -F ' | ' -c \"$1\"" 2>&1; }
echo "top tags 24h: $(Q "SELECT t, count(*) FROM headlines h, unnest(h.tickers) t WHERE h.created_at > now() - interval '24 hours' GROUP BY 1 ORDER BY 2 DESC LIMIT 30" | tr '\n' ';')"
for T in ON YORK SAN PARK AI RSI PM GOLD NVDA; do echo "-- $T"; Q "SELECT source, left(headline, 150), array_to_string(tickers, ',') FROM headlines WHERE '$T' = ANY(tickers) ORDER BY created_at DESC LIMIT 3"; done
echo "tag appears in headline as an upper-case word (share, 24h): $(Q "SELECT count(*) FILTER (WHERE h.headline ~ ('(^|[^A-Za-z])' || t || '([^A-Za-z]|$)')), count(*) FROM headlines h, unnest(h.tickers) t WHERE h.created_at > now() - interval '24 hours'")"
echo "sources: $(Q "SELECT coalesce(source, 'null'), count(*), count(*) FILTER (WHERE cardinality(tickers) > 0) FROM headlines WHERE created_at > now() - interval '24 hours' GROUP BY 1 ORDER BY 2 DESC LIMIT 12" | tr '\n' ';')"
