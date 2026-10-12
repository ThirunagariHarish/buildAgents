// Turning speech into a scenario. The browser does speech-to-text (or the
// server's Whisper does); this file shapes what was said: with Claude, into
// a clean claim plus reasons, or into the Builder's fields; without Claude,
// a rule-based reader handles the Builder ("Nvidia falls 30 percent by June").

const { askJson } = require('./claude');

const NAMES = {
  'S&P 500': 'SPY', 'S AND P': 'SPY', 'S&P': 'SPY', 'SP 500': 'SPY', 'THE MARKET': 'SPY', 'STOCK MARKET': 'SPY', 'NASDAQ': 'QQQ', 'NASDAQ 100': 'QQQ', 'TECH': 'QQQ', 'RUSSELL': 'IWM', 'SMALL CAPS': 'IWM', 'DOW': 'DIA',
  NVIDIA: 'NVDA', APPLE: 'AAPL', MICROSOFT: 'MSFT', GOOGLE: 'GOOGL', ALPHABET: 'GOOGL', AMAZON: 'AMZN', META: 'META', FACEBOOK: 'META', TESLA: 'TSLA', NETFLIX: 'NFLX', AMD: 'AMD', BROADCOM: 'AVGO', TSMC: 'TSM', INTEL: 'INTC', PALANTIR: 'PLTR',
  SEMICONDUCTORS: 'SMH', SEMIS: 'SMH', CHIPS: 'SMH', 'CHIP STOCKS': 'SMH', BITCOIN: 'BTC-USD', ETHEREUM: 'ETH-USD', GOLD: 'GC=F', OIL: 'CL=F', 'CRUDE': 'CL=F', VIX: '^VIX', VOLATILITY: '^VIX', 'TEN YEAR': '^TNX', '10 YEAR': '^TNX', 'TREASURY YIELD': '^TNX', BONDS: 'TLT',
};
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const WORDNUM = { five: 5, ten: 10, fifteen: 15, twenty: 20, 'twenty five': 25, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, hundred: 100 };

function findSymbols(text) {
  const up = ` ${text.toUpperCase()} `;
  const hits = [];
  for (const [name, sym] of Object.entries(NAMES).sort((a, b) => b[0].length - a[0].length)) {
    const i = up.indexOf(` ${name}`);
    if (i >= 0 && !hits.some((h) => h.sym === sym)) hits.push({ sym, i });
  }
  // Spoken or typed tickers: "$NVDA", "N V D A", or an all-caps word.
  for (const m of text.matchAll(/\$?\b([A-Z]{2,5})\b/g)) if (!['I', 'BY', 'TO', 'THE', 'AND', 'OR', 'OF', 'IN', 'ON', 'AT', 'END'].includes(m[1]) && !hits.some((h) => h.sym === m[1])) hits.push({ sym: m[1], i: m.index });
  return hits.sort((a, b) => a.i - b.i).map((h) => h.sym);
}
function findDate(text) {
  const t = text.toLowerCase();
  const now = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  let m = t.match(/(?:in|within|over)(?: the next)? (\d+|one|two|three|six|twelve|eighteen) (month|year|week)s?/);
  if (m) {
    const n = { one: 1, two: 2, three: 3, six: 6, twelve: 12, eighteen: 18 }[m[1]] || Number(m[1]);
    const d = new Date(now); if (m[2] === 'month') d.setMonth(d.getMonth() + n); else if (m[2] === 'year') d.setFullYear(d.getFullYear() + n); else d.setDate(d.getDate() + 7 * n);
    return iso(d);
  }
  m = t.match(/(?:end of|by (?:the )?end of) (?:the year|this year|(\d{4}))/);
  if (m) return `${m[1] || now.getFullYear()}-12-31`;
  m = t.match(new RegExp(`(${MONTHS.join('|')})(?: (\\d{4}))?`));
  if (m) {
    const mo = MONTHS.indexOf(m[1]);
    let y = m[2] ? Number(m[2]) : now.getFullYear();
    if (!m[2] && mo <= now.getMonth()) y++;
    return iso(new Date(Date.UTC(y, mo + 1, 0)));
  }
  m = t.match(/\b(20\d\d)\b/);
  if (m) return `${m[1]}-12-31`;
  return null;
}
function findNumber(text) {
  const t = text.toLowerCase();
  const m = t.match(/(\d+(?:\.\d+)?)\s*(%|percent|per cent)/) || t.match(/\$?\s?(\d[\d,]*(?:\.\d+)?)\s*(k|thousand)?/);
  if (m) { let v = Number(String(m[1]).replace(/,/g, '')); if (m[2] === 'k' || m[2] === 'thousand') v *= 1000; return { v, pct: /%|percent/.test(m[2] || '') }; }
  for (const [w, n] of Object.entries(WORDNUM).sort((a, b) => b[0].length - a[0].length)) if (t.includes(`${w} percent`)) return { v: n, pct: true };
  return null;
}

