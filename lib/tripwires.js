// Tripwires: the few things that would change the call, watched for you.
//
// Each reading leaves a short list of concrete, checkable conditions: the
// judge's own "what would change my mind" signals (when Claude is on), plus
// ones the desk derives from the claim and the data (halfway to the target,
// the 200-day trend breaking, fear spiking). They are checked on every run
// and through the day; when one trips, the owner hears about it and the
// desk re-reads the scenario straight away.
//
//   wire: { wid, kind: 'price'|'fred', id, op: 'above'|'below', value,
//           label, why, from: 'judge'|'desk', state: 'armed'|'tripped',
//           set, last: { value, date }, trippedAt?, hit?: { value, date } }

const crypto = require('crypto');
const data = require('./data');
const quant = require('./quant');

const SYM = /^[\^A-Z0-9.=\-]{1,15}$/;
const FRED = /^[A-Z0-9]{2,20}$/;
const today = () => new Date().toISOString().slice(0, 10);
const fmt = (v) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));
const widOf = (w) => crypto.createHash('sha1').update(`${w.kind}:${w.id}:${w.op}:${Number(w.value).toPrecision(4)}`).digest('hex').slice(0, 10);
const past = (w, v) => (w.op === 'above' ? v >= w.value : v <= w.value);

/** The latest value of what a wire watches, from a run's data when given, else fetched (cached). */
async function current(w, d = null) {
  try {
    if (w.kind === 'price') {
      const s = (d && d.prices && d.prices[w.id]) || (await data.prices(w.id));
      return { value: s.close[s.close.length - 1], date: s.dates[s.dates.length - 1] };
    }
    const f = (d && (d.fred || []).find((x) => x.id === w.id)) || (await data.fredSeries(w.id));
    const p = f && f.points[f.points.length - 1];
    return p ? { value: p[1], date: p[0] } : null;
  } catch { return null; }
}
const fromRun = (w, d) => {
  if (w.kind === 'price') { const s = d.prices[w.id]; return s ? { value: s.close[s.close.length - 1], date: s.dates[s.dates.length - 1] } : null; }
  const f = (d.fred || []).find((x) => x.id === w.id); const p = f && f.points[f.points.length - 1];
  return p ? { value: p[1], date: p[0] } : null;
};

/** Wires the desk sets from the claim and the data alone (no Claude needed). */
function deskWires(th, d) {
  const out = [];
  const s = d.prices[th.primary];
  if (s) {
    const c = s.close, last = c[c.length - 1], t = th.target, sym = th.primary;
    if (t.type === 'drawdown') {
      const hi = Math.max(...c.slice(-252));
      const lvl = hi * (1 - Math.abs(t.value) / 2);
      if (last > lvl) out.push({ kind: 'price', id: sym, op: 'below', value: lvl, label: `${sym} falls halfway to the claim`, why: `${fmt(lvl)} is a ${Math.round(Math.abs(t.value) * 50)}% fall from the 52-week high of ${fmt(hi)}: half the claimed drop.` });
    } else if ((t.type === 'touch' || t.type === 'close') && t.level) {
      const lvl = last + (t.level - last) / 2;
      out.push({ kind: 'price', id: sym, op: t.level < last ? 'below' : 'above', value: lvl, label: `${sym} gets halfway to ${fmt(t.level)}`, why: `Half of the move the claim needs, from ${fmt(last)} today.` });
    } else if (t.type === 'return' && t.value) {
      const lvl = last * (1 + t.value / 2);
      out.push({ kind: 'price', id: sym, op: t.value < 0 ? 'below' : 'above', value: lvl, label: `${sym} makes half the claimed move`, why: `${fmt(lvl)} is a ${Math.round(Math.abs(t.value) * 50)}% move from ${fmt(last)}.` });
    }
    const sma = quant.smaSeries(c, 200)[c.length - 1];
    if (sma) {
      const up = last > sma;
      out.push({ kind: 'price', id: sym, op: up ? 'below' : 'above', value: sma, label: `${sym} ${up ? 'breaks below' : 'climbs back above'} its 200-day average`, why: up ? 'The long-term uptrend would break, which the trend analyst weighs heavily.' : 'The long-term downtrend would end.' });
    }
  }
  const vix = (d.fred || []).find((x) => x.id === 'VIXCLS');
  const v = vix && vix.points[vix.points.length - 1];
  if (v && v[1] < 30) out.push({ kind: 'fred', id: 'VIXCLS', op: 'above', value: 30, label: 'Fear spikes: VIX above 30', why: 'A VIX above 30 marks a market under real stress.' });
  const hy = (d.fred || []).find((x) => x.id === 'BAMLH0A0HYM2');
  const h = hy && hy.points[hy.points.length - 1];
  if (h && h[1] < 5) out.push({ kind: 'fred', id: 'BAMLH0A0HYM2', op: 'above', value: 5, label: 'Credit stress: high-yield spread above 5%', why: 'Credit usually cracks before stocks do.' });
  return out.map((w) => ({ ...w, from: 'desk' }));
}

