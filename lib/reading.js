// The reading room: each run gathers the day's articles about the scenario
// (Google News, Yahoo Finance, Seeking Alpha, the Fed, plus the sources the
// research analyst cited) and sorts them into "supports the claim", "against
// it" and "context", with one line on why. Claude does the sorting when the
// scenario runs with Claude; otherwise a finance sentiment model and the
// claim's direction do it (marked as auto-sorted).

const store = require('./store');
const sentiment = require('./sentiment');
const { overlap } = require('./free');
const { askJson } = require('./claude');
const { MODEL_FAST } = require('./config');

const DAY = 86400000;
const KEEP_DAYS = 120;
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const nodash = (s) => String(s || '').replace(/(\d)\s*[–—]\s*(\d)/g, '$1-$2').replace(/\s*[—–]\s*/g, ', ');
const keyOf = (u) => { try { const x = new URL(u); return `${x.hostname.replace(/^www\./, '')}${x.pathname}`.replace(/\/$/, '').toLowerCase(); } catch { return String(u || '').toLowerCase(); } };
const safeUrl = (u) => (/^https?:\/\/[^\s"<>]+$/.test(String(u || '')) ? String(u).slice(0, 600) : null);

/** Candidate articles from this run's data, newest first, de-duplicated. */
function candidates(d, analysts, th = { direction: 'up' }) {
  const out = [];
  const add = (title, url, source, at, extra = {}) => {
    url = safeUrl(url);
    title = clean(title);
    if (!url || title.length < 12) return;
    // Google News titles end in " - Source".
    const m = title.match(/^(.*) - ([^-]{2,60})$/);
    if (m && !extra.keepTitle) { title = m[1]; source = source && source !== 'news' ? source : m[2]; }
    out.push({ title: title.slice(0, 240), url, source: clean(source).slice(0, 60) || new URL(url).hostname.replace(/^www\./, ''), at: at || null, ...extra });
  };
  const s = d.social || {};
  for (const p of (s.news && s.news.posts) || []) add(p.text, p.url, p.where, p.at);
  for (const t of s.tickerNews || []) for (const p of t.posts) add(p.text, p.url, p.where, p.at);
  for (const p of (s.fed && s.fed.posts) || []) add(p.text, p.url, 'Federal Reserve', p.at);
  // What the research analyst found and cited, already sorted by Claude.
  const r = analysts.find((a) => a.id === 'research');
  for (const p of (r && r.points) || []) if (p.url) add(p.text, p.url, p.source, p.date ? Date.parse(p.date) : null, { stance: p.for === true ? 'for' : p.for === false ? 'against' : 'context', why: '', by: 'research', keepTitle: true });
  const soc = analysts.find((a) => a.id === 'social');
  // Social quotes carry a price lean (+ bullish); turn it into a lean on the claim.
  const sign = th.direction === 'up' ? 1 : -1;
  for (const q of (soc && soc.quotes) || []) if (q.url) add(q.text, q.url, q.where, null, { stance: q.s * sign > 0 ? 'for' : q.s * sign < 0 ? 'against' : 'context', why: 'What people are posting.', by: 'social', kind: 'social', keepTitle: true });
  const seen = new Set();
  return out.filter((x) => { const k = keyOf(x.url); const t = x.title.toLowerCase().slice(0, 60); if (seen.has(k) || seen.has(t)) return false; seen.add(k); seen.add(t); return true; })
    .filter((x) => !x.at || Date.now() - x.at < 10 * DAY)
    .sort((a, b) => (b.at || 0) - (a.at || 0));
}

/** Claude sorts the headlines against the proposition. */
async function sortWithClaude(th, items) {
  const list = items.map((x, i) => `${i + 1}. ${x.title} (${x.source}${x.at ? `, ${new Date(x.at).toISOString().slice(0, 10)}` : ''})`).join('\n');
  const prompt = `PROPOSITION: ${th.proposition}
(YES is ${th.direction === 'up' ? 'good' : 'bad'} for ${th.primary}.)

Today's headlines:
${list}

For each headline, decide what it does to the proposition:
- "for": the news makes YES more likely
- "against": it makes YES less likely
- "context": relevant background that doesn't push either way
- "skip": not about this at all

Give one short reason (12 words max) naming the mechanism, e.g. "Higher capex guidance supports chip demand". Judge the news, not the headline's tone. Reply with ONLY JSON: {"items":[{"i":1,"stance":"for","why":"..."}]}`;
  const r = await askJson({ prompt, system: 'You sort financial news for an independent research desk. You are neutral: you do not know which outcome the reader hopes for. Never use em dashes.', model: MODEL_FAST, tools: [], timeoutMs: 3 * 60 * 1000 });
  const byI = new Map((r.json.items || []).map((x) => [Number(x.i), x]));
  return { costUsd: r.costUsd, sorted: items.map((x, i) => { const v = byI.get(i + 1); return v ? { ...x, stance: ['for', 'against', 'context', 'skip'].includes(v.stance) ? v.stance : 'context', why: nodash(clean(v.why)).slice(0, 140), by: 'claude' } : null; }).filter(Boolean) };
}

/** Without Claude: relevance by shared words, lean by finance sentiment times the claim's direction. */
async function sortAuto(th, items) {
  const scored = await sentiment.scorePosts(items.map((x) => ({ text: x.title })));
  const q = [th.primary, ...(th.keywords || []), th.newsQuery].filter(Boolean).join(' ');
  const sign = th.direction === 'up' ? 1 : -1;
  return items.map((x, i) => {
    const s = scored.posts[i].s;
    const rel = Math.max(overlap(q, x.title), x.title.toUpperCase().includes(th.primary) ? 0.5 : 0);
    if (rel < 0.2) return { ...x, stance: 'skip' };
    const lean = s * sign;
    return { ...x, stance: lean > 0.25 ? 'for' : lean < -0.25 ? 'against' : 'context', why: lean > 0.25 ? 'Reads positive for the claim (auto-sorted).' : lean < -0.25 ? 'Reads negative for the claim (auto-sorted).' : 'Related news (auto-sorted).', by: 'auto' };
  });
}

/** Sort this run's articles and add the new ones to the scenario's library. Returns { added, counts, costUsd }. */
async function update(sc, th, d, analysts, { ai }) {
  const lib = store.loadReading(sc.id);
  const cands = candidates(d, analysts, th);
  const fresh = cands.filter((x) => !lib.items[keyOf(x.url)]);
  const presorted = fresh.filter((x) => x.stance);
  let toSort = fresh.filter((x) => !x.stance).slice(0, 45);
  let costUsd = 0, sorted = [];
  if (toSort.length) {
    if (ai) {
      try { const r = await sortWithClaude(th, toSort); sorted = r.sorted; costUsd = r.costUsd; } catch { sorted = await sortAuto(th, toSort); }
    } else sorted = await sortAuto(th, toSort);
  }
  const today = new Date().toISOString().slice(0, 10);
  let added = 0;
  for (const x of [...presorted, ...sorted]) {
    if (x.stance === 'skip') continue;
    const { keepTitle, ...rest } = x;
    lib.items[keyOf(x.url)] = { ...rest, firstSeen: today, seenAt: Date.now() };
    added++;
  }
  // Keep the library bounded.
  const cutoff = Date.now() - KEEP_DAYS * DAY;
  for (const [k, v] of Object.entries(lib.items)) if (v.seenAt < cutoff && !Object.values(lib.state).some((st) => st[k] && st[k].saved)) delete lib.items[k];
  store.saveReading(sc.id, lib);
  const todays = Object.values(lib.items).filter((x) => x.firstSeen === today);
  return { added, costUsd, counts: { for: todays.filter((x) => x.stance === 'for').length, against: todays.filter((x) => x.stance === 'against').length, context: todays.filter((x) => x.stance === 'context').length } };
}

/** The room for one person: articles grouped by the day they arrived, with their marks. */
function view(scId, userId, { limitDays = 30 } = {}) {
  const lib = store.loadReading(scId);
  const mine = lib.state[userId] || {};
  const items = Object.entries(lib.items).map(([k, v]) => ({ ...v, key: k, read: !!(mine[k] && mine[k].read), saved: !!(mine[k] && mine[k].saved) }))
    .sort((a, b) => b.firstSeen.localeCompare(a.firstSeen) || (b.at || b.seenAt) - (a.at || a.seenAt));
  const days = [];
  for (const it of items) {
    let g = days[days.length - 1];
    if (!g || g.date !== it.firstSeen) { if (days.length >= limitDays) break; g = { date: it.firstSeen, items: [] }; days.push(g); }
    g.items.push(it);
  }
  const unread = items.filter((x) => !x.read).length;
  return { days, unread, total: items.length, saved: items.filter((x) => x.saved) };
}
function unreadCount(scId, userId) {
  const lib = store.loadReading(scId);
  const mine = lib.state[userId] || {};
  return Object.keys(lib.items).filter((k) => !(mine[k] && mine[k].read)).length;
}
function mark(scId, userId, key, patch) {
  const lib = store.loadReading(scId);
  if (key !== '*' && !lib.items[key]) return false;
  lib.state[userId] = lib.state[userId] || {};
  const keys = key === '*' ? Object.keys(lib.items) : [key];
  for (const k of keys) lib.state[userId][k] = { ...(lib.state[userId][k] || {}), ...patch };
  store.saveReading(scId, lib);
  return true;
}

module.exports = { update, view, unreadCount, mark, candidates, sortAuto, keyOf };
