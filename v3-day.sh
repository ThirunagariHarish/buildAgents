#!/usr/bin/env bash
# Read-only: how one day's bets were listed and graded under list rules version 3. Aggregates only.
set -uo pipefail
NS=unusual-options-detector
D=${DAY:-2026-11-17}
KC="kubectl --kubeconfig ${KCFG} --request-timeout=180s"; K="$KC -n $NS"
Q() { $K exec -i statefulset/$NS-db -c postgres -- sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F " | "' 2>&1; }
ET="AT TIME ZONE 'America/New_York'"
VIEW="
CREATE TEMP VIEW a AS
SELECT i.*, o.status, o.ret, o.best, o.worst, o.exit_at,
       coalesce((i.features->>'score0')::numeric, i.score) AS s0,
       (i.features->>'v')::int AS v,
       (i.features->>'ask_share')::numeric AS share,
       round((i.features->>'time_of_day')::numeric * 390) AS minute,
       CASE WHEN i.ask > 0 AND i.bid IS NOT NULL THEN (i.ask - i.bid) / i.ask END AS spread
  FROM option_ideas i LEFT JOIN idea_outcomes o ON o.idea_id = i.id
 WHERE i.horizon = 'intraday' AND i.trade_date = '$D';
CREATE TEMP VIEW r AS
SELECT a.*, CASE WHEN a.score >= 60 THEN 'listed'
  WHEN a.share IS NULL THEN 'two_sided' WHEN a.share <= 0.4 THEN 'sold' WHEN a.share < 0.6 THEN 'two_sided'
  WHEN a.spread IS NULL OR a.ask IS NULL THEN 'no_quote'
  WHEN a.issue_type IS NULL OR a.issue_type = 'Index' THEN 'index'
  WHEN a.dte = 0 THEN 'same_day' WHEN a.spread > 0.08 THEN 'wide_quote'
  WHEN a.delta IS NOT NULL AND abs(a.delta) < 0.3 THEN 'far_out'
  WHEN a.ask < 1 THEN 'cheap' WHEN a.minute > 300 THEN 'late' ELSE 'other' END AS why
FROM a;
"
G="count(*) FILTER (WHERE status IN ('win','loss')), round(100.0 * avg((status = 'win')::int) FILTER (WHERE status IN ('win','loss')), 0), round(100 * avg(ret) FILTER (WHERE status IN ('win','loss'))::numeric, 1), round(100 * (percentile_cont(0.5) WITHIN GROUP (ORDER BY ret) FILTER (WHERE status IN ('win','loss')))::numeric, 1), round(100.0 * avg((best >= 0.1)::int) FILTER (WHERE status IN ('win','loss')), 0)"
R() { echo "## $1"; echo "$VIEW $2" | Q | grep -v -E "^CREATE VIEW$"; }
echo "day $D; now ET: $(TZ=America/New_York date '+%a %T')"
R "all intraday bets (n | score version min/max | status counts)" "SELECT count(*), min(v), max(v), count(*) FILTER (WHERE status = 'win'), count(*) FILTER (WHERE status = 'loss'), count(*) FILTER (WHERE status = 'no_quote'), count(*) FILTER (WHERE status IS NULL) FROM a;"
R "listed (score 60+): n | win | loss | no closing quote | ungraded" "SELECT count(*), count(*) FILTER (WHERE status = 'win'), count(*) FILTER (WHERE status = 'loss'), count(*) FILTER (WHERE status = 'no_quote'), count(*) FILTER (WHERE status IS NULL) FROM a WHERE score >= 60;"
R "listed by first-shown score instead (score0 60+): n | win | loss | no quote" "SELECT count(*), count(*) FILTER (WHERE status = 'win'), count(*) FILTER (WHERE status = 'loss'), count(*) FILTER (WHERE status = 'no_quote') FROM a WHERE s0 >= 60;"
R "listed: graded | win% | avg% | median% | up 10%+ at some point %" "SELECT $G FROM a WHERE score >= 60;"
R "listed by type (type | n | graded | win% | avg% | median% | up10%)" "SELECT option_type, count(*), $G FROM a WHERE score >= 60 GROUP BY 1 ORDER BY 1;"
R "listed by band of first-shown score (band | n | graded | win% | avg% | median% | up10%)" "SELECT CASE WHEN s0 >= 93 THEN 'c 93+' WHEN s0 >= 85 THEN 'b 85-93' WHEN s0 >= 60 THEN 'a 60-85' ELSE 'z under 60 at first' END, count(*), $G FROM a WHERE score >= 60 GROUP BY 1 ORDER BY 1;"
R "listed by days to expiry (dte | n | graded | win% | avg%...)" "SELECT dte, count(*), $G FROM a WHERE score >= 60 GROUP BY 1 ORDER BY 1;"
R "listed by hour seen (hour ET | n | graded | win% | avg%...)" "SELECT to_char(seen_at $ET, 'HH24'), count(*), $G FROM a WHERE score >= 60 GROUP BY 1 ORDER BY 1;"
R "listed: distinct tickers | largest share of bets in one ticker %" "SELECT count(DISTINCT ticker), round(100.0 * max(c) / sum(c), 0) FROM (SELECT ticker, count(*) c FROM a WHERE score >= 60 GROUP BY 1) z;"
R "off the list by reason (reason | n | graded | win% | avg% | median% | up10%)" "SELECT why, count(*), $G FROM r GROUP BY 1 ORDER BY 2 DESC;"
R "everything graded that day (n | graded | win% | avg%...)" "SELECT count(*), $G FROM a;"
R "exit time of graded bets (earliest ET | latest ET | graded with exit before 15:40 ET)" "SELECT to_char(min(exit_at $ET), 'HH24:MI'), to_char(max(exit_at $ET), 'HH24:MI'), count(*) FILTER (WHERE (exit_at $ET)::time < time '15:40') FROM a WHERE status IN ('win','loss');"
R "quotes that day (all | contracts | at or after 15:40 ET | contracts with one | latest ET)" "SELECT count(*), count(DISTINCT option_symbol), count(*) FILTER (WHERE (marked_at $ET)::time >= time '15:40'), count(DISTINCT option_symbol) FILTER (WHERE (marked_at $ET)::time >= time '15:40'), to_char(max(marked_at $ET), 'HH24:MI') FROM idea_marks WHERE (marked_at $ET)::date = '$D';"
R "SPY regular session (prior close | open bar | last bar | move % from prior close | bars)" "
WITH b AS (SELECT ts, value, (ts $ET)::date d, (ts $ET)::time t FROM live_series WHERE name = 'px:SPY' AND (ts $ET)::time >= time '09:30' AND (ts $ET)::time < time '16:00')
SELECT (SELECT value FROM b WHERE d < '$D' ORDER BY ts DESC LIMIT 1), (SELECT value FROM b WHERE d = '$D' ORDER BY ts LIMIT 1), (SELECT value FROM b WHERE d = '$D' ORDER BY ts DESC LIMIT 1),
       round(100 * ((SELECT value FROM b WHERE d = '$D' ORDER BY ts DESC LIMIT 1) / (SELECT value FROM b WHERE d < '$D' ORDER BY ts DESC LIMIT 1) - 1), 2), (SELECT count(*) FROM b WHERE d = '$D');"
R "direction calls that day (slot | lean | score | correct)" "SELECT slot, lean, score, coalesce(correct::text, 'ungraded') FROM direction_calls WHERE trade_date = '$D' ORDER BY slot;"
R "swing bets seen that day (n | score 60+)" "SELECT count(*), count(*) FILTER (WHERE score >= 60) FROM option_ideas WHERE horizon = 'swing' AND trade_date = '$D';"
R "models (horizon | version | in use | samples | trained ET)" "SELECT horizon, version, in_use, samples, to_char(trained_at $ET, 'MM-DD HH24:MI') FROM idea_models ORDER BY version DESC LIMIT 4;"
R "closed-phase key" "SELECT key, left(value::text, 60) FROM markets_state WHERE key LIKE 'trader:closed:%' ORDER BY key DESC LIMIT 2;"
echo "worker trader lines (last 4): "; $K logs deploy/$NS-worker --since=120m 2>/dev/null | grep -E '"msg":"trader' | tail -4 | cut -c1-330
echo "worker failures in 8h: $($K logs deploy/$NS-worker --since=8h 2>/dev/null | grep -c -i -E 'failed|unhandled')"; $K logs deploy/$NS-worker --since=8h 2>/dev/null | grep -i -E 'failed|unhandled' | tail -4 | sed -E 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/<email>/g' | cut -c1-300