/** The judge's checkable signals: watch items that came with a {kind,id,op,value} check. */
function judgeWires(judge) {
  return (judge.watch || []).filter((x) => x.check).map((x) => {
    const c = x.check;
    const kind = c.kind === 'fred' ? 'fred' : 'price';
    const id = String(c.id || '').toUpperCase().trim();
    if (!(kind === 'price' ? SYM : FRED).test(id) || !['above', 'below'].includes(c.op) || !Number.isFinite(Number(c.value))) return null;
    return { kind, id, op: c.op, value: Number(c.value), label: String(x.signal || '').slice(0, 120), why: String(x.why || '').slice(0, 200), from: 'judge' };
  }).filter(Boolean);
}

/**
 * After a run: first check the wires that were armed (any trips are returned),
 * then arm today's set. A new wire already past its line is not a tripwire, so
 * it is left out.
 */
function refresh(prevWires, th, judge, d) {
  const wires = (prevWires || []).map((w) => ({ ...w }));
  const tripped = [];
  for (const w of wires) {
    if (w.state !== 'armed') continue;
    const cur = fromRun(w, d);
    if (!cur) continue;
    w.last = cur;
    if (past(w, cur.value)) { w.state = 'tripped'; w.trippedAt = Date.now(); w.hit = cur; tripped.push(w); }
  }
  const kept = wires.filter((w) => w.state === 'tripped').slice(-6);
  const armed = [];
  for (const w of [...judgeWires(judge), ...(th.target.type === 'none' ? [] : deskWires(th, d))]) {
    const cur = fromRun(w, d);
    if (!cur || past(w, cur.value)) continue;
    w.wid = widOf(w);
    if (armed.some((x) => x.wid === w.wid || (x.kind === w.kind && x.id === w.id && x.op === w.op && Math.abs(x.value / w.value - 1) < 0.01))) continue;
    const before = wires.find((x) => x.wid === w.wid && x.state === 'armed');
    armed.push({ ...w, state: 'armed', set: before ? before.set : today(), last: cur });
  }
  return { wires: [...kept, ...armed.slice(0, 6)], tripped };
}

/** Between runs: check armed wires against the latest data. Returns { wires, tripped }. */
async function check(prevWires) {
  const wires = (prevWires || []).map((w) => ({ ...w }));
  const tripped = [];
  for (const w of wires) {
    if (w.state !== 'armed') continue;
    const cur = await current(w);
    if (!cur) continue;
    w.last = cur;
    if (past(w, cur.value)) { w.state = 'tripped'; w.trippedAt = Date.now(); w.hit = cur; tripped.push(w); }
  }
  return { wires, tripped };
}

const describe = (w) => `${w.label}: ${w.kind === 'fred' ? (data.FRED_INFO[w.id] || w.id) : w.id} ${w.op} ${fmt(w.value)}`;

module.exports = { refresh, check, deskWires, judgeWires, describe, fmt };