/** Rules for the Builder: returns fields it is fairly sure of. */
function parseBuild(text) {
  const t = text.toLowerCase();
  const syms = findSymbols(text);
  // Numbers inside names ("S&P 500", "Nasdaq 100", "10 year") are not targets.
  let rest = ` ${text} `;
  for (const name of Object.keys(NAMES).sort((a, b) => b.length - a.length)) rest = rest.replace(new RegExp(name.replace(/[&]/g, '\\&'), 'gi'), ' ');
  const num = findNumber(rest);
  const out = { symbol: syms[0] || null, date: findDate(text) };
  if (/\b(beat|beats|outperform|outperforms|do better than)\b/.test(t)) { out.move = 'beat'; out.vs = syms[1] || 'SPY'; out.value = num && num.pct ? num.v : 0; }
  else if (/\b(trail|trails|lag|lags|underperform|underperforms|do worse than)\b/.test(t)) { out.move = 'trail'; out.vs = syms[1] || 'SPY'; out.value = num && num.pct ? num.v : 0; }
  else if (/\b(crash|crashes|fall|falls|drop|drops|decline|declines|correct|bear market)\b/.test(t)) {
    if (num && !num.pct) { out.move = 'touchBelow'; out.value = num.v; }
    else { out.move = /from (its|the) (high|peak)|bear market|crash/.test(t) || !/\blose|loses\b/.test(t) ? 'drawdown' : 'down'; out.value = num ? num.v : /bear market|crash/.test(t) ? 20 : 10; }
  } else if (/\b(rise|rises|rally|rallies|gain|gains|up|climb|climbs|hit|hits|reach|reaches|above|break|breaks)\b/.test(t)) {
    if (num && !num.pct) { out.move = /close|closes|end|ends/.test(t) ? 'above' : 'touchAbove'; out.value = num.v; }
    else { out.move = 'up'; out.value = num ? num.v : 10; }
  }
  return out;
}

/** Claude shapes the words. mode: describe -> { claim, facts }, build -> Builder fields. */
async function tidy(text, mode) {
  const today = new Date().toISOString().slice(0, 10);
  if (mode === 'build') {
    const prompt = `Today is ${today}. Someone said: "${text}"

Map it to a market scenario builder. Fields: symbol (Yahoo Finance ticker: SPY for the S&P 500, QQQ Nasdaq 100, IWM small caps, SMH semiconductors, ^VIX, ^TNX for the 10-year yield, GC=F gold, CL=F oil, BTC-USD), move (one of drawdown = falls from its 52-week high by a percent; down = loses at least a percent; up = gains at least a percent; touchBelow / touchAbove = trades to a price; below / above = closes below/above a price on the deadline; beat / trail = vs another ticker by at least a percent, 0 if none), value (number: percent or price), vs (ticker, only for beat/trail), date (YYYY-MM-DD deadline; if none given use 6 months from today). Reply with ONLY JSON: {"symbol":"","move":"","value":0,"vs":"","date":""}`;
    const r = await askJson({ prompt, system: 'You turn spoken requests into structured fields. Reply with JSON only.', model: 'haiku', tools: [], timeoutMs: 60000 });
    return r.json;
  }
  const prompt = `Someone dictated a market claim and maybe their reasons:

"${text}"

Split it into (1) the claim: one clear sentence about what will happen, with a date if they gave one, and (2) their reasons: the factual statements they gave, one per line, in their words but cleaned of filler. Don't add anything they didn't say. Never use em dashes. Reply with ONLY JSON: {"claim":"","facts":""}`;
  const r = await askJson({ prompt, system: 'You clean up dictated speech without changing its meaning.', model: 'haiku', tools: [], timeoutMs: 60000 });
  return { claim: String(r.json.claim || text).slice(0, 600), facts: String(r.json.facts || '').slice(0, 3000) };
}

module.exports = { parseBuild, tidy, findSymbols, findDate };
