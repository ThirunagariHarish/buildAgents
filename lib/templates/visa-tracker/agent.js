// Green Card Tracker: reads the US Visa Bulletin (travel.state.gov), picks out
// the owner's row (category) and column (country) on both charts, and tells
// them where their priority date stands. Talk to it: status, history, eta,
// "my date 2014-03-15", "category eb3", "country india", "check now", help.

const HOST = 'https://travel.state.gov';
const INDEX = HOST + '/content/travel/en/legal/visa-law0/visa-bulletin.html';
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MON3 = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const CATS = ['EB1', 'EB2', 'EB3', 'EW', 'EB4', 'EB5', 'F1', 'F2A', 'F2B', 'F3', 'F4'];
const CAT_NAME = { EW: 'EB3 Other Workers' };
const COUNTRIES = ['All', 'China', 'India', 'Mexico', 'Philippines'];
const COUNTRY_NAME = { All: 'All Chargeability' };
const KEEP = 24;        // bulletins kept in memory
const BACKFILL = 3;     // earlier bulletins read on the very first check

async function run(ctx) {
  const t = ctx.trigger.type;
  const st = {
    hist: (await ctx.memory.get('hist')) || [],
    prefs: (await ctx.memory.get('prefs')) || {},
  };
  const me = who(ctx, st.prefs);
  if (t === 'message') return onMessage(ctx, st, me);
  return onCheck(ctx, st, me);
}

// ---------- the owner's choices (settings, overridden by chat) ----------

function who(ctx, prefs) {
  const s = ctx.settings || {};
  const sCat = normCat(s.category) || 'EB2';
  const sCty = normCountry(s.country) || 'All';
  const sPd = parsePd(String(s.priorityDate || ''));
  const b = prefs.b || {};
  // A value said in chat wins until the owner changes that setting in the Studio.
  const pick = (k, sv) => (prefs[k] !== undefined && b[k] === sv ? prefs[k] : sv);
  return { cat: pick('cat', sCat), cty: pick('cty', sCty), pd: pick('pd', sPd), base: { cat: sCat, cty: sCty, pd: sPd } };
}

async function savePref(ctx, st, me, k, v) {
  const p = {};
  for (const x of Object.keys(st.prefs)) if (x !== 'b') p[x] = st.prefs[x];
  p[k] = v;
  p.b = { ...(st.prefs.b || {}), [k]: me.base[k] };
  st.prefs = p; me[k] = v;
  await ctx.memory.set('prefs', p);
}

function normCat(x) {
  const s = String(x || '').toUpperCase().replace(/[\s._-]+/g, '');
  if (!s) return null;
  if (/^(EW|OTHERWORKERS?|EB3OW|EB3OTHER(WORKERS?)?|EB3EW|UNSKILLED)$/.test(s)) return 'EW';
  let m = s.match(/^(?:EB|E)([1-5])$/) || s.match(/^([1-5])(?:ST|ND|RD|TH)(?:PREF(?:ERENCE)?)?$/);
  if (m) return 'EB' + m[1];
  m = s.match(/^F(1|2A|2B|3|4)$/) || s.match(/^FB?(1|2A|2B|3|4)$/);
  if (m) return 'F' + m[1];
  return null;
}

function normCountry(x) {
  const s = String(x || '').toLowerCase().trim();
  if (!s) return null;
  if (/\bindia/.test(s)) return 'India';
  if (/\bchina|\bprc\b|chinese/.test(s)) return 'China';
  if (/\bmexic/.test(s)) return 'Mexico';
  if (/\bphilippine|\bfilipin/.test(s)) return 'Philippines';
  if (/^(all|row|rest of (the )?world|everyone else|other|others|worldwide|all chargeability.*|any)$/.test(s)) return 'All';
  return null;
}

