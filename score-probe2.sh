#!/usr/bin/env bash
# Read-only: test a revised score, a closing-quote rule, a target-and-stop exit and "with the market" on the stored bets. Aggregates only.
set -uo pipefail
NS=unusual-options-detector
KC="kubectl --kubeconfig ${KCFG} --request-timeout=180s"; K="$KC -n $NS"
Q() { $K exec -i statefulset/$NS-db -c postgres -- sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F " | "' 2>&1; }
VIEW="
CREATE TEMP VIEW g AS
SELECT i.*, o.status, o.ret, o.best, o.worst, o.exit_at,
       coalesce((i.features->>'ask_share')::numeric, 0.5) AS share,
       power(10, (i.features->>'log_premium')::numeric) AS prem0,
       CASE WHEN i.ask > 0 AND i.bid IS NOT NULL THEN (i.ask - i.bid) / i.ask END AS spread,
       round(exp((i.features->>'log_hits')::numeric)) AS hits0
  FROM option_ideas i JOIN idea_outcomes o ON o.idea_id = i.id
 WHERE i.horizon = 'intraday' AND o.status IN ('win','loss');
CREATE TEMP VIEW s AS
SELECT g.*, x.*,
  round(100 * (
     18 * x.f_prem + coalesce(16 * x.f_spread, 0) + 14 * x.f_exp + coalesce(10 * x.f_delta, 0) + 8 * x.f_hits
   + 10 * x.f_aggr + coalesce(10 * x.f_rare, 0) + 6 * x.f_voi + 4 * x.f_side + coalesce(4 * x.f_rel, 0))
   / (18 + CASE WHEN x.f_spread IS NULL THEN 0 ELSE 16 END + 14 + CASE WHEN x.f_delta IS NULL THEN 0 ELSE 10 END + 8 + 10
      + CASE WHEN x.f_rare IS NULL THEN 0 ELSE 10 END + 6 + 4 + CASE WHEN x.f_rel IS NULL THEN 0 ELSE 4 END), 1) AS v2
FROM g, LATERAL (SELECT
   least(1, greatest(0, (log(greatest(g.prem0, 1)) - 5) / 1.699)) AS f_prem,
   CASE WHEN g.spread IS NULL THEN NULL ELSE least(1, greatest(0, 1 - g.spread / 0.12)) END AS f_spread,
   CASE WHEN g.dte = 0 THEN 0.2 WHEN g.dte <= 3 THEN 1 WHEN g.dte <= 7 THEN 0.8 ELSE 0.7 END AS f_exp,
   CASE WHEN g.delta IS NULL THEN NULL WHEN abs(g.delta) < 0.15 THEN 0.2 WHEN abs(g.delta) < 0.25 THEN 0.6 WHEN abs(g.delta) <= 0.6 THEN 1 WHEN abs(g.delta) <= 0.75 THEN 0.6 ELSE 0.3 END AS f_delta,
   CASE WHEN g.hits0 >= 4 THEN 1 WHEN g.hits0 >= 2 THEN 0.5 ELSE 0 END AS f_hits,
   least(1, 0.7 * least(1, greatest(0, (g.share - 0.5) / 0.4)) + 0.3 * (g.features->>'sweep')::numeric) AS f_aggr,
   (SELECT (e->>'points')::numeric / 12 FROM jsonb_array_elements(g.reasons) e WHERE e->>'factor' = 'rarity') AS f_rare,
   least(1, (g.features->>'volume_oi')::numeric / 5) AS f_voi,
   abs(g.share - 0.5) * 2 AS f_side,
   CASE WHEN g.marketcap > 0 THEN least(1, greatest(0, (log(g.prem0 / g.marketcap) + 7) / 3)) END AS f_rel) x;
"
AGG="count(*), round(100.0 * avg((status = 'win')::int), 0), round(100 * avg(ret)::numeric, 1), round(100 * (percentile_cont(0.5) WITHIN GROUP (ORDER BY ret))::numeric, 1), round(100.0 * avg((best >= 0.2)::int), 0)"
R() { echo "## $1"; echo "$VIEW $2" | Q | grep -v -E "^CREATE VIEW$"; }
R "revised score, all graded (band | day | n | win% | avg% | median% | reached +20%)" "SELECT CASE WHEN v2 >= 75 THEN 'd 75+' WHEN v2 >= 60 THEN 'c 60-75' WHEN v2 >= 45 THEN 'b 45-60' ELSE 'a <45' END, trade_date, $AGG FROM s GROUP BY 1, 2 ORDER BY 1, 2;"
R "revised score, bought at the ask (60%+) with spread under 12% only" "SELECT CASE WHEN v2 >= 75 THEN 'd 75+' WHEN v2 >= 60 THEN 'c 60-75' WHEN v2 >= 45 THEN 'b 45-60' ELSE 'a <45' END, trade_date, $AGG FROM s WHERE share >= 0.6 AND spread < 0.12 GROUP BY 1, 2 ORDER BY 1, 2;"
R "revised score distribution (decile of v2 | n | win% | avg%), Monday only" "SELECT ntile, count(*), round(100.0 * avg((status = 'win')::int), 0), round(100 * avg(ret)::numeric, 1), round(min(v2), 0), round(max(v2), 0) FROM (SELECT *, ntile(5) OVER (ORDER BY v2) FROM s WHERE trade_date = '2026-11-16') z GROUP BY 1 ORDER BY 1;"
R "Monday graded on a closing quote only (exit at or after 15:45 ET) vs earlier" "SELECT CASE WHEN (exit_at AT TIME ZONE 'America/New_York')::time >= time '15:45' THEN 'closing quote' ELSE 'stale exit' END, $AGG FROM g WHERE trade_date = '2026-11-16' GROUP BY 1 ORDER BY 1;"
R "with or against SPY's move so far when the bet was seen, bets bought at the ask (60%+), by day" "
SELECT z.trade_date, z.side, count(*), round(100.0 * avg((z.status = 'win')::int), 0), round(100 * avg(z.ret)::numeric, 1) FROM (
  SELECT g.trade_date, g.status, g.ret,
         CASE WHEN abs(m.mv) < 0.001 THEN 'flat tape' WHEN (m.mv > 0) = (g.option_type = 'C') THEN 'with' ELSE 'against' END AS side
    FROM g, LATERAL (SELECT (SELECT value FROM live_series WHERE name = 'px:SPY' AND ts <= g.seen_at ORDER BY ts DESC LIMIT 1)
                          / (SELECT value FROM live_series WHERE name = 'px:SPY' AND (ts AT TIME ZONE 'America/New_York')::date < g.trade_date
                               AND (ts AT TIME ZONE 'America/New_York')::time >= time '09:30' AND (ts AT TIME ZONE 'America/New_York')::time < time '16:00' ORDER BY ts DESC LIMIT 1) - 1 AS mv) m
   WHERE g.share >= 0.6 AND m.mv IS NOT NULL) z GROUP BY 1, 2 ORDER BY 1, 2;"
R "with or against the stock's own move so far that day (stocks with bars), bought at the ask" "
SELECT z.trade_date, z.side, count(*), round(100.0 * avg((z.status = 'win')::int), 0), round(100 * avg(z.ret)::numeric, 1) FROM (
  SELECT g.trade_date, g.status, g.ret,
         CASE WHEN abs(m.mv) < 0.003 THEN 'flat' WHEN (m.mv > 0) = (g.option_type = 'C') THEN 'with' ELSE 'against' END AS side
    FROM g, LATERAL (SELECT g.underlying_price / (SELECT value FROM live_series WHERE name = 'px:' || g.ticker AND (ts AT TIME ZONE 'America/New_York')::date < g.trade_date
                               AND (ts AT TIME ZONE 'America/New_York')::time >= time '09:30' AND (ts AT TIME ZONE 'America/New_York')::time < time '16:00' ORDER BY ts DESC LIMIT 1) - 1 AS mv) m
   WHERE g.share >= 0.6 AND m.mv IS NOT NULL AND g.underlying_price > 0) z GROUP BY 1, 2 ORDER BY 1, 2;"
for TS in "0.25 0.25" "0.3 0.2" "0.5 0.3" "0.2 0.2"; do set -- $TS
R "Monday, exit rule: take +$1, stop -$2, else the close (15-minute quotes): how | n | avg result" "
SELECT how, count(*), round(100 * avg(r)::numeric, 1) FROM (
  SELECT coalesce(h.how, 'close') AS how, coalesce(h.r, g.ret) AS r
    FROM g LEFT JOIN LATERAL (
      SELECT CASE WHEN k.bid / coalesce(g.ask, g.price) - 1 >= $1 THEN 'target' ELSE 'stop' END AS how, k.bid / coalesce(g.ask, g.price) - 1 AS r
        FROM idea_marks k WHERE k.option_symbol = g.option_symbol AND k.marked_at > g.seen_at AND k.marked_at <= g.exit_at
         AND (k.bid / coalesce(g.ask, g.price) - 1 >= $1 OR k.bid / coalesce(g.ask, g.price) - 1 <= -$2)
       ORDER BY k.marked_at LIMIT 1) h ON true
   WHERE g.trade_date = '2026-11-16' AND coalesce(g.ask, g.price) > 0) z GROUP BY ROLLUP (how) ORDER BY 1;"
done
R "same +25/-25 rule on Monday by call or put and by the revised-score band (band | type | n | win% (result > 0) | avg%)" "
SELECT CASE WHEN v2 >= 60 THEN 'b 60+' ELSE 'a <60' END, option_type, count(*), round(100.0 * avg((r > 0)::int), 0), round(100 * avg(r)::numeric, 1) FROM (
  SELECT s.v2, s.option_type, coalesce(h.r, s.ret) AS r
    FROM s LEFT JOIN LATERAL (
      SELECT k.bid / coalesce(s.ask, s.price) - 1 AS r FROM idea_marks k WHERE k.option_symbol = s.option_symbol AND k.marked_at > s.seen_at AND k.marked_at <= s.exit_at
         AND (k.bid / coalesce(s.ask, s.price) - 1 >= 0.25 OR k.bid / coalesce(s.ask, s.price) - 1 <= -0.25) ORDER BY k.marked_at LIMIT 1) h ON true
   WHERE s.trade_date = '2026-11-16' AND coalesce(s.ask, s.price) > 0) z GROUP BY 1, 2 ORDER BY 1, 2;"
R "how many bets per contract were also quoted at the close on Monday (ever quoted | closing quote)" "SELECT count(DISTINCT i.option_symbol), count(DISTINCT i.option_symbol) FILTER (WHERE EXISTS (SELECT 1 FROM idea_marks k WHERE k.option_symbol = i.option_symbol AND (k.marked_at AT TIME ZONE 'America/New_York')::date = i.trade_date AND (k.marked_at AT TIME ZONE 'America/New_York')::time >= time '15:45')) FROM option_ideas i WHERE i.trade_date = '2026-11-16' AND EXISTS (SELECT 1 FROM idea_marks k WHERE k.option_symbol = i.option_symbol AND k.marked_at > i.seen_at);"
