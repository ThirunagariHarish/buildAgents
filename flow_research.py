#!/usr/bin/env python3
"""
Research on past option flow. Builds a graded dataset from the data vendor (flow alerts, each contract's closing
quote, daily bars), then tests a multi-pass selection and tunes it. Prints aggregates only: no rows, no secrets.

Grade, same as the live app: in at the ask when the alert is seen, out at that day's closing bid.
Stages: fetch (cached in the app database, schema `research`) -> features -> walk-forward model -> tuning on the
earlier days -> report on the later days that tuning never saw.
"""
import base64, gzip, hashlib, json, math, os, random, subprocess, sys, time, urllib.parse, urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np

ET = ZoneInfo("America/New_York")
BASE = "https://api.unusualwhales.com"
TOKEN = os.environ["UW_TOKEN"]
NS = "unusual-options-detector"
KC = ["kubectl", "--kubeconfig", os.environ["KCFG"], "--request-timeout=180s", "-n", NS]
DAYS = int(os.environ.get("DAYS", "20"))
MAXC = int(os.environ.get("MAXC", "700"))
KEY = os.environ.get("BLOB", f"flow-{DAYS}d-{MAXC}c")
STAGE = os.environ.get("STAGE", "all")
TRIALS = int(os.environ.get("TRIALS", "400"))
T0 = time.time()


def log(*a):
    print(f"[{time.time() - T0:6.0f}s]", *a, flush=True)


# ---------------------------------------------------------------- vendor and storage

def get(path, params=None, tries=6):
    url = BASE + path + ("?" + urllib.parse.urlencode(params, doseq=True) if params else "")
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"Authorization": f"Bearer {TOKEN}", "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500:
                time.sleep(min(20, float(e.headers.get("retry-after") or 0) or (0.6 * (i + 1) + random.random())))
                continue
            return None
        except Exception:
            time.sleep(1 + i)
    return None


def psql(sql, capture=True):
    p = subprocess.run(KC + ["exec", "-i", f"statefulset/{NS}-db", "-c", "postgres", "--", "sh", "-c",
                             'psql -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At'],
                       input=sql.encode(), capture_output=True)
    if p.returncode != 0:
        log("psql failed:", p.stderr.decode()[:200])
    return p.stdout.decode() if capture else ""


def blob_put(key, obj):
    raw = gzip.compress(json.dumps(obj, separators=(",", ":")).encode(), 6)
    b64 = base64.b64encode(raw).decode()
    psql("CREATE SCHEMA IF NOT EXISTS research; CREATE TABLE IF NOT EXISTS research.blobs "
         "(key text, part int, data text, made timestamptz DEFAULT now(), PRIMARY KEY (key, part));"
         f"DELETE FROM research.blobs WHERE key = '{key}';")
    step = 3_000_000
    for n, i in enumerate(range(0, len(b64), step)):
        psql(f"INSERT INTO research.blobs (key, part, data) VALUES ('{key}', {n}, '{b64[i:i + step]}');")
    log(f"stored {key}: {len(raw) / 1e6:.1f} MB gz in {n + 1} parts")


def blob_get(key):
    out = psql(f"SELECT data FROM research.blobs WHERE key = '{key}' ORDER BY part;")
    b64 = "".join(out.split())
    if not b64:
        return None
    return json.loads(gzip.decompress(base64.b64decode(b64)))


# ---------------------------------------------------------------- fetch

def num(v):
    try:
        if v is None or v == "":
            return None
        f = float(v)
        return f if math.isfinite(f) else None
    except Exception:
        return None


