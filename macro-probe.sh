#!/usr/bin/env bash
# Why the stock and bond correlation is empty: series sizes and overlap. Counts and dates only.
set -uo pipefail
NS=unusual-options-detector
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"; K="$KC -n $NS"
Q() { $K exec statefulset/$NS-db -c postgres -- sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -At -F ' | ' -c \"$1\"" 2>&1; }
echo "series: $(Q "SELECT series, count(*), min(date), max(date) FROM macro_series GROUP BY 1 ORDER BY 1" | tr '\n' ';')"
echo "overlap SP500 x DGS10: $(Q "SELECT count(*), min(a.date), max(a.date) FROM macro_series a JOIN macro_series b USING (date) WHERE a.series = 'SP500' AND b.series = 'DGS10'")"
echo "last SP500: $(Q "SELECT date, value FROM macro_series WHERE series = 'SP500' ORDER BY date DESC LIMIT 4" | tr '\n' ';')"
echo "last DGS10: $(Q "SELECT date, value FROM macro_series WHERE series = 'DGS10' ORDER BY date DESC LIMIT 4" | tr '\n' ';')"
echo "cpi tail: $(Q "SELECT date, value FROM macro_series WHERE series = 'CPIAUCSL' ORDER BY date DESC LIMIT 16" | tr '\n' ';')"
echo "px names: $(Q "SELECT name, count(*), min(ts)::timestamp(0), max(ts)::timestamp(0) FROM live_series WHERE name LIKE 'px:%' GROUP BY 1 ORDER BY 1" | tr '\n' ';')"
echo "score spread: $(Q "SELECT horizon, width_bucket(score, 0, 100, 10) AS b, count(*) FROM option_ideas GROUP BY 1, 2 ORDER BY 1, 2" | tr '\n' ';')"
echo "graded by score: $(Q "SELECT width_bucket(i.score, 0, 100, 10) AS b, o.status, count(*) FROM option_ideas i JOIN idea_outcomes o ON o.idea_id = i.id GROUP BY 1, 2 ORDER BY 1, 2" | tr '\n' ';')"
echo "no_quote by expiry: $(Q "SELECT i.expiry, count(*) FILTER (WHERE o.status = 'no_quote'), count(*) FROM option_ideas i JOIN idea_outcomes o ON o.idea_id = i.id GROUP BY 1 ORDER BY 1 LIMIT 8" | tr '\n' ';')"
echo "issue types: $(Q "SELECT coalesce(issue_type, 'null'), count(*) FROM option_ideas GROUP BY 1 ORDER BY 2 DESC LIMIT 6" | tr '\n' ';')"
echo "null fields: $(Q "SELECT count(*) FILTER (WHERE ask IS NULL), count(*) FILTER (WHERE delta IS NULL), count(*) FILTER (WHERE iv IS NULL), count(*) FILTER (WHERE underlying_price IS NULL), count(*) FILTER (WHERE marketcap IS NULL), count(*) FILTER (WHERE ask_premium + bid_premium = 0), count(*) FROM option_ideas")"
