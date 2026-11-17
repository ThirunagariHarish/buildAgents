#!/usr/bin/env bash
# Read-only: which facts about a bet went with a win. Counts and averages per bucket only, no rows.
set -uo pipefail
NS=unusual-options-detector
KC="kubectl --kubeconfig ${KCFG} --request-timeout=120s"; K="$KC -n $NS"
Q() { $K exec statefulset/$NS-db -c postgres -- sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -At -F ' | ' -c \"$1\"" 2>&1; }
BASE="FROM option_ideas i JOIN idea_outcomes o ON o.idea_id = i.id WHERE i.horizon = 'intraday' AND o.status IN ('win','loss')"
AGG="count(*) AS n, round(100.0 * avg((o.status = 'win')::int), 0) AS win, round(100 * avg(o.ret)::numeric, 1) AS avg, round(100 * (percentile_cont(0.5) WITHIN GROUP (ORDER BY o.ret))::numeric, 1) AS med, round(100.0 * avg((o.best >= 0.2)::int), 0) AS up20, round(100.0 * avg((o.worst <= -0.3)::int), 0) AS dn30"
B() { echo "## $1  (bucket | day | n | win% | avg% | median% | reached +20% | reached -30%)"; Q "SELECT $2 AS b, i.trade_date, $AGG $BASE GROUP BY 1, 2 ORDER BY 1, 2"; }
echo "graded by day: $(Q "SELECT i.trade_date, $AGG $BASE GROUP BY 1 ORDER BY 1" | tr '\n' ';')"
B "days to expiry" "CASE WHEN i.dte = 0 THEN '0' WHEN i.dte = 1 THEN '1' WHEN i.dte <= 3 THEN '2-3' ELSE '4-7' END"
B "call or put" "i.option_type"
B "share at the ask" "CASE WHEN i.ask_premium + i.bid_premium = 0 THEN 'none' WHEN i.ask_premium / (i.ask_premium + i.bid_premium) >= 0.8 THEN 'd 80+' WHEN i.ask_premium / (i.ask_premium + i.bid_premium) >= 0.6 THEN 'c 60-80' WHEN i.ask_premium / (i.ask_premium + i.bid_premium) > 0.4 THEN 'b 40-60' ELSE 'a under 40' END"
B "lean" "i.lean"
B "spread as share of ask" "CASE WHEN i.ask IS NULL OR i.ask <= 0 OR i.bid IS NULL THEN 'none' WHEN (i.ask - i.bid) / i.ask < 0.03 THEN 'a <3%' WHEN (i.ask - i.bid) / i.ask < 0.06 THEN 'b 3-6%' WHEN (i.ask - i.bid) / i.ask < 0.12 THEN 'c 6-12%' ELSE 'd 12%+' END"
B "abs delta" "CASE WHEN i.delta IS NULL THEN 'none' WHEN abs(i.delta) < 0.15 THEN 'a <.15' WHEN abs(i.delta) < 0.3 THEN 'b .15-.30' WHEN abs(i.delta) < 0.5 THEN 'c .30-.50' WHEN abs(i.delta) < 0.7 THEN 'd .50-.70' ELSE 'e .70+' END"
B "time first seen (ET)" "CASE WHEN (i.features->>'time_of_day')::numeric < 0.077 THEN 'a first 30 min' WHEN (i.features->>'time_of_day')::numeric < 0.31 THEN 'b to 11:30' WHEN (i.features->>'time_of_day')::numeric < 0.69 THEN 'c to 14:00' ELSE 'd after 14:00' END"
B "kind" "coalesce(i.issue_type, 'index/none')"
B "premium" "CASE WHEN i.premium < 250000 THEN 'a <250k' WHEN i.premium < 1000000 THEN 'b 250k-1M' WHEN i.premium < 5000000 THEN 'c 1-5M' ELSE 'd 5M+' END"
B "sweep" "i.has_sweep::text"
B "all opening" "i.all_opening::text"
B "bursts" "CASE WHEN i.hits = 1 THEN '1' WHEN i.hits <= 3 THEN '2-3' ELSE '4+' END"
B "volume over open interest" "CASE WHEN i.open_interest = 0 THEN 'no oi' WHEN i.volume::numeric / i.open_interest < 0.5 THEN 'a <0.5' WHEN i.volume::numeric / i.open_interest < 2 THEN 'b 0.5-2' ELSE 'c 2+' END"
B "implied volatility" "CASE WHEN i.iv IS NULL THEN 'none' WHEN i.iv < 0.3 THEN 'a <30%' WHEN i.iv < 0.6 THEN 'b 30-60%' WHEN i.iv < 1 THEN 'c 60-100%' ELSE 'd 100%+' END"
B "score band (first shown)" "CASE WHEN coalesce((i.features->>'score0')::numeric, i.score) >= 75 THEN 'd 75+' WHEN coalesce((i.features->>'score0')::numeric, i.score) >= 60 THEN 'c 60-75' WHEN coalesce((i.features->>'score0')::numeric, i.score) >= 45 THEN 'b 45-60' ELSE 'a <45' END"
B "bought and with the day: lean vs SPY day move" "CASE WHEN i.ask_premium + i.bid_premium > 0 AND i.ask_premium / (i.ask_premium + i.bid_premium) >= 0.6 THEN 'ask-side ' || i.option_type ELSE 'not ask-side' END"
echo "## underlying move after the bet (stocks with stored bars): n | avg signed move toward the contract | win%"
Q "SELECT i.trade_date, count(*), round(100 * avg(CASE WHEN i.option_type = 'C' THEN 1 ELSE -1 END * (c.v / i.underlying_price - 1))::numeric, 2), round(100.0 * avg((o.status = 'win')::int), 0) FROM option_ideas i JOIN idea_outcomes o ON o.idea_id = i.id JOIN LATERAL (SELECT value AS v FROM live_series s WHERE s.name = 'px:' || i.ticker AND s.ts::date = i.trade_date AND (s.ts AT TIME ZONE 'America/New_York')::time < time '16:00' ORDER BY s.ts DESC LIMIT 1) c ON true WHERE i.horizon = 'intraday' AND o.status IN ('win','loss') AND i.underlying_price > 0 GROUP BY 1 ORDER BY 1"
echo "## SPY by day (open to close from bars): $(Q "SELECT (ts AT TIME ZONE 'America/New_York')::date, round((100 * ((array_agg(value ORDER BY ts DESC))[1] / (array_agg(value ORDER BY ts))[1] - 1))::numeric, 2) FROM live_series WHERE name = 'px:SPY' AND (ts AT TIME ZONE 'America/New_York')::time >= time '09:30' AND (ts AT TIME ZONE 'America/New_York')::time < time '16:00' GROUP BY 1 ORDER BY 1" | tr '\n' ';')"
echo "## marks per graded idea: $(Q "SELECT i.trade_date, round(avg(m.n), 1), min(m.n), max(m.n) FROM option_ideas i JOIN idea_outcomes o ON o.idea_id = i.id JOIN LATERAL (SELECT count(*) AS n FROM idea_marks k WHERE k.option_symbol = i.option_symbol AND k.marked_at > i.seen_at AND k.marked_at::date = i.trade_date + 0) m ON true WHERE i.horizon = 'intraday' AND o.status IN ('win','loss') GROUP BY 1 ORDER BY 1" | tr '\n' ';')"
echo "## exit quote spread at the close: $(Q "SELECT i.trade_date, round(100 * avg(CASE WHEN k.ask > 0 THEN (k.ask - k.bid) / k.ask END)::numeric, 1), round(100 * avg(CASE WHEN i.ask > 0 THEN (i.ask - i.bid) / i.ask END)::numeric, 1) FROM option_ideas i JOIN idea_outcomes o ON o.idea_id = i.id JOIN idea_marks k ON k.option_symbol = i.option_symbol AND k.marked_at = o.exit_at WHERE i.horizon = 'intraday' AND o.status IN ('win','loss') GROUP BY 1 ORDER BY 1" | tr '\n' ';') (exit spread % | entry spread %)"
echo "## exit time of day (ET): $(Q "SELECT i.trade_date, to_char(min(o.exit_at) AT TIME ZONE 'America/New_York', 'HH24:MI:SS'), to_char(max(o.exit_at) AT TIME ZONE 'America/New_York', 'HH24:MI:SS') FROM option_ideas i JOIN idea_outcomes o ON o.idea_id = i.id WHERE i.horizon = 'intraday' AND o.status IN ('win','loss') GROUP BY 1 ORDER BY 1" | tr '\n' ';')"