def et_day(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(ET).date().isoformat()


def sessions(n):
    """The last n weekdays before today (ET) that have alerts; holidays drop out when a day comes back empty."""
    now = datetime.now(ET)
    out, d = [], now.date() if now.hour >= 17 else now.date() - timedelta(days=1)
    while len(out) < n + 4:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d -= timedelta(days=1)
    return out


KEEP = ["id", "created_at", "ticker", "option_chain", "type", "strike", "expiry", "underlying_price", "total_premium",
        "total_ask_side_prem", "total_bid_side_prem", "volume", "open_interest", "has_sweep", "has_floor",
        "all_opening_trades", "bid", "ask", "price", "delta", "iv_end", "iv", "issue_type", "next_earnings_date",
        "marketcap", "sector", "alert_rule"]


def fetch_day(day):
    rows, older = {}, (date.fromisoformat(day) + timedelta(days=1)).isoformat() + "T05:00:00Z"
    for _ in range(90):
        j = get("/api/option-trades/flow-alerts", {"limit": 200, "min_premium": 100000, "is_multi_leg": "false",
                                                    "older_than": older})
        data = (j or {}).get("data") or []
        if not data:
            break
        stop = False
        for r in data:
            d = et_day(r["created_at"])
            if d == day:
                rows[r["id"]] = {k: r.get(k) for k in KEEP}
            elif d < day:
                stop = True
        oldest = min(r["created_at"] for r in data)
        if stop or len(data) < 200 or oldest == older:
            break
        older = oldest
    return list(rows.values())


def pre_gate(a):
    ask, bid = num(a["ask"]), num(a["bid"])
    ap, bp = num(a["total_ask_side_prem"]) or 0, num(a["total_bid_side_prem"]) or 0
    if not ask or ask < 0.05 or bid is None:
        return False
    if ap + bp <= 0 or ap / (ap + bp) < 0.5:
        return False
    return (ask - bid) / ask <= 0.25


def fetch_all():
    days, alerts = [], {}
    for d in sessions(DAYS):
        if len(days) >= DAYS:
            break
        rows = fetch_day(d)
        if len(rows) < 300:
            continue
        days.append(d)
        alerts[d] = rows
        log(f"alerts {d}: {len(rows)}")
    # Which contracts to price: those whose first alert passes a loose gate, a seeded sample per day.
    want = {}
    for d in days:
        first = {}
        for a in sorted(alerts[d], key=lambda r: r["created_at"]):
            first.setdefault(a["option_chain"], a)
        cands = sorted((s for s, a in first.items() if pre_gate(a)),
                       key=lambda s: hashlib.md5((d + s).encode()).hexdigest())
        for s in cands[:MAXC]:
            want.setdefault(s, set()).add(d)
        log(f"contracts {d}: {len(first)} seen, {len(cands)} pass the loose gate, {min(len(cands), MAXC)} priced")
    syms = sorted(want)
    closes, done, t = {}, [0], time.time()

    def one(sym):
        j = get(f"/api/option-contract/{sym}/historic")
        rows = (j or {}).get("chains") or []
        keep = {}
        lo = min(want[sym])
        for r in rows:
            dd = str(r.get("date"))[:10]
            if dd >= lo:
                keep[dd] = [num(r.get("nbbo_bid")), num(r.get("nbbo_ask")), num(r.get("last_price")),
                            num(r.get("high_price")), num(r.get("low_price"))]
        done[0] += 1
        if done[0] % 2000 == 0:
            log(f"  closes {done[0]}/{len(syms)} at {done[0] / (time.time() - t):.1f}/s")
        return sym, keep

    with ThreadPoolExecutor(int(os.environ.get("WORKERS", "6"))) as ex:
        for sym, keep in ex.map(one, syms):
            if keep:
                closes[sym] = keep
    log(f"closes: {len(closes)} of {len(syms)} contracts in {time.time() - t:.0f}s")
    tickers = sorted({a["ticker"] for d in days for a in alerts[d] if a["option_chain"] in want} | {"SPY", "QQQ"})
    bars = {}

    def bar(tk):
        j = get(f"/api/stock/{tk}/ohlc/1d", {"limit": 400})
        out = {}
        for r in (j or {}).get("data") or []:
            if r.get("market_time") in (None, "r"):
                c = num(r.get("close"))
                if c:
                    out[str(r.get("date") or r.get("start_time"))[:10]] = [num(r.get("open")), c]
        return tk, out

    with ThreadPoolExecutor(6) as ex:
        for tk, out in ex.map(bar, tickers):
            if out:
                bars[tk] = out
    log(f"daily bars: {len(bars)} of {len(tickers)} tickers")
    spy5 = {}
    for d in days:
        j = get("/api/stock/SPY/ohlc/5m", {"date": d, "limit": 200})
        pts = sorted((r["start_time"], num(r.get("close"))) for r in (j or {}).get("data") or []
                     if r.get("market_time") == "r" and et_day(r["start_time"]) == d)
        if pts:
            spy5[d] = pts
    log(f"SPY intraday bars for {len(spy5)} of {len(days)} days")
    return {"days": days, "alerts": alerts, "want": {s: sorted(v) for s, v in want.items()}, "closes": closes,
            "bars": bars, "spy5": spy5}


# ---------------------------------------------------------------- features

FEATS = ["log_prem", "ask_share", "spread", "log_dte", "dte0", "abs_delta", "otm", "iv", "sweep", "floor", "opening",
         "voi", "is_call", "is_etf", "is_index", "tod", "earn", "hits", "log_ask", "log_mcap", "und_move", "und_mom5",
         "und_gap", "spy_move", "tkr_conf", "tkr_n", "mkt_tide", "rep_fill"]


def build(ds):
    X, meta = [], []
    for d in ds["days"]:
        al = sorted(ds["alerts"][d], key=lambda r: r["created_at"])
        open_ts = datetime.fromisoformat(d + "T09:30:00").replace(tzinfo=ET).timestamp()
        spy = ds["spy5"].get(d) or []
        spy_bars = ds["bars"].get("SPY", {})
        prev_days = sorted(k for k in spy_bars if k < d)
        spy_prev = spy_bars[prev_days[-1]][1] if prev_days else None
        seen, tkr_call, tkr_put, tkr_contracts = {}, defaultdict(float), defaultdict(float), defaultdict(set)
        mkt_call = mkt_put = 0.0
        for a in al:
            sym, tk = a["option_chain"], a["ticker"]
            is_call = str(a["type"]).lower() == "call"
            prem, ap, bp = num(a["total_premium"]) or 0, num(a["total_ask_side_prem"]) or 0, num(a["total_bid_side_prem"]) or 0
            ts = datetime.fromisoformat(a["created_at"].replace("Z", "+00:00")).timestamp()
            st = seen.setdefault(sym, {"hits": 0, "prem": 0.0, "ap": 0.0, "bp": 0.0, "sweep": False, "asc": 0})
            st["hits"] += 1; st["prem"] += prem; st["ap"] += ap; st["bp"] += bp
            st["sweep"] = st["sweep"] or bool(a["has_sweep"])
            st["asc"] += 1 if "Ascending" in str(a.get("alert_rule")) else 0
            # Context uses only what was on the tape before this alert.
            sgn = 1 if is_call else -1
            tc, tp = tkr_call[tk], tkr_put[tk]
            conf = ((tc if is_call else tp) + ap) / (tc + tp + ap) if (tc + tp + ap) > 0 else 0.5
            tide = sgn * (mkt_call - mkt_put) / (mkt_call + mkt_put) if (mkt_call + mkt_put) > 0 else 0.0
            n_same = len(tkr_contracts[(tk, is_call)])
            if is_call: tkr_call[tk] += ap; mkt_call += ap
            else: tkr_put[tk] += ap; mkt_put += ap
            tkr_contracts[(tk, is_call)].add(sym)
            if sym not in ds["want"] or d not in ds["want"][sym] or st["hits"] > 4:
                continue
            ask, bid = num(a["ask"]), num(a["bid"])
            cl = (ds["closes"].get(sym) or {}).get(d)
            if not ask or ask < 0.05 or bid is None or not cl or cl[0] is None:
                continue
            und = num(a["underlying_price"])
            strike = num(a["strike"]) or 0
            dte = (date.fromisoformat(str(a["expiry"])[:10]) - date.fromisoformat(d)).days
            if dte < 0:
                continue
            tb = ds["bars"].get(tk, {})
            pd_ = sorted(k for k in tb if k < d)
            prev = tb[pd_[-1]][1] if pd_ else None
            prev5 = tb[pd_[-6]][1] if len(pd_) >= 6 else None
            day_open = tb[d][0] if d in tb else None
            day_close = tb[d][1] if d in tb else None
            spy_now = None
            for t_, c_ in spy:
                if datetime.fromisoformat(t_.replace("Z", "+00:00")).timestamp() + 300 <= ts:
                    spy_now = c_
            delta = num(a["delta"])
            iv = num(a["iv_end"]) or num(a["iv"])
            mc = num(a["marketcap"])
            share = st["ap"] / (st["ap"] + st["bp"]) if st["ap"] + st["bp"] > 0 else 0.5
            ne = str(a.get("next_earnings_date") or "")[:10]
            it = a.get("issue_type")
            f = {
                "log_prem": math.log10(max(st["prem"], 1)), "ask_share": share, "spread": min(0.5, (ask - bid) / ask),
                "log_dte": math.log(1 + dte), "dte0": 1.0 if dte == 0 else 0.0,
                "abs_delta": abs(delta) if delta is not None else np.nan,
                "otm": max(-0.5, min(0.5, sgn * (strike - und) / und)) if und else np.nan,
                "iv": min(5, iv) if iv else np.nan, "sweep": 1.0 if st["sweep"] else 0.0,
                "floor": 1.0 if a["has_floor"] else 0.0, "opening": 1.0 if a["all_opening_trades"] else 0.0,
                "voi": min(20, (num(a["volume"]) or 0) / num(a["open_interest"])) if num(a["open_interest"]) else 20.0,
                "is_call": 1.0 if is_call else 0.0, "is_etf": 1.0 if it == "ETF" else 0.0,
                "is_index": 1.0 if it in (None, "Index") else 0.0,
                "tod": max(0, min(1, (ts - open_ts) / 23400)), "earn": 1.0 if ne and d <= ne <= str(a["expiry"])[:10] else 0.0,
                "hits": float(st["hits"]), "log_ask": math.log10(ask),
                "log_mcap": math.log10(mc) if mc and mc > 0 else np.nan,
                "und_move": sgn * (und / prev - 1) if und and prev else np.nan,
                "und_mom5": sgn * (prev / prev5 - 1) if prev and prev5 else np.nan,
                "und_gap": sgn * (day_open / prev - 1) if day_open and prev else np.nan,
                "spy_move": sgn * (spy_now / spy_prev - 1) if spy_now and spy_prev else np.nan,
                "tkr_conf": conf, "tkr_n": math.log1p(n_same), "mkt_tide": tide,
                "rep_fill": 1.0 if st["asc"] else 0.0,
            }
            ret = cl[0] / ask - 1
            nxt = sorted(k for k in (ds["closes"].get(sym) or {}) if k > d)
            ret1 = (ds["closes"][sym][nxt[0]][0] / ask - 1) if nxt and ds["closes"][sym][nxt[0]][0] is not None else np.nan
            X.append([f[k] for k in FEATS])
            meta.append({"day": d, "sym": sym, "tk": tk, "k": st["hits"], "ret": ret, "ret1": ret1, "dte": dte,
                         "share": share, "spread": f["spread"], "delta": delta, "prem": st["prem"], "call": is_call,
                         "und_ret": sgn * (day_close / und - 1) if day_close and und else np.nan, "ts": ts - open_ts,
                         "it": it, "ask": ask})
    return np.array(X, dtype=float), meta


def v2_score(m, f):
    """The app's version-2 score, from the same fields (rarity is left out: it needs the app's own history)."""
    w, got = 0.0, 0.0
    def add(weight, s):
        nonlocal w, got
        if s is None or (isinstance(s, float) and math.isnan(s)): return
        w += weight; got += weight * max(0.0, min(1.0, s))
    add(18, (f["log_prem"] - 5) / 1.699)
    add(16, 1 - m["spread"] / 0.12)
    add(14, 0.2 if m["dte"] == 0 else 1 if m["dte"] <= 3 else 0.8 if m["dte"] <= 7 else 0.7 if m["dte"] <= 21 else 0.5 if m["dte"] <= 60 else 0.3)
    d = abs(m["delta"]) if m["delta"] is not None else None
    add(10, None if d is None else 0.2 if d < 0.15 else 0.6 if d < 0.25 else 1 if d <= 0.6 else 0.6 if d <= 0.75 else 0.3)
    add(10, 0.7 * max(0, min(1, (m["share"] - 0.5) / 0.4)) + 0.3 * f["sweep"])
    add(8, 1 if m["k"] >= 4 else 0.5 if m["k"] >= 2 else 0)
    add(6, f["voi"] / 5)
    add(4, abs(m["share"] - 0.5) * 2)
    s = 100 * got / w if w else 0
    if f["earn"]: s *= 0.85
    if m["share"] < 0.6 or m["spread"] >= 0.12: s = min(s, 59)
    return s


# ---------------------------------------------------------------- reporting helpers

def stats(rets):
    r = np.asarray(rets, dtype=float)
    if len(r) == 0:
        return "n=0"
    return f"n={len(r)} win={100 * np.mean(r > 0):.0f}% avg={100 * np.mean(r):+.1f}% med={100 * np.median(r):+.1f}%"


def by_day(meta, idx):
    out = defaultdict(list)
    for i in idx:
        out[meta[i]["day"]].append(meta[i]["ret"])
    return out


def day_line(meta, idx, days):
    bd = by_day(meta, idx)
    wr = [np.mean(np.array(bd[d]) > 0) for d in days if len(bd[d]) >= 3]
    av = [np.mean(bd[d]) for d in days if len(bd[d]) >= 3]
    if not wr:
        return "no day with 3+ picks"
    return (f"days with 3+ picks {len(wr)}/{len(days)}; day win rate med {100 * np.median(wr):.0f}% "
            f"(min {100 * min(wr):.0f}%, max {100 * max(wr):.0f}%), days above 50% {sum(w > 0.5 for w in wr)}, "
            f"days with a positive average {sum(a > 0 for a in av)}")


def first_pick(meta, mask):
    """One entry per contract and day: the first alert at which the rule is met."""
    seen, out = set(), []
    for i in np.where(mask)[0]:
        key = (meta[i]["day"], meta[i]["sym"])
        if key not in seen:
            seen.add(key); out.append(i)
    return np.array(out, dtype=int)


def main():
    ds = None if os.environ.get("FORCE") else blob_get(KEY)
    if ds is None:
        if STAGE == "tune":
            log("no stored dataset"); return
        ds = fetch_all()
        blob_put(KEY, ds)
    else:
        log(f"loaded {KEY} from the database")
    if STAGE == "fetch":
        return
    days = sorted(ds["days"])
    X, meta = build(ds)
    y = np.array([m["ret"] > 0 for m in meta], dtype=float)
    ret = np.array([m["ret"] for m in meta])
    dayv = np.array([m["day"] for m in meta])
    log(f"dataset: {len(days)} sessions {days[0]} .. {days[-1]}, {len(meta)} graded alert-entries, "
        f"{len({(m['day'], m['sym']) for m in meta})} contract-days")
    F = {k: X[:, i] for i, k in enumerate(FEATS)}
    k1 = np.array([m["k"] == 1 for m in meta])
    intr = np.array([m["dte"] <= 7 for m in meta])
    print("\n== 1. Base rates (first sighting, one per contract and day; in at the ask, out at that day's closing bid)")
    print("all priced bets (loose gate: half or more at the ask, spread to 25%):", stats(ret[k1]))
    print("  expiring within a week:", stats(ret[k1 & intr]), "| longer:", stats(ret[k1 & ~intr]))
    print("  calls:", stats(ret[k1 & (F['is_call'] == 1)]), "| puts:", stats(ret[k1 & (F['is_call'] == 0)]))
    bd = by_day(meta, np.where(k1 & intr)[0])
    print("  per day (within a week): " + " ".join(f"{d[5:]}:{100 * np.mean(np.array(bd[d]) > 0):.0f}%/{len(bd[d])}" for d in days))
    sc = np.array([v2_score(m, {k: F[k][i] for k in FEATS}) for i, m in enumerate(meta)])
    print("\n== 2. The app's version-2 score on these sessions (first sighting, within a week)")
    for lo, hi in [(0, 45), (45, 60), (60, 70), (70, 80), (80, 101)]:
        mk = k1 & intr & (sc >= lo) & (sc < hi)
        print(f"  score {lo}-{hi}: {stats(ret[mk])}")
    mk = k1 & intr & (sc >= 60)
    print("  the list (60+):", stats(ret[mk]), "|", day_line(meta, np.where(mk)[0], days))

    print("\n== 3. Single facts, first sighting within a week (bucket: n, win rate, average)")
    def cut(name, vals, edges, labels):
        parts = []
        for j, lab in enumerate(labels):
            mk = k1 & intr & (vals >= edges[j]) & (vals < edges[j + 1])
            if mk.sum() >= 30:
                parts.append(f"{lab}: {mk.sum()}/{100 * np.mean(ret[mk] > 0):.0f}%/{100 * np.mean(ret[mk]):+.1f}%")
        print(f"  {name}: " + " | ".join(parts))
    inf = float("inf")
    cut("days to expiry", np.array([m["dte"] for m in meta], float), [0, 1, 2, 4, 8], ["0", "1", "2-3", "4-7"])
    cut("spread", F["spread"], [0, .02, .04, .08, .15, 1], ["<2%", "2-4%", "4-8%", "8-15%", "15%+"])
    cut("abs delta", np.nan_to_num(F["abs_delta"], nan=-1), [0, .15, .3, .45, .6, .8, 1.01], ["<.15", ".15-.3", ".3-.45", ".45-.6", ".6-.8", ".8+"])
    cut("share at ask", F["ask_share"], [.5, .7, .85, .95, 1.01], ["50-70", "70-85", "85-95", "95+"])
    cut("premium", F["log_prem"], [5, 5.4, 6, 6.7, 9], ["<250k", "250k-1M", "1-5M", "5M+"])
    cut("time of day", F["tod"], [0, .077, .31, .54, .77, 1.01], ["first 30m", "to 11:30", "to 13:00", "to 14:30", "late"])
    cut("stock move so far, toward the bet", np.nan_to_num(F["und_move"], nan=-9), [-1, -.02, -.005, .005, .02, 1], ["against 2%+", "against", "flat", "with", "with 2%+"])
    cut("SPY move so far, toward the bet", np.nan_to_num(F["spy_move"], nan=-9), [-1, -.005, -.001, .001, .005, 1], ["against .5%+", "against", "flat", "with", "with .5%+"])
    cut("5-day stock trend toward the bet", np.nan_to_num(F["und_mom5"], nan=-9), [-1, -.05, -.01, .01, .05, 1], ["against 5%+", "against", "flat", "with", "with 5%+"])
    cut("ticker flow agrees (share of ask-side premium)", F["tkr_conf"], [0, .3, .5, .7, .9, 1.01], ["<30", "30-50", "50-70", "70-90", "90+"])
    cut("market flow so far toward the bet", F["mkt_tide"], [-1.01, -.3, -.1, .1, .3, 1.01], ["against", "mild against", "even", "mild with", "with"])
    cut("kind", F["is_etf"] + 2 * F["is_index"], [0, 1, 2, 3], ["stock", "ETF", "index"])
    cut("option price", F["log_ask"], [-2, -.3, 0, .5, 1, 3], ["<0.5", "0.5-1", "1-3", "3-10", "10+"])
    for kk in (1, 2, 3, 4):
        mk = np.array([m["k"] == kk for m in meta]) & intr
        print(f"  entering at alert number {kk}: {stats(ret[mk])}")
    und = np.array([m["und_ret"] for m in meta])
    ok = k1 & intr & ~np.isnan(und)
    print(f"  shares after the bet, toward it: avg {100 * np.nanmean(und[ok]):+.2f}%, moved toward {100 * np.mean(und[ok] > 0):.0f}% of the time (n={ok.sum()})")

    # ---------------- walk-forward model: train on earlier days only
    print("\n== 4. A model trained only on earlier days (walk-forward), scored on each later day")
    med = np.nanmedian(X, axis=0)
    Xf = np.where(np.isnan(X), med, X)
    use = intr
    oof = {"logit": np.full(len(meta), np.nan), "gbm": np.full(len(meta), np.nan)}
    try:
        from sklearn.linear_model import LogisticRegression
        from sklearn.ensemble import HistGradientBoostingClassifier
        from sklearn.preprocessing import StandardScaler
        from sklearn.metrics import roc_auc_score
        MIN_TRAIN = max(6, len(days) // 3)
        for j in range(MIN_TRAIN, len(days)):
            tr = use & np.isin(dayv, days[:j]); te = use & (dayv == days[j])
            if tr.sum() < 500 or te.sum() == 0:
                continue
            sc_ = StandardScaler().fit(Xf[tr])
            lr = LogisticRegression(C=0.3, max_iter=400).fit(sc_.transform(Xf[tr]), y[tr])
            oof["logit"][te] = lr.predict_proba(sc_.transform(Xf[te]))[:, 1]
            gb = HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=150, min_samples_leaf=80,
                                                l2_regularization=1.0).fit(X[tr], y[tr])
            oof["gbm"][te] = gb.predict_proba(X[te])[:, 1]
        test_days = [d for d in days[MIN_TRAIN:]]
        for name in ("logit", "gbm"):
            p = oof[name]; ok = ~np.isnan(p)
            if ok.sum() < 200:
                print(f"  {name}: too few scored"); continue
            aucs = [roc_auc_score(y[ok & (dayv == d)], p[ok & (dayv == d)]) for d in test_days
                    if 0 < y[ok & (dayv == d)].mean() < 1]
            print(f"  {name}: AUC over all scored days {roc_auc_score(y[ok], p[ok]):.3f}; per-day AUC median "
                  f"{np.median(aucs):.3f}, days above 0.5: {sum(a > 0.5 for a in aucs)}/{len(aucs)}")
            for q in (0.5, 0.8, 0.9, 0.95):
                picks = []
                for d in test_days:
                    mk = ok & (dayv == d) & k1
                    if mk.sum() < 20: continue
                    thr = np.quantile(p[mk], q)
                    picks += list(np.where(mk & (p >= thr))[0])
                print(f"    top {100 - int(q * 100)}% by model each day (first sighting): {stats(ret[picks])} | {day_line(meta, picks, test_days)}")
    except Exception as e:
        print("  sklearn unavailable or failed:", str(e)[:200]); test_days = days[len(days) // 3:]

    # ---------------- tuning: passes as rules, tuned on the earlier scored days, reported on the later ones
    print("\n== 5. Multi-pass rule, tuned on the earlier days and checked on later days it never saw")
    split = len(test_days) * 6 // 10
    tune_days, hold_days = test_days[:split], test_days[split:]
    P = np.where(np.isnan(oof["gbm"]), np.nan_to_num(oof["logit"], nan=0.0), oof["gbm"])
    # Rank of the model's estimate within its own day, so a threshold means the same thing every day.
    prank = np.zeros(len(meta))
    for d in test_days:
        mk = np.where((dayv == d) & intr)[0]
        if len(mk):
            prank[mk] = (np.argsort(np.argsort(P[mk])) + 1) / len(mk)
    dte = np.array([m["dte"] for m in meta]); hits = F["hits"]
    und_move = np.nan_to_num(F["und_move"], nan=0.0); spy_move = np.nan_to_num(F["spy_move"], nan=0.0)
    mom5 = np.nan_to_num(F["und_mom5"], nan=0.0); absd = np.nan_to_num(F["abs_delta"], nan=0.4)

    def select(p):
        mk = intr & (F["ask_share"] >= p["share"]) & (F["spread"] <= p["spread"]) & (F["log_prem"] >= p["prem"])
        mk &= (dte >= p["dte_lo"]) & (dte <= p["dte_hi"]) & (absd >= p["d_lo"]) & (absd <= p["d_hi"])
        mk &= (F["tod"] <= p["tod"]) & (F["log_ask"] >= p["price"]) & (hits >= p["hits"])
        if p["kind"] == "stock": mk &= (F["is_etf"] == 0) & (F["is_index"] == 0)
        elif p["kind"] == "fund": mk &= (F["is_etf"] == 1) | (F["is_index"] == 1)
        if p["side"] == "calls": mk &= F["is_call"] == 1
        elif p["side"] == "puts": mk &= F["is_call"] == 0
        if p["und"] is not None: mk &= und_move >= p["und"]
        if p["spy"] is not None: mk &= spy_move >= p["spy"]
        if p["mom"] is not None: mk &= mom5 >= p["mom"]
        if p["conf"] is not None: mk &= F["tkr_conf"] >= p["conf"]
        if p["tide"] is not None: mk &= F["mkt_tide"] >= p["tide"]
        mk &= prank >= p["model"]
        return first_pick(meta, mk)

    def score(idx, ds_):
        idx = [i for i in idx if meta[i]["day"] in ds_]
        if len(idx) < 4 * len(ds_):
            return -1.0, idx
        bd = by_day(meta, idx)
        covered = sum(len(bd[d]) >= 3 for d in ds_) / len(ds_)
        if covered < 0.7:
            return -1.0, idx
        wr = np.mean([np.mean(np.array(bd[d]) > 0) for d in ds_ if len(bd[d]) >= 3])
        av = np.mean([np.mean(bd[d]) for d in ds_ if len(bd[d]) >= 3])
        # Win rate first, as asked; a rule that wins often but loses money on average is marked down.
        return wr + 0.5 * max(-0.3, min(0.3, av)), idx

    def space(t):
        return {
            "share": t.suggest_categorical("share", [0.5, 0.6, 0.7, 0.8, 0.9]),
            "spread": t.suggest_categorical("spread", [0.02, 0.03, 0.05, 0.08, 0.12, 0.25]),
            "prem": t.suggest_categorical("prem", [5.0, 5.4, 5.7, 6.0]),
            "dte_lo": t.suggest_categorical("dte_lo", [0, 1, 2]),
            "dte_hi": t.suggest_categorical("dte_hi", [1, 3, 7]),
            "d_lo": t.suggest_categorical("d_lo", [0.0, 0.2, 0.3, 0.45, 0.6]),
            "d_hi": t.suggest_categorical("d_hi", [0.5, 0.7, 0.85, 1.0]),
            "tod": t.suggest_categorical("tod", [0.2, 0.4, 0.6, 0.8, 1.0]),
            "price": t.suggest_categorical("price", [-2.0, -0.3, 0.0, 0.3]),
            "hits": t.suggest_categorical("hits", [1, 2, 3]),
            "kind": t.suggest_categorical("kind", ["any", "stock", "fund"]),
            "side": "any",
            "und": t.suggest_categorical("und", [None, -0.005, 0.0, 0.005, 0.01]),
            "spy": t.suggest_categorical("spy", [None, -0.002, 0.0, 0.002]),
            "mom": t.suggest_categorical("mom", [None, -0.02, 0.0, 0.02]),
            "conf": t.suggest_categorical("conf", [None, 0.5, 0.7, 0.9]),
            "tide": t.suggest_categorical("tide", [None, -0.1, 0.0, 0.1]),
            "model": t.suggest_categorical("model", [0.0, 0.5, 0.7, 0.8, 0.9]),
        }

    base = {"share": 0.6, "spread": 0.12, "prem": 5.0, "dte_lo": 0, "dte_hi": 7, "d_lo": 0.0, "d_hi": 1.0, "tod": 1.0,
            "price": -2.0, "hits": 1, "kind": "any", "side": "any", "und": None, "spy": None, "mom": None, "conf": None,
            "tide": None, "model": 0.0}
    if len(tune_days) < 4 or len(hold_days) < 3:
        print("  too few scored days to tune"); log("done"); return
    print(f"  tuned on {len(tune_days)} days ({tune_days[0]} .. {tune_days[-1]}), checked on {len(hold_days)} days ({hold_days[0]} .. {hold_days[-1]})")
    for label, ds_ in (("tuning days", tune_days), ("unseen days", hold_days)):
        _, idx = score(select(base), ds_)
        print(f"  no passes beyond the gate, {label}: {stats(ret[idx])} | {day_line(meta, idx, ds_)}")
    best = []
    try:
        import optuna
        optuna.logging.set_verbosity(optuna.logging.WARNING)
        if len(hold_days) < 3 or len(tune_days) < 4:
            raise RuntimeError("too few scored days to tune")

        def objective(t):
            p = space(t)
            if p["dte_lo"] > p["dte_hi"] or p["d_lo"] >= p["d_hi"]:
                return -1.0
            return score(select(p), tune_days)[0]

        study = optuna.create_study(direction="maximize", sampler=optuna.samplers.TPESampler(seed=7))
        study.optimize(objective, n_trials=TRIALS)
        done = sorted((t for t in study.trials if t.value is not None and t.value > 0), key=lambda t: -t.value)
        seen = set()
        for t in done:
            p = {**base, **t.params}
            key = json.dumps(p, sort_keys=True)
            if key in seen: continue
            seen.add(key); best.append(p)
            if len(best) >= 8: break
        print(f"  Optuna: {len(study.trials)} trials, {len(done)} usable")
        for n, p in enumerate(best[:8]):
            _, it = score(select(p), tune_days); _, ih = score(select(p), hold_days)
            ih = [i for i in select(p) if meta[i]["day"] in hold_days]
            short = {k: v for k, v in p.items() if v != base[k]}
            print(f"  #{n + 1} {json.dumps(short)}")
            print(f"       tuning days: {stats(ret[it])}")
            print(f"       UNSEEN days: {stats(ret[ih])} | {day_line(meta, ih, hold_days)}")
        # The honest summary: the average of the top rules on the unseen days, against the untuned gate.
        if best:
            allh = [i for p in best[:5] for i in select(p) if meta[i]["day"] in hold_days]
            print(f"  top five rules pooled, unseen days: {stats(ret[allh])}")
    except Exception as e:
        print("  tuning unavailable or failed:", str(e)[:300])

    # ---------------- robustness: simple rules a trader would state, on every scored day
    print("\n== 6. Plain rules on every scored day (not tuned), for comparison")
    def show(label, mk):
        idx = [i for i in first_pick(meta, intr & mk) if meta[i]["day"] in test_days]
        print(f"  {label}: {stats(ret[idx])} | {day_line(meta, idx, test_days)}")
    g = (F["ask_share"] >= 0.6) & (F["spread"] <= 0.12)
    show("gate only", g)
    show("gate + stock already moving toward the bet 0.5%+", g & (und_move >= 0.005))
    show("gate + stock moving against the bet 0.5%+", g & (und_move <= -0.005))
    show("gate + SPY moving toward the bet", g & (spy_move > 0.001))
    show("gate + SPY moving against the bet", g & (spy_move < -0.001))
    show("gate + second alert or later", g & (hits >= 2))
    show("gate + delta 0.45 to 0.85, 1-7 days, spread under 5%", g & (absd >= 0.45) & (absd <= 0.85) & (dte >= 1) & (F["spread"] <= 0.05))
    show("gate + model top 20% of its day", g & (prank >= 0.8))
    show("gate + model top 20% + stock moving toward", g & (prank >= 0.8) & (und_move >= 0.0))
    r1 = np.array([m["ret1"] for m in meta])
    ok = k1 & intr & g & ~np.isnan(r1) & (dte >= 1)
    print(f"  held to the next day's close instead (1+ days left): {stats(r1[ok])} vs same bets same-day: {stats(ret[ok])}")

    # ---------------- weights for the app: a logistic model on every day, with the features the app can compute
    print("\n== 7. Logistic model on all days (standardised), for the app")
    try:
        from sklearn.linear_model import LogisticRegression
        from sklearn.preprocessing import StandardScaler
        tr = intr
        s_ = StandardScaler().fit(Xf[tr]); lr = LogisticRegression(C=0.3, max_iter=600).fit(s_.transform(Xf[tr]), y[tr])
        out = {"features": FEATS, "median": [round(float(v), 5) for v in med], "mean": [round(float(v), 5) for v in s_.mean_],
               "sd": [round(float(v), 5) for v in s_.scale_], "w": [round(float(v), 4) for v in lr.coef_[0]],
               "b": round(float(lr.intercept_[0]), 4), "n": int(tr.sum()), "days": len(days), "base_rate": round(float(y[tr].mean()), 4)}
        print("  " + json.dumps(out))
        order = np.argsort(-np.abs(lr.coef_[0]))
        print("  strongest: " + ", ".join(f"{FEATS[i]} {lr.coef_[0][i]:+.2f}" for i in order[:12]))
    except Exception as e:
        print("  failed:", str(e)[:200])
    log("done")


if __name__ == "__main__":
    main()