/** A priority date in almost any form → "YYYY-MM-DD", or null. */
function parsePd(s) {
  const t = String(s || '').trim();
  let m = t.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = t.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (m) return iso(+m[3], +m[1], +m[2]);
  m = t.match(/\b(\d{1,2})[\s-]*([a-z]{3})[a-z]*\.?[\s-]*,?\s*(\d{4}|\d{2})\b/i);
  if (m && MON3.includes(m[2].toUpperCase())) return iso(year(m[3]), MON3.indexOf(m[2].toUpperCase()) + 1, +m[1]);
  m = t.match(/\b([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i);
  if (m && MON3.includes(m[1].toUpperCase())) return iso(+m[3], MON3.indexOf(m[1].toUpperCase()) + 1, +m[2]);
  return null;
}
function year(y) { const n = Number(y); return String(y).length === 4 ? n : (n > 60 ? 1900 + n : 2000 + n); }
function iso(y, mo, d) {
  if (!(y > 1900 && y < 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// ---------- reading travel.state.gov ----------

function htmlText(h) {
  return String(h || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&ndash;|&#8211;|&mdash;|&#8212;/gi, '-')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&rsquo;|&#8217;/gi, "'")
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}

/** Monthly bulletin links on the index page, newest first. */
function parseIndex(html) {
  const seen = {}, out = [];
  const re = /href\s*=\s*["']([^"']*visa-bulletin-for-([a-z]+)-(\d{4})\.html)["']/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const mo = MONTHS.indexOf(m[2].toLowerCase());
    if (mo < 0) continue;
    const key = `${m[3]}-${String(mo + 1).padStart(2, '0')}`;
    if (seen[key]) continue;
    let url = m[1].replace(/&amp;/g, '&');
    if (/^\/\//.test(url)) url = 'https:' + url;
    else if (/^\//.test(url)) url = HOST + url;
    else if (/^http:/i.test(url)) url = url.replace(/^http:/i, 'https:');
    else if (!/^https:/i.test(url)) url = HOST + '/content/travel/en/legal/visa-law0/' + url.replace(/^\.\//, '');
    if (!/^https:\/\/travel\.state\.gov\//i.test(url)) continue;
    seen[key] = 1;
    out.push({ m: key, url });
  }
  return out.sort((a, b) => (a.m < b.m ? 1 : -1));
}

function rowCat(label) {
  const s = label.toLowerCase();
  if (/^1st\b/.test(s)) return 'EB1';
  if (/^2nd\b/.test(s)) return 'EB2';
  if (/^3rd\b/.test(s)) return 'EB3';
  if (/^other workers/.test(s)) return 'EW';
  if (/^4th\b/.test(s)) return 'EB4';
  if (/^5th\b/.test(s) && /unreserved/.test(s)) return 'EB5';
  const m = s.match(/^f\s*(1|2a|2b|3|4)\b/);
  return m ? 'F' + m[1].toUpperCase() : null;
}

function colCountry(label) {
  const s = label.toLowerCase();
  if (/chargeability|all countries|except those listed/.test(s)) return 'All';
  if (/china/.test(s)) return 'China';
  if (/india/.test(s)) return 'India';
  if (/mexico/.test(s)) return 'Mexico';
  if (/philippines/.test(s)) return 'Philippines';
  return null;
}

function cellValue(s) {
  const v = s.toUpperCase().replace(/\s+/g, '');
  if (/^\d{2}[A-Z]{3}\d{2}$/.test(v) || v === 'C' || v === 'U') return v;
  return v.slice(0, 12) || '?';
}

/** The family and employment charts of one bulletin: { fa: {EB2: [All, China, India, Mexico, Philippines]}, df: {...} }. */
function parseBulletin(html) {
  const src = String(html || '');
  const out = { fa: {}, df: {} };
  const order = { F: 0, E: 0 };
  const tre = /<table\b[\s\S]*?<\/table>/gi;
  let m, prevEnd = 0, found = 0;
  while ((m = tre.exec(src))) {
    const before = htmlText(src.slice(prevEnd, m.index));
    prevEnd = m.index + m[0].length;
    const rows = [];
    const rre = /<tr\b[\s\S]*?<\/tr>/gi;
    let r;
    while ((r = rre.exec(m[0]))) {
      const cells = [];
      const cre = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let c;
      while ((c = cre.exec(r[0]))) cells.push(htmlText(c[1]));
      if (cells.length) rows.push(cells);
    }
    if (rows.length < 2) continue;
    let h = 0;
    if (rows[0].length === 1 && rows[1]) h = 1;
    const head = rows[h];
    const kind = /family/i.test(head[0]) ? 'F' : /employment/i.test(head[0]) ? 'E' : null;
    if (!kind) continue;
    const cols = head.map(colCountry);
    if (!cols.includes('All')) continue;
    // Which chart: the last "A. FINAL ACTION DATES" / "B. DATES FOR FILING" heading before the table, else the order.
    let heads = [...before.matchAll(/\b[AB]\.\s*(FINAL ACTION DATES|DATES FOR FILING)\b/gi)];
    if (!heads.length) heads = [...before.matchAll(/\b(FINAL ACTION DATES|DATES FOR FILING)\b/gi)];
    let chart = heads.length ? (/FILING/i.test(heads[heads.length - 1][1]) ? 'df' : 'fa') : (order[kind] === 0 ? 'fa' : 'df');
    order[kind] += 1;
    if (Object.keys(out[chart]).some((k) => (kind === 'F') === k.startsWith('F'))) chart = chart === 'fa' ? 'df' : 'fa';
    for (const row of rows.slice(h + 1)) {
      const cat = rowCat(row[0] || '');
      if (!cat || out[chart][cat]) continue;
      const vals = COUNTRIES.map((cty) => { const i = cols.indexOf(cty); return i > 0 && row[i] !== undefined ? cellValue(row[i]) : '?'; });
      out[chart][cat] = vals;
      found += 1;
    }
  }
  return found ? out : null;
}

/** Look for a new bulletin. Returns { ok, why, entry, prev, latest, added }. */
async function check(ctx, st) {
  let r;
  try { r = await ctx.http.get(INDEX); } catch (e) { r = { status: 0, text: '' }; }
  if (r.status !== 200) return { ok: false, why: `The Visa Bulletin page didn't answer (${r.status ? 'HTTP ' + r.status : 'no connection'}).` };
  const links = parseIndex(r.text);
  if (!links.length) return { ok: false, why: 'The Visa Bulletin page loaded, but I found no monthly bulletins on it; the site may have changed.' };
  const latest = links[0];
  let added = 0;
  if (!st.hist.some((h) => h.m === latest.m)) {
    let b;
    try { b = await ctx.http.get(latest.url); } catch (e) { b = { status: 0, text: '' }; }
    if (b.status !== 200) return { ok: false, why: `The ${label(latest.m)} bulletin didn't load (${b.status ? 'HTTP ' + b.status : 'no connection'}).` };
    const p = parseBulletin(b.text);
    if (!p) return { ok: false, why: `I couldn't find the date charts in the ${label(latest.m)} bulletin; the page layout may have changed.` };
    const first = !st.hist.length;
    st.hist.push({ m: latest.m, u: latest.url, fa: p.fa, df: p.df });
    added += 1;
    if (first) {
      for (const l of links.slice(1, 1 + BACKFILL)) {
        let o;
        try { o = await ctx.http.get(l.url); } catch (e) { o = null; }
        const q = o && o.status === 200 ? parseBulletin(o.text) : null;
        if (q) { st.hist.push({ m: l.m, u: l.url, fa: q.fa, df: q.df }); added += 1; }
      }
    }
    st.hist.sort((a, b) => (a.m < b.m ? -1 : 1));
    st.hist = st.hist.slice(-KEEP);
    await ctx.memory.set('hist', st.hist);
  }
  const i = st.hist.findIndex((h) => h.m === latest.m);
  return { ok: true, latest, entry: st.hist[i], prev: i > 0 ? st.hist[i - 1] : null, added };
}

// ---------- reading a chart for the owner ----------

function label(m) { const [y, mo] = m.split('-'); const n = MONTHS[+mo - 1]; return `${n[0].toUpperCase()}${n.slice(1)} ${y}`; }
function shortLabel(m) { const [y, mo] = m.split('-'); return `${MON3[+mo - 1][0]}${MON3[+mo - 1].slice(1).toLowerCase()} ${y}`; }
function isDate(v) { return /^\d{2}[A-Z]{3}\d{2}$/.test(v || ''); }
function cellIso(v) { return iso(year(v.slice(5)), MON3.indexOf(v.slice(2, 5)) + 1, +v.slice(0, 2)); }
function vb(isoDate) { const [y, mo, d] = isoDate.split('-'); return `${d}${MON3[+mo - 1]}${y.slice(2)}`; }
function monthsBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number);
  return Math.round(((y2 - y1) * 12 + (m2 - m1) + (d2 - d1) / 30) * 10) / 10;
}
function n1(x) { const v = Math.round(Math.abs(x) * 10) / 10; return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)} month${v === 1 ? '' : 's'}`; }
function catName(c) { return CAT_NAME[c] || c; }
function ctyName(c) { return COUNTRY_NAME[c] || c; }
function cell(entry, chart, me) {
  const row = entry && entry[chart] && entry[chart][me.cat];
  return row ? row[COUNTRIES.indexOf(me.cty)] : null;
}

function moved(prev, cur) {
  if (!prev || !cur || prev === '?' || cur === '?') return '';
  if (cur === 'C') return prev === 'C' ? 'still Current' : 'now Current';
  if (cur === 'U') return prev === 'U' ? 'still unavailable' : 'now unavailable';
  if (!isDate(prev)) return prev === 'C' ? 'was Current last month' : 'was unavailable last month';
  const d = monthsBetween(cellIso(prev), cellIso(cur));
  if (d > 0) return `moved ${n1(d)}`;
  if (d < 0) return `went back ${n1(d)}, retrogression`;
  return 'no movement';
}
function show(v) { return v === 'C' ? 'Current' : v === 'U' ? 'Unavailable' : v || 'not listed'; }

/** Where a priority date stands against one cutoff. */
function standing(v, pd) {
  if (!pd || !v) return null;
  if (v === 'C') return { cur: true, txt: 'current' };
  if (v === 'U') return { cur: false, txt: 'unavailable this month' };
  if (!isDate(v)) return null;
  const c = cellIso(v);
  if (pd < c) return { cur: true, txt: 'current' };
  return { cur: false, gap: monthsBetween(c, pd), txt: `${n1(monthsBetween(c, pd))} away` };
}

/** The monthly message: "November 2026 bulletin: EB2 India Final Action 01JAN13 (moved 3 months). ..." */
function summary(entry, prev, me) {
  const fa = cell(entry, 'fa', me), df = cell(entry, 'df', me);
  if (!fa && !df) return `The ${label(entry.m)} bulletin has no ${catName(me.cat)} row for ${ctyName(me.cty)}.`;
  const mvFa = moved(cell(prev, 'fa', me), fa), mvDf = moved(cell(prev, 'df', me), df);
  let s = `${label(entry.m)} bulletin: ${catName(me.cat)} ${ctyName(me.cty)} Final Action ${show(fa)}${mvFa ? ` (${mvFa})` : ''}.`;
  const sFa = standing(fa, me.pd), sDf = standing(df, me.pd);
  if (!me.pd) {
    s += ` Dates for Filing ${show(df)}${mvDf ? ` (${mvDf})` : ''}. Tell me your priority date ("my date 2014-03-15") and I'll say how far you are.`;
    return s;
  }
  const mine = vb(me.pd);
  if (sFa && sFa.cur) s += ` Your date ${mine} is CURRENT for Final Action: a green card can be approved this month if the rest of the case is ready.`;
  else if (sFa) s += ` Your date ${mine} is ${sFa.txt}.`;
  if (!(sFa && sFa.cur)) {
    if (sDf && sDf.cur) s += ` Dates for Filing ${show(df)}${mvDf ? ` (${mvDf})` : ''}: your date is inside it, so you can file the I-485 if USCIS uses that chart this month.`;
    else if (sDf) s += ` Dates for Filing ${show(df)}${mvDf ? ` (${mvDf})` : ''}: ${sDf.txt}.`;
    else s += ` Dates for Filing ${show(df)}.`;
  }
  return s;
}

const LINK = (entry) => ({ url: entry.u, label: 'Open the bulletin' });

// ---------- the twice-a-day check ----------

async function onCheck(ctx, st, me) {
  const seen = await ctx.memory.get('seen');
  const err = await ctx.memory.get('err');
  const today = ctx.local().date;
  const res = await check(ctx, st);
  if (!res.ok) {
    // One note per failure streak, and only once it has failed twice in a row: no spam for a blip.
    const e = { n: ((err && err.n) || 0) + 1, d: (err && err.d) || null, sent: !!(err && err.sent), why: res.why };
    if (e.n >= 2 && !e.sent && e.d !== today) {
      await ctx.notify({ title: 'Green Card Tracker: can\'t read the bulletin', body: `${res.why} I'll keep checking quietly and tell you as soon as the new bulletin is readable.`, link: { url: INDEX, label: 'Open travel.state.gov' } });
      e.sent = true; e.d = today;
    }
    await ctx.memory.set('err', e);
    ctx.log(res.why);
    return;
  }
  if (err) await ctx.memory.set('err', null);
  if (seen === res.latest.m) return;   // nothing new this month
  await ctx.notify({ title: `🛂 ${label(res.entry.m)} Visa Bulletin: ${catName(me.cat)} ${ctyName(me.cty)}`, body: summary(res.entry, res.prev, me), link: LINK(res.entry) });
  await ctx.memory.set('seen', res.latest.m);
}

// ---------- talking to it ----------

const HELP = 'I watch the US Visa Bulletin for you and tell you when a new month is out. Say:\n'
  + '• "status": this month\'s Final Action and Dates for Filing for you\n'
  + '• "history": the last 12 bulletins for your category\n'
  + '• "eta": a rough estimate from the average movement (not advice)\n'
  + '• "my date 2014-03-15": set your priority date\n'
  + '• "category eb3" (EB1-EB5, EW, F1, F2A, F2B, F3, F4) · "country india" (India, China, Mexico, Philippines, All)\n'
  + '• "check now": look for a new bulletin right away';

async function onMessage(ctx, st, me) {
  const raw = String((ctx.input && ctx.input.text) || '').trim();
  const text = raw.toLowerCase();
  const following = `${catName(me.cat)} ${ctyName(me.cty)}${me.pd ? `, priority date ${vb(me.pd)}` : ''}`;

  if (!text || /^(help|\?|what can you do|commands|menu|hi|hello|hey)\b/.test(text)) return ctx.reply(`${HELP}\n\nNow following: ${following}.`);

  // Settings in plain words.
  let m = text.match(/^(?:set\s+)?(?:my\s+(?:priority\s+)?date|priority\s+date|my\s+pd|pd)\b\s*(?:is|=|:|to)?\s*(.*)$/);
  if (m) {
    const pd = parsePd(m[1]);
    if (!pd) return ctx.reply('I didn\'t catch the date. Write it like "my date 2014-03-15" (year-month-day), as on your I-797 receipt.');
    await savePref(ctx, st, me, 'pd', pd);
    const latest = st.hist[st.hist.length - 1];
    return ctx.reply(`Saved: your priority date is ${vb(pd)} (${pd}).${latest ? `\n\n${summary(latest, st.hist[st.hist.length - 2], me)}` : ' Say "check now" to see where you stand.'}`, latest ? { link: LINK(latest) } : undefined);
  }
  m = text.match(/^(?:set\s+)?(?:my\s+)?(?:category|cat|preference)\s*(?:is|=|:|to)?\s*(.+)$/);
  if (m) {
    const c = normCat(m[1]);
    if (!c) return ctx.reply(`I don't know the category "${m[1]}". Use one of: ${CATS.join(', ')} (EW = EB3 Other Workers).`);
    await savePref(ctx, st, me, 'cat', c);
    const latest = st.hist[st.hist.length - 1];
    return ctx.reply(`Now following ${catName(c)} ${ctyName(me.cty)}.${latest ? `\n\n${summary(latest, st.hist[st.hist.length - 2], me)}` : ' Say "check now" to read the latest bulletin.'}`, latest ? { link: LINK(latest) } : undefined);
  }
  m = text.match(/^(?:set\s+)?(?:my\s+)?(?:country|chargeability|born in|from)\s*(?:is|=|:|to)?\s*(.+)$/);
  if (m) {
    const c = normCountry(m[1]);
    if (!c) return ctx.reply(`The bulletin lists India, China, Mexico and Philippines separately; everyone else is "All". Say e.g. "country india" or "country all".`);
    await savePref(ctx, st, me, 'cty', c);
    const latest = st.hist[st.hist.length - 1];
    return ctx.reply(`Now following ${catName(me.cat)} ${ctyName(c)}.${latest ? `\n\n${summary(latest, st.hist[st.hist.length - 2], me)}` : ' Say "check now" to read the latest bulletin.'}`, latest ? { link: LINK(latest) } : undefined);
  }

  if (/^(check|check now|refresh|update|new bulletin\??|any news\??|is it out\??)$/.test(text)) {
    const seen = await ctx.memory.get('seen');
    const res = await check(ctx, st);
    if (!res.ok) {
      const latest = st.hist[st.hist.length - 1];
      return ctx.reply(`${res.why} I'll try again on my next scheduled check.${latest ? `\n\nLast bulletin I read: ${summary(latest, st.hist[st.hist.length - 2], me)}` : ''}`);
    }
    const fresh = seen !== res.latest.m;
    if (fresh) await ctx.memory.set('seen', res.latest.m);
    return ctx.reply(`${fresh ? 'New bulletin. ' : `No new bulletin yet; ${label(res.latest.m)} is the latest. `}${summary(res.entry, res.prev, me)}`, { link: LINK(res.entry) });
  }

  if (/^(status|where (do|am) i|where do i stand|my status|today|now|dates?|current)\b/.test(text)) {
    let entry = st.hist[st.hist.length - 1], prev = st.hist[st.hist.length - 2];
    if (!entry) {
      const res = await check(ctx, st);
      if (!res.ok) return ctx.reply(`${res.why} I'll try again on my next check.`);
      await ctx.memory.set('seen', res.latest.m);
      entry = res.entry; prev = res.prev;
    }
    return ctx.reply(summary(entry, prev, me), { link: LINK(entry) });
  }

  if (/^(history|trend|past|last (12|twelve) months|movement)\b/.test(text)) {
    if (!st.hist.length) return ctx.reply('No bulletins recorded yet. Say "check now" and I\'ll read the latest ones.');
    const rows = st.hist.slice(-12);
    const lines = [];
    for (let i = rows.length - 1; i >= 0; i--) {
      const h = rows[i], p = i > 0 ? rows[i - 1] : st.hist[st.hist.indexOf(h) - 1];
      const fa = cell(h, 'fa', me), df = cell(h, 'df', me);
      const mv = moved(cell(p, 'fa', me), fa);
      lines.push(`${shortLabel(h.m)}: FA ${show(fa)}${mv ? ` (${mv})` : ''} · DF ${show(df)}`);
    }
    return ctx.reply(`${catName(me.cat)} ${ctyName(me.cty)}, last ${rows.length} bulletin${rows.length === 1 ? '' : 's'} (FA = Final Action, DF = Dates for Filing):\n${lines.join('\n')}`);
  }

  if (/^(eta|when|how long|estimate|prediction|forecast)\b/.test(text)) return ctx.reply(eta(st.hist, me));

  return ctx.reply(`I'm not sure what you meant by "${raw.slice(0, 60)}". I follow ${following}. Try "status", "history", "eta", "my date 2014-03-15", "category eb3" or "check now".`);
}

function eta(hist, me) {
  const rows = hist.slice(-12);
  if (!rows.length) return 'No bulletins recorded yet. Say "check now" first.';
  const last = rows[rows.length - 1];
  const fa = cell(last, 'fa', me);
  if (!me.pd) return `Tell me your priority date first ("my date 2014-03-15"). ${catName(me.cat)} ${ctyName(me.cty)} Final Action is ${show(fa)} in ${label(last.m)}.`;
  const s = standing(fa, me.pd);
  if (s && s.cur) return `No estimate needed: your date ${vb(me.pd)} is already current for Final Action (${show(fa)}) in the ${label(last.m)} bulletin.`;
  let adv = 0, span = 0, from = null, to = null;
  for (let i = 1; i < rows.length; i++) {
    const a = cell(rows[i - 1], 'fa', me), b = cell(rows[i], 'fa', me);
    if (!isDate(a) || !isDate(b)) continue;
    adv += monthsBetween(cellIso(a), cellIso(b));
    span += monthsBetween(`${rows[i - 1].m}-01`, `${rows[i].m}-01`);
    if (!from) from = { m: rows[i - 1].m, v: a };
    to = { m: rows[i].m, v: b };
  }
  if (!span) return `Not enough history yet for an estimate: I need at least two bulletins with a dated ${catName(me.cat)} ${ctyName(me.cty)} Final Action. Current cutoff: ${show(fa)}.`;
  const avg = Math.round((adv / span) * 100) / 100;
  const pace = `${avg.toFixed(1)} months per month over ${span} month${span === 1 ? '' : 's'} (${from.v} in ${shortLabel(from.m)} → ${to.v} in ${shortLabel(to.m)})`;
  if (!isDate(fa)) return `Rough estimate not possible: Final Action is ${show(fa)} this month. Average movement was ${pace}.`;
  if (avg <= 0) return `Rough estimate, not advice: ${catName(me.cat)} ${ctyName(me.cty)} Final Action made no net progress, ${pace}. At that pace I can't give an ETA for ${vb(me.pd)}.`;
  const gap = s.gap;
  const need = Math.ceil(gap / avg);
  const [y, mo] = last.m.split('-').map(Number);
  const k = y * 12 + (mo - 1) + need;
  const when = `${MON3[k % 12][0]}${MON3[k % 12].slice(1).toLowerCase()} ${Math.floor(k / 12)}`;
  return `Rough estimate, not advice: Final Action moved ${pace}. Your date ${vb(me.pd)} is ${n1(gap)} past the ${show(fa)} cutoff, so at that pace it could be current around ${when} (about ${need} month${need === 1 ? '' : 's'} from the ${label(last.m)} bulletin). Bulletins jump and retrogress, so treat this as a guess.`;
}
