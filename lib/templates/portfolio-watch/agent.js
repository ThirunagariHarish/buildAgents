// Portfolio Watch: tracks your stocks and crypto, alerts on big moves and price
// targets, and sends the daily close. It reports numbers; it never gives advice.

const CRYPTO = { BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', DOGE: 'dogecoin', ADA: 'cardano', XRP: 'ripple' };
const MAX_TRADES = 2000, MAX_HIST = 400, MAX_TARGETS = 50;
const DELAYED = 'Quotes may be delayed.';

// ---------- small helpers ----------
const WD = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
function dayNum(date) { const [y, m, d] = date.split('-').map(Number); return Date.UTC(y, m - 1, d) / 864e5; }
function addDays(date, n) { return new Date((dayNum(date) + n) * 864e5).toISOString().slice(0, 10); }
const num = (s) => Number(String(s).replace(/[,$\s]/g, ''));
function money(n, signed) {
  const a = Math.abs(n);
  const dp = a > 0 && a < 1 ? 4 : 2;
  const [i, f] = a.toFixed(dp).split('.');
  const s = `$${i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${f}`;
  return n < 0 ? `-${s}` : signed ? `+${s}` : s;
}
const pct = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
const qty = (q) => String(Number(q.toFixed(8)));
const isCrypto = (s) => !!CRYPTO[s];
function stooqSym(s) {
  const l = s.toLowerCase();
  return /\.(us|uk|de|jp|hk|pl|hu|fr)$/.test(l) ? l : `${l.replace(/\./g, '-')}.us`;
}

// ---------- positions ----------
function parseHoldings(text) {
  const out = [];
  for (const raw of String(text || '').split(/\n|;/)) {
    const line = raw.trim();
    if (!line) continue;
    let m = line.match(/^([A-Za-z][A-Za-z0-9.\-]{0,11})\s*[:,]?\s+([\d.,]+)\s*(?:(?:@|at|x)\s*)?\$?([\d,]+(?:\.\d+)?)?\s*$/i);
    if (m) { out.push({ s: m[1].toUpperCase(), q: num(m[2]), p: m[3] !== undefined ? num(m[3]) : null }); continue; }
    m = line.match(/^([\d.,]+)\s+([A-Za-z][A-Za-z0-9.\-]{0,11})\s*(?:(?:@|at)\s*)?\$?([\d,]+(?:\.\d+)?)?\s*$/i);
    if (m) out.push({ s: m[2].toUpperCase(), q: num(m[1]), p: m[3] !== undefined ? num(m[3]) : null });
  }
  return out.filter((h) => h.q > 0);
}
/** Holdings from settings, then every trade in order. */
function book(settingsText, ledger) {
  const pos = {}, order = [];
  const add = (s, q, p) => {
    if (!pos[s]) { pos[s] = { q: 0, c: 0, known: true }; order.push(s); }
    pos[s].q += q;
    if (p === null) pos[s].known = false; else pos[s].c += q * p;
  };
  for (const h of parseHoldings(settingsText)) add(h.s, h.q, h.p);
  for (const [s, b] of Object.entries(ledger.base || {})) add(s, b.q, b.c / (b.q || 1));
  let realised = ledger.realised || 0;
  for (const t of ledger.trades || []) {
    if (t.q > 0) add(t.s, t.q, t.p);
    else if (pos[t.s]) {
      const p = pos[t.s], sell = Math.min(-t.q, p.q);
      const avg = p.q ? p.c / p.q : 0;
      p.c -= avg * sell; p.q -= sell;
      if (p.known) realised += (t.p - avg) * sell;
    }
  }
  return { pos, order: order.filter((s) => pos[s].q > 1e-9), realised };
}
async function loadLedger(ctx) {
  return (await ctx.memory.get('ledger')) || { trades: [], base: {}, realised: 0 };
}
function trimLedger(l) {
  while (l.trades.length > MAX_TRADES) {
    const t = l.trades.shift();
    const b = l.base[t.s] || { q: 0, c: 0 };
    if (t.q > 0) { b.q += t.q; b.c += t.q * t.p; } else { const avg = b.q ? b.c / b.q : 0; const sell = Math.min(-t.q, b.q); b.q -= sell; b.c -= avg * sell; l.realised = (l.realised || 0) + (t.p - avg) * sell; }
    l.base[t.s] = b;
  }
  return l;
}

// ---------- quotes ----------
/** Prices for symbols: { quotes: { SYM: { px, open, date } | { px, ch } }, failed: [why] }. */
async function getQuotes(ctx, syms, today) {
  const quotes = {}, failed = [];
  const stocks = syms.filter((s) => !isCrypto(s));
  const coins = syms.filter(isCrypto);
  if (stocks.length) {
    let r;
    try { r = await ctx.http.get(`https://stooq.com/q/l/?s=${stocks.map(stooqSym).join(',')}&f=sd2t2ohlcv&h&e=csv`); } catch (e) { r = { status: 0, text: '' }; }
    if (r.status !== 200) failed.push(`stock quotes (${r.status ? `status ${r.status}` : 'no connection'})`);
    else {
      for (const line of r.text.split(/\r?\n/)) {
        const c = line.split(',').map((x) => x.trim());
        if (c.length < 7 || /^symbol$/i.test(c[0])) continue;
        const s = stocks.find((x) => stooqSym(x).toUpperCase() === c[0].toUpperCase());
        if (!s) continue;
        const px = Number(c[6]), open = Number(c[3]);
        if (c[1] === 'N/D' || !Number.isFinite(px) || px <= 0) continue;
        quotes[s] = { px, open: Number.isFinite(open) && open > 0 ? open : px, date: c[1] };
      }
    }
  }
  if (coins.length) {
    let r;
    try { r = await ctx.http.get(`https://api.coingecko.com/api/v3/simple/price?ids=${coins.map((s) => CRYPTO[s]).join(',')}&vs_currencies=usd&include_24hr_change=true`); } catch (e) { r = { status: 0, text: '' }; }
    let j = null;
    if (r.status === 200) { try { j = JSON.parse(r.text); } catch (e) { j = null; } }
    if (!j || typeof j !== 'object') failed.push(`crypto prices (${r.status === 200 ? 'unreadable answer' : r.status ? `status ${r.status}` : 'no connection'})`);
    else for (const s of coins) {
      const x = j[CRYPTO[s]];
      if (x && Number(x.usd) > 0) quotes[s] = { px: Number(x.usd), ch: Number(x.usd_24h_change) || 0, date: today };
    }
  }
  return { quotes, failed, missing: syms.filter((s) => !quotes[s]) };
}
/** Day change for each quote, against the previous close we remember (crypto: CoinGecko's 24h change). */
function dayChanges(quotes, pc) {
  const out = {};
  let changed = false;
  for (const [s, q] of Object.entries(quotes)) {
    if (q.ch !== undefined) { const base = q.px / (1 + q.ch / 100); out[s] = { px: q.px, base, pct: q.ch, date: q.date, crypto: true }; continue; }
    const prev = pc[s];
    let base, first = false;
    if (!prev) { pc[s] = { d: q.date, c: q.px }; base = q.open; first = true; changed = true; }
    else if (prev.d === q.date) { if (prev.p == null) { base = q.open; first = true; } else base = prev.p; if (prev.c !== q.px) { prev.c = q.px; changed = true; } }
    else if (q.date > prev.d) { pc[s] = { d: q.date, c: q.px, p: prev.c }; base = prev.c; changed = true; }
    else { base = prev.p != null ? prev.p : q.open; first = prev.p == null; }
    out[s] = { px: q.px, base, pct: base ? ((q.px - base) / base) * 100 : 0, date: q.date, first };
  }
  return { ch: out, changed };
}

function summary(b, ch, missing) {
  let value = 0, day = 0, cost = 0, val4cost = 0;
  const rows = [];
  for (const s of b.order) {
    const p = b.pos[s], c = ch[s];
    if (!c) continue;
    const v = p.q * c.px;
    value += v; day += p.q * (c.px - c.base);
    if (p.known) { cost += p.c; val4cost += v; }
    rows.push({ s, v, pct: c.pct, d: p.q * (c.px - c.base), first: c.first });
  }
  const prevValue = value - day;
  const movers = rows.slice().sort((a, x) => Math.abs(x.pct) - Math.abs(a.pct)).slice(0, 3);
  const lines = [
    `Value ${money(value)} · today ${money(day, true)} (${pct(prevValue ? (day / prevValue) * 100 : 0)})`,
  ];
  if (cost > 0) lines.push(`Total P&L ${money(val4cost - cost, true)} (${pct(((val4cost - cost) / cost) * 100)}) on ${money(cost)} cost`);
  if (Math.abs(b.realised) > 0.004) lines.push(`Realised so far ${money(b.realised, true)}`);
  if (movers.length) lines.push(`Movers: ${movers.map((r) => `${r.s} ${pct(r.pct)}`).join(', ')}`);
  const firsts = rows.filter((r) => r.first).map((r) => r.s);
  if (firsts.length) lines.push(`${firsts.join(', ')}: change is vs today's open (first day I see ${firsts.length === 1 ? 'it' : 'them'}).`);
  if (missing.length) lines.push(`No quote for ${missing.join(', ')}.`);
  return { value, day, text: lines.join('\n') };
}

// ---------- runs ----------
async function load(ctx) {
  const ledger = await loadLedger(ctx);
  const b = book(ctx.settings.holdings, ledger);
  return { ledger, b };
}
async function pricesFor(ctx, syms) {
  const today = ctx.local().date;
  const q = await getQuotes(ctx, syms, today);
  const pc = (await ctx.memory.get('pc')) || {};
  const d = dayChanges(q.quotes, pc);
  if (d.changed) await ctx.memory.set('pc', pc);
  return { ...q, ch: d.ch };
}

async function dailyClose(ctx) {
  const loc = ctx.local();
  if ((await ctx.memory.get('lastClose')) === loc.date) return;
  const { b } = await load(ctx);
  if (!b.order.length) { ctx.log('No holdings yet; nothing to report.'); return; }
  await ctx.memory.set('lastClose', loc.date);
  const q = await pricesFor(ctx, b.order);
  if (!Object.keys(q.quotes).length) {
    await ctx.notify({ title: 'Daily close: quotes unavailable', body: `I couldn't get prices today (${q.failed.join('; ') || 'no quotes'}). I'll try again at the next check.` });
    return;
  }
  const s = summary(b, q.ch, q.missing);
  const hist = (await ctx.memory.get('hist')) || [];
  let week = '';
  if (loc.weekday === 'fri') {
    const monday = addDays(loc.date, -4);
    const before = hist.filter((h) => h.d < monday).pop();
    const ref = before || hist.find((h) => h.d >= monday && h.d < loc.date);
    if (ref) week = `\nThis week: ${money(s.value - ref.v, true)} (${pct(ref.v ? ((s.value - ref.v) / ref.v) * 100 : 0)}) vs ${before ? 'last Friday' : `${ref.d}`}.`;
  }
  const next = hist.filter((h) => h.d !== loc.date).concat([{ d: loc.date, v: Math.round(s.value * 100) / 100 }]).slice(-MAX_HIST);
  await ctx.memory.set('hist', next);
  await ctx.notify({
    title: `📈 Close: ${money(s.value)} (${money(s.day, true)})`,
    body: `${s.text}${week}\n${DELAYED}`,
  });
}

async function check(ctx) {
  const loc = ctx.local();
  const { b } = await load(ctx);
  const targets = (await ctx.memory.get('targets')) || [];
  const live = targets.filter((t) => !t.hit);
  const syms = [...new Set([...b.order, ...live.map((t) => t.s)])];
  if (!syms.length) return;
  const q = await pricesFor(ctx, syms);
  if (!Object.keys(q.quotes).length) { ctx.log(`No quotes this check: ${q.failed.join('; ')}`); return; }
  const limit = Number(ctx.settings.movePct) > 0 ? Number(ctx.settings.movePct) : 5;
  const alerted = (await ctx.memory.get('alerted')) || {};
  const big = [];
  for (const s of b.order) {
    const c = q.ch[s];
    if (!c || Math.abs(c.pct) < limit) continue;
    const key = c.crypto ? loc.date : c.date;
    if (alerted[s] === key) continue;
    alerted[s] = key;
    big.push(`${s} ${pct(c.pct)} at ${money(c.px)} (${money(b.pos[s].q * (c.px - c.base), true)} on your ${qty(b.pos[s].q)})`);
  }
  if (big.length) {
    await ctx.memory.set('alerted', alerted);
    await ctx.notify({ title: `${big.length === 1 ? big[0].split(' at ')[0] : `${big.length} big moves`} today`, body: `${big.join('\n')}\nYour alert level: ${limit}%. ${DELAYED}` });
  }
  let hitAny = false;
  for (const t of live) {
    const c = q.ch[t.s];
    if (!c) continue;
    if ((t.dir === 'above' && c.px >= t.p) || (t.dir === 'below' && c.px <= t.p)) {
      t.hit = loc.date; hitAny = true;
      await ctx.notify({ title: `🎯 ${t.s} ${t.dir === 'above' ? 'reached' : 'fell to'} ${money(c.px)}`, body: `Your alert: ${t.s} ${t.dir} ${money(t.p)}. It's at ${money(c.px)} (${pct(c.pct)} today). This alert is now done. ${DELAYED}` });
    }
  }
  if (hitAny) await ctx.memory.set('targets', targets);
}

const HELP = `I track your stocks and crypto, send the close at 4:30 PM on weekdays and alert you on big moves and price targets. Say:
• "portfolio" or "how am I doing"
• "how's aapl"
• "bought 5 msft at 410" / "sold 2 aapl at 190"
• "target nvda 150" or "alert tsla below 200"
• "targets" / "remove target 1"
Crypto I know: ${Object.keys(CRYPTO).join(', ')}. I report numbers, never investment advice. ${DELAYED}`;

async function onMessage(ctx) {
  const raw = String(ctx.input.text || '').trim();
  const t = raw.toLowerCase().replace(/\s+/g, ' ').replace(/[!.]+$/, '');
  const today = ctx.local().date;
  let m;
  if (!t || /^(help|\?|what can you do|commands|hi|hello)\b/.test(t)) return ctx.reply(HELP);

  if (/\b(should i|advice|advise|recommend|worth buying|good buy|good time to|what to buy|what should)\b/.test(t)) {
    return ctx.reply(`I can't give investment advice: I only track prices and your own numbers. Ask "how's aapl" for the latest price and your position, or "portfolio" for the totals. ${DELAYED}`);
  }

  if (/^(portfolio|how am i doing|how are we doing|summary|total|value|p&l|pnl|my portfolio|status)\b/.test(t)) {
    const { b } = await load(ctx);
    if (!b.order.length) return ctx.reply('You have no holdings yet. Add them in Settings ("AAPL 10 @ 182.50", one per line) or tell me "bought 5 msft at 410".');
    const q = await pricesFor(ctx, b.order);
    if (!Object.keys(q.quotes).length) return ctx.reply(`I couldn't get prices right now (${q.failed.join('; ')}). Try again in a few minutes.`);
    const s = summary(b, q.ch, q.missing);
    const lines = b.order.filter((x) => q.ch[x]).map((x) => { const p = b.pos[x], c = q.ch[x]; return `${x} ${qty(p.q)} × ${money(c.px)} = ${money(p.q * c.px)} (${pct(c.pct)})${p.known ? ` · P&L ${money(p.q * c.px - p.c, true)}` : ''}`; });
    return ctx.reply(`${s.text}\n\n${lines.join('\n')}\n${DELAYED}`);
  }

  if ((m = t.match(/^(?:i\s+)?(bought|buy|added|sold|sell)\s+([\d.,]+)\s+(?:shares?\s+(?:of\s+)?|units?\s+(?:of\s+)?)?([a-z][a-z0-9.\-]{0,11})(?:\s+(at|@|for)\s*\$?([\d,]+(?:\.\d+)?))?$/))) {
    const sell = /^s/.test(m[1]);
    const s = m[3].toUpperCase();
    const q = num(m[2]);
    if (!(q > 0)) return ctx.reply(`How many? For example "${sell ? 'sold' : 'bought'} 5 ${m[3]} at 410".`);
    if (!m[5]) return ctx.reply(`At what price? For example "${sell ? 'sold' : 'bought'} ${qty(q)} ${m[3]} at 410".`);
    const p = m[4] === 'for' ? num(m[5]) / q : num(m[5]);
    const ledger = await loadLedger(ctx);
    const before = book(ctx.settings.holdings, ledger);
    const held = before.pos[s] ? before.pos[s].q : 0;
    if (sell) {
      if (held + 1e-9 < q) return ctx.reply(`You hold ${qty(held)} ${s}, so I can't record selling ${qty(q)}. If you had more, add it first: "bought ${qty(q - held)} ${m[3]} at <price>".`);
      const pos = before.pos[s];
      const avg = pos.q ? pos.c / pos.q : 0;
      ledger.trades.push({ s, q: -q, p, d: today });
      await ctx.memory.set('ledger', trimLedger(ledger));
      const left = held - q;
      if (!pos.known) return ctx.reply(`Recorded: sold ${qty(q)} ${s} at ${money(p)} = ${money(q * p)}. I don't know what you paid, so no gain figure. You now hold ${qty(left)} ${s}.`);
      const gain = (p - avg) * q;
      return ctx.reply(`Recorded: sold ${qty(q)} ${s} at ${money(p)} = ${money(q * p)}. Realised ${gain >= 0 ? 'gain' : 'loss'} ${money(gain, true)} (avg cost ${money(avg)}). You now hold ${qty(left)} ${s}.`);
    }
    ledger.trades.push({ s, q, p, d: today });
    await ctx.memory.set('ledger', trimLedger(ledger));
    const after = book(ctx.settings.holdings, ledger).pos[s];
    return ctx.reply(`Recorded: bought ${qty(q)} ${s} at ${money(p)} = ${money(q * p)}. You now hold ${qty(after.q)} ${s}${after.known ? ` at an average ${money(after.c / after.q)}` : ''}.`);
  }

  if ((m = t.match(/^(?:set\s+(?:a\s+)?)?(?:price\s+)?(?:target|alert)(?:\s+me)?(?:\s+(?:when|if|for|on))?\s+([a-z][a-z0-9.\-]{0,11})\s+(?:(?:is|goes|gets|drops|falls|rises|hits|reaches)\s+)?(?:(above|over|below|under|at|to|>|<)\s+)?\$?([\d,]+(?:\.\d+)?)$/))) {
    const s = m[1].toUpperCase();
    const p = num(m[3]);
    let dir = { above: 'above', over: 'above', '>': 'above', below: 'below', under: 'below', '<': 'below' }[m[2]] || null;
    if (/\b(drops|falls)\b/.test(t)) dir = 'below';
    if (/\b(rises)\b/.test(t)) dir = 'above';
    const targets = (await ctx.memory.get('targets')) || [];
    if (targets.filter((x) => !x.hit).length >= MAX_TARGETS) return ctx.reply(`You have ${MAX_TARGETS} alerts already. Remove one with "remove target 1".`);
    const q = await pricesFor(ctx, [s]);
    const c = q.ch[s];
    if (!dir) dir = c && c.px > p ? 'below' : 'above';
    if (c && ((dir === 'above' && c.px >= p) || (dir === 'below' && c.px <= p))) return ctx.reply(`${s} is already at ${money(c.px)}, ${dir} ${money(p)}. Pick a level it hasn't reached yet. ${DELAYED}`);
    targets.push({ s, p, dir, d: today });
    await ctx.memory.set('targets', targets);
    const now = c ? `${s} is ${money(c.px)} now. ` : q.missing.length ? `I couldn't get a price for ${s} just now; I'll keep trying. ` : '';
    return ctx.reply(`${now}I'll tell you once when ${s} ${dir === 'above' ? 'rises to' : 'drops to'} ${money(p)} or ${dir === 'above' ? 'higher' : 'lower'}. Alert #${targets.filter((x) => !x.hit).length}.`);
  }

  if (/^(targets|alerts|my targets|my alerts|price alerts)$/.test(t)) {
    const targets = ((await ctx.memory.get('targets')) || []).filter((x) => !x.hit);
    if (!targets.length) return ctx.reply('No price alerts set. Try "target nvda 150" or "alert tsla below 200".');
    return ctx.reply(`Your price alerts:\n${targets.map((x, i) => `${i + 1}. ${x.s} ${x.dir} ${money(x.p)} (set ${x.d})`).join('\n')}\nRemove one with "remove target 1".`);
  }

  if ((m = t.match(/^(?:remove|delete|cancel|drop)\s+(?:target|alert)\s*#?(\d+)$/))) {
    const targets = (await ctx.memory.get('targets')) || [];
    const live = targets.filter((x) => !x.hit);
    const x = live[Number(m[1]) - 1];
    if (!x) return ctx.reply(`There's no alert #${m[1]}. ${live.length ? `You have ${live.length}; say "targets" to see them.` : 'You have none.'}`);
    targets.splice(targets.indexOf(x), 1);
    await ctx.memory.set('targets', targets);
    return ctx.reply(`Removed alert #${m[1]}: ${x.s} ${x.dir} ${money(x.p)}. ${live.length - 1} left.`);
  }

  if ((m = t.match(/^(?:how'?s|how is|hows|how's|price(?: of)?|quote|check|what'?s)\s+([a-z][a-z0-9.\-]{0,11})(?: doing| at| trading)?\??$/)) || (m = t.match(/^([a-z][a-z0-9.\-]{0,11})\s*\?$/))) {
    const s = m[1].toUpperCase();
    const { b } = await load(ctx);
    const q = await pricesFor(ctx, [s]);
    const c = q.ch[s];
    if (!c) return ctx.reply(q.failed.length ? `I couldn't get a price for ${s} right now (${q.failed.join('; ')}). Try again shortly.` : `I couldn't find a quote for ${s}. Stocks use their US ticker (AAPL); crypto I know: ${Object.keys(CRYPTO).join(', ')}.`);
    const p = b.pos[s];
    let mine = '';
    if (p && p.q > 0) {
      mine = ` You hold ${qty(p.q)} = ${money(p.q * c.px)}, today ${money(p.q * (c.px - c.base), true)}`;
      if (p.known && p.c > 0) mine += `, P&L ${money(p.q * c.px - p.c, true)} (${pct(((p.q * c.px - p.c) / p.c) * 100)}) vs avg ${money(p.c / p.q)}`;
      mine += '.';
    }
    const vs = c.crypto ? 'over 24h' : c.first ? "vs today's open" : 'vs previous close';
    return ctx.reply(`${s} ${money(c.px)}, ${pct(c.pct)} ${vs}${c.crypto ? '' : ` (${c.date})`}.${mine} ${DELAYED}`);
  }

  return ctx.reply(`I didn't catch that ("${raw.slice(0, 60)}"). I track prices and your holdings. Try "portfolio", "how's aapl", "bought 5 msft at 410", "target nvda 150" or "help".`);
}

async function run(ctx) {
  const type = ctx.trigger.type;
  if (type === 'message') return onMessage(ctx);
  if (type === 'schedule') return dailyClose(ctx);
  return check(ctx);
}
