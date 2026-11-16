#!/usr/bin/env bash
# Read-only: how old is each data point the five tabs show, right now. Ages and counts only.
set -uo pipefail
NS=unusual-options-detector
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"; K="$KC -n $NS"
Q() { $K exec statefulset/$NS-db -c postgres -- sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -At -F ' | ' -c \"$1\"" 2>&1; }
A="to_char(now() - max(%s), 'DD\"d\" HH24:MI:SS')"
echo "now (ET): $(Q "SELECT to_char(now() AT TIME ZONE 'America/New_York', 'Dy YYYY-MM-DD HH24:MI:SS')")"
echo "images: $($K get deploy -o jsonpath='{range .items[*]}{.metadata.name}={.spec.template.spec.containers[0].image}{" "}{end}' | sed -E 's/ghcr.io\/[^:]*:([0-9a-f]{7})[0-9a-f]*/\1/g')"
echo "options   | newest bet age: $(Q "SELECT to_char(now() - max(seen_at), 'DD\\\"d\\\" HH24:MI:SS'), count(*) FILTER (WHERE trade_date = (now() AT TIME ZONE 'America/New_York')::date) FROM option_ideas")"
echo "options   | newest quote check age: $(Q "SELECT to_char(now() - max(marked_at), 'DD\\\"d\\\" HH24:MI:SS'), count(*) FILTER (WHERE marked_at > now() - interval '20 minutes') FROM idea_marks")"
echo "options   | graded sessions: $(Q "SELECT i.trade_date, i.horizon, count(*) FROM idea_outcomes o JOIN option_ideas i ON i.id = o.idea_id GROUP BY 1, 2 ORDER BY 1 DESC LIMIT 4" | tr '\n' ';')"
echo "series    | newest point age by family: $(Q "SELECT split_part(name, ':', 1), to_char(now() - max(ts), 'DD\\\"d\\\" HH24:MI:SS'), count(*) FILTER (WHERE ts > now() - interval '10 minutes') FROM live_series GROUP BY 1 ORDER BY 1" | tr '\n' ';')"
echo "series    | px per ticker (age, bars in last hour): $(Q "SELECT substr(name, 4), to_char(now() - max(ts), 'DD\\\"d\\\" HH24:MI'), count(*) FILTER (WHERE ts > now() - interval '1 hour') FROM live_series WHERE name LIKE 'px:%' GROUP BY 1 ORDER BY max(ts) DESC" | tr '\n' ';')"
echo "direction | calls today: $(Q "SELECT slot, lean, to_char(called_at AT TIME ZONE 'America/New_York', 'HH24:MI') FROM direction_calls WHERE trade_date = (now() AT TIME ZONE 'America/New_York')::date ORDER BY slot" | tr '\n' ';'); market_tide newest age: $(Q "SELECT to_char(now() - max(ts), 'DD\\\"d\\\" HH24:MI:SS') FROM market_tide")"
echo "direction | gamma estimate as of: $(Q "SELECT max(as_of), count(*) FROM gamma_strikes WHERE ticker = 'SPY'"); VIX (FRED) latest: $(Q "SELECT max(date) FROM macro_series WHERE series = 'VIXCLS'")"
echo "calendar  | econ events ahead: $(Q "SELECT count(*), min(event_time)::date, max(event_time)::date FROM econ_events WHERE event_time >= now()"); earnings read age: $(Q "SELECT to_char(now() - read_at, 'DD\\\"d\\\" HH24:MI') FROM markets_state WHERE key = 'trader:earnings'"); econ read (daily) age: $(Q "SELECT to_char(now() - read_at, 'DD\\\"d\\\" HH24:MI') FROM markets_state WHERE key = 'daily'")"
echo "chatter   | last Discord read age: $(Q "SELECT to_char(now() - max(last_polled_at), 'DD\\\"d\\\" HH24:MI:SS'), count(*), count(*) FILTER (WHERE error IS NOT NULL), count(*) FILTER (WHERE last_polled_at > now() - interval '3 minutes') FROM chatter_channels"); newest message age: $(Q "SELECT to_char(now() - max(posted_at), 'DD\\\"d\\\" HH24:MI:SS'), count(*) FILTER (WHERE posted_at > now() - interval '1 hour'), count(*) FILTER (WHERE posted_at > now() - interval '24 hours') FROM chatter_mentions")"
echo "chatter   | all messages per hour, last 6 hours: $(Q "SELECT to_char(hour AT TIME ZONE 'America/New_York', 'HH24:MI'), sum(messages) FROM chatter_activity WHERE hour > now() - interval '6 hours' GROUP BY 1 ORDER BY 1" | tr '\n' ';')"
echo "news      | newest headline age: $(Q "SELECT to_char(now() - max(created_at), 'DD\\\"d\\\" HH24:MI:SS'), count(*) FILTER (WHERE created_at > now() - interval '1 hour'), count(*) FILTER (WHERE created_at > now() - interval '1 hour' AND cardinality(tickers) > 0) FROM headlines")"
echo "macro     | official series, days since latest reading: $(Q "SELECT series, current_date - max(date) FROM macro_series GROUP BY 1 ORDER BY 2, 1" | tr '\n' ';')"
echo "worker    | last lines: "; $K logs deploy/$NS-worker --since=20m 2>/dev/null | grep -E '"msg":"(trader|trader failed|chatter read|chatter|markets read|chatter failed|markets failed)"' | tail -6 | cut -c1-330
echo "worker    | errors in 2h: $($K logs deploy/$NS-worker --since=2h 2>/dev/null | grep -c -i -E 'failed|unhandled')"
