// Care Manager: medicine times, confirmations, missed-dose escalation, pill counts and refills,
// appointments, and a daily and weekly summary for the family looking after someone.

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_RX = 'sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:s|nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?';
const MONTH_RX = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

// ---------- dates ----------
const pad = (n) => String(n).padStart(2, '0');
const hm = (h, m) => `${pad(h)}:${pad(m)}`;
function addDays(date, n) { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function addMin(st, n) { const d = new Date(`${st}:00Z`); d.setUTCMinutes(d.getUTCMinutes() + n); return d.toISOString().slice(0, 16); }
function daysBetween(a, b) { return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000); }
function dow(date) { return DAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]; }
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function longDate(date) { const d = new Date(`${date}T00:00:00Z`); return `${cap(DAYS[d.getUTCDay()])} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; }
function pretty(date, today) {
  if (date === today) return 'today';
  if (date === addDays(today, 1)) return 'tomorrow';
  if (date === addDays(today, -1)) return 'yesterday';
  return longDate(date);
}
function prettyStamp(st, today) { return `${pretty(st.slice(0, 10), today)} ${st.slice(11, 16)}`; }
const stampOf = (L) => `${L.date}T${L.time}`;
function validTime(v) { const m = String(v || '').trim().match(/^(\d{1,2}):(\d{2})$/); return m && +m[1] < 24 && +m[2] < 60 ? hm(+m[1], +m[2]) : null; }
function mkDate(y, mo, d, today) {
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
  let year = y || +today.slice(0, 4);
  if (year < 100) year += 2000;
  let s = `${year}-${pad(mo)}-${pad(d)}`;
  if (new Date(`${s}T00:00:00Z`).getUTCDate() !== d) return null;
  if (!y && s < today) s = `${year + 1}-${pad(mo)}-${pad(d)}`;
  return s;
}
const monthNum = (w) => ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(w.slice(0, 3).toLowerCase()) + 1;

/** Find a date and/or time in plain words. Returns { date, time, rest, wk }. */
function parseWhen(text, L) {
  let s = ` ${text} `;
  let date = null, time = null, wk = false;
  const take = (re, fn) => {
    const m = s.match(re);
    if (!m || fn(m) === false) return false;
    s = `${s.slice(0, m.index)} ${s.slice(m.index + m[0].length)}`;
    return true;
  };
  const now = stampOf(L);
  take(/\bin\s+(\d+(?:\.\d+)?|an?|one|two|three|four|five|ten|half an?)\s*(minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w)\b/i, (m) => {
    const words = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10 };
    const n = /^half/i.test(m[1]) ? 0.5 : (words[m[1].toLowerCase()] || Number(m[1]));
    const u = m[2].toLowerCase()[0];
    const st = addMin(now, Math.round(n * (u === 'm' ? 1 : u === 'h' ? 60 : u === 'd' ? 1440 : 10080)));
    date = st.slice(0, 10);
    if (u === 'm' || u === 'h') time = st.slice(11);
  });
  if (!time) {
    take(/\b(?:at\s+|@\s*)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?=[\s,.;!?])/i, (m) => {
      if (+m[1] > 12 || +(m[2] || 0) > 59) return false;
      time = hm((+m[1] % 12) + (/p/i.test(m[3]) ? 12 : 0), +(m[2] || 0));
    })
    || take(/\b(?:at\s+|@\s*)?([01]?\d|2[0-3]):([0-5]\d)\b/, (m) => { time = hm(+m[1], +m[2]); })
    || take(/\b(?:at\s+)?(noon|midday)\b/i, () => { time = '12:00'; })
    || take(/\bat\s+(\d{1,2})\b(?![/.:\d])/i, (m) => { let h = +m[1]; if (h > 23) return false; if (h >= 1 && h <= 6) h += 12; time = hm(h, 0); })
    || take(/\b(?:in the |this )?(morning|afternoon|evening|tonight)\b/i, (m) => {
      const w = m[1].toLowerCase();
      time = { morning: '09:00', afternoon: '14:00', evening: '18:00', tonight: '20:00' }[w];
      if (w === 'tonight' && !date) date = L.date;
    });
  }
  if (!date) {
    const pre = '(?:(?:by|on|due|before)\\s+)?';
    take(/\b(?:the\s+)?day after tomorrow\b/i, () => { date = addDays(L.date, 2); })
    || take(new RegExp(`\\b${pre}(today|tonight)\\b`, 'i'), () => { date = L.date; })
    || take(new RegExp(`\\b${pre}(tomorrow|tomorow|tmrw|tmr)\\b`, 'i'), () => { date = addDays(L.date, 1); })
    || take(new RegExp(`\\b${pre}(?:(next|this)\\s+)?(${DAY_RX})\\b\\.?`, 'i'), (m) => {
      const diff = (DAYS.indexOf(m[2].slice(0, 3).toLowerCase()) - DAYS.indexOf(L.weekday) + 7) % 7;
      date = addDays(L.date, diff === 0 && m[1] && m[1].toLowerCase() === 'next' ? 7 : diff);
      wk = diff === 0;
    })
    || take(new RegExp(`\\b${pre}(${MONTH_RX})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b(?!:)`, 'i'), (m) => { date = mkDate(m[3] ? +m[3] : 0, monthNum(m[1]), +m[2], L.date); if (!date) return false; })
    || take(new RegExp(`\\b${pre}(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RX})\\b(?:,?\\s+(\\d{4}))?`, 'i'), (m) => { date = mkDate(m[3] ? +m[3] : 0, monthNum(m[2]), +m[1], L.date); if (!date) return false; })
    || take(/\b(?:(?:by|on|due|before)\s+)?(\d{4})-(\d{2})-(\d{2})\b/, (m) => { date = mkDate(+m[1], +m[2], +m[3], L.date); if (!date) return false; })
    || take(/\b(?:(?:by|on|due|before)\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, (m) => {
      const a = +m[1], b = +m[2];
      date = a > 12 ? mkDate(m[3] ? +m[3] : 0, b, a, L.date) : mkDate(m[3] ? +m[3] : 0, a, b, L.date);
      if (!date) return false;
    })
    || take(/\b(?:(?:by|on|due)\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)\b/i, (m) => {
      const d = +m[1];
      let y = +L.date.slice(0, 4), mo = +L.date.slice(5, 7);
      if (d < +L.date.slice(8, 10)) { mo += 1; if (mo > 12) { mo = 1; y += 1; } }
      date = mkDate(y, mo, d, L.date);
      if (!date) return false;
    })
    || take(/\b(?:by\s+)?next week\b/i, () => { date = addDays(L.date, ((1 - DAYS.indexOf(L.weekday) + 7) % 7) || 7); });
  }
  return { date, time, wk, rest: tidy(s) };
}
function tidy(s) {
  let t = String(s).replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) {
    t = t.replace(/^(?:to|that|about|for|me to)\s+/i, '').replace(/\s+(?:at|on|by|for|due|in|every|from)$/i, '')
      .replace(/^[,:;.\-–\s]+|[,:;\-–\s]+$/g, '').trim();
  }
  return t;
}
/** A reminder instant from parsed words; null if it had no date or time. */
function whenStamp(w, L) {
  if (!w.date && !w.time) return null;
  const time = w.time || '09:00';
  const date = w.date || (time > L.time ? L.date : addDays(L.date, 1));
  let st = `${date}T${time}`;
  if (w.wk && st <= stampOf(L)) st = `${addDays(date, 7)}T${time}`;
  return st;
}


// ---------- memory ----------
function store(ctx) {
  const cache = {}, dirty = new Set();
  return {
    async get(k, d) { if (!(k in cache)) { const v = await ctx.memory.get(k); cache[k] = v == null ? d : v; } return cache[k]; },
    set(k, v) { cache[k] = v; dirty.add(k); },
    async save() { for (const k of dirty) await ctx.memory.set(k, cache[k]); },
  };
}
function minsBetween(a, b) { return Math.round((Date.parse(`${b}:00Z`) - Date.parse(`${a}:00Z`)) / 60000); }

// ---------- medicines ----------
const WORD_TIMES = { morning: '08:00', breakfast: '08:00', noon: '12:00', lunch: '13:00', afternoon: '14:00', evening: '18:00', dinner: '20:00', night: '21:00', bedtime: '22:00' };
function parseTimes(s) {
  const out = [];
  for (const tok of String(s || '').toLowerCase().split(/\s*(?:,|;|\/|\band\b|\s(?=\d))\s*/)) {
    const x = tok.trim().replace(/\s+/g, '');
    if (!x) continue;
    let m = x.match(/^(\d{1,2})(?::|\.)?(\d{2})?(am|pm|a\.m\.|p\.m\.)?$/), t = null;
    if (m && (m[2] || m[3]) && +m[1] < 24 && +(m[2] || 0) < 60) {
      let h = +m[1];
      if (m[3]) { if (h > 12) continue; h = (h % 12) + (m[3][0] === 'p' ? 12 : 0); }
      t = hm(h, +(m[2] || 0));
    } else if (WORD_TIMES[x]) t = WORD_TIMES[x];
    if (t && !out.includes(t)) out.push(t);
  }
  return out.sort();
}
function parseMeds(v) {
  const out = [];
  for (const line of String(v || '').split(/\n+/).map((x) => x.trim()).filter(Boolean).slice(0, 20)) {
    let name, times, pills = null;
    const parts = line.split('|').map((x) => x.trim());
    if (parts.length >= 2) {
      name = parts[0]; times = parseTimes(parts[1]);
      const n = parseInt(String(parts[2] || '').replace(/[^\d]/g, ''), 10);
      if (Number.isFinite(n)) pills = n;
    } else {
      const m = line.match(/^(.+?)\s+((?:\d{1,2}(?::\d{2})?\s*(?:am|pm)?|morning|noon|evening|night|bedtime)(?:\s*(?:,|and|\/)?\s*(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)?|morning|noon|evening|night|bedtime))*)$/i);
      if (!m) continue;
      name = m[1]; times = parseTimes(m[2]);
    }
    name = name.replace(/\s+/g, ' ').slice(0, 40);
    if (!name || !times.length || out.some((x) => x.key === name.toLowerCase())) continue;
    out.push({ name, key: name.toLowerCase(), times, pills });
  }
  return out;
}
function doses(meds, date) {
  const out = [];
  for (const med of meds) for (const tm of med.times) out.push({ med, tm, date, key: `${med.key}@${tm}`, st: `${date}T${tm}` });
  return out.sort((a, b) => a.st.localeCompare(b.st));
}
function findMeds(meds, words) {
  const q = String(words || '').toLowerCase().replace(/\b(my|the|her|his|their|pills?|tablets?|medicines?|meds|dose)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (!q) return [];
  const parts = q.split(/\s*(?:,|&|\band\b)\s*/).filter(Boolean);
  const hits = [];
  for (const p of parts) {
    const first = p.split(' ')[0];
    const med = meds.find((m) => m.key === p) || meds.find((m) => m.key.includes(p)) || meds.find((m) => m.key.split(' ')[0] === first) || meds.find((m) => first.length >= 4 && m.key.startsWith(first.slice(0, 4)));
    if (med && !hits.includes(med)) hits.push(med);
  }
  return hits;
}
const part = (tm) => (tm < '12:00' ? 'morning' : tm < '17:00' ? 'afternoon' : 'evening');
function tel(v) { const d = String(v || '').replace(/[^\d+]/g, ''); return d.replace(/\D/g, '').length >= 3 ? `tel:${d}` : null; }
const names = (list) => list.map((d) => d.med.name).join(', ');

// ---------- dose bookkeeping ----------
async function state(ctx, M, L, meds) {
  const log = await M.get('log', {});
  let since = await M.get('since', null);
  if (!since) { since = stampOf(L); M.set('since', since); }
  const pills = await M.get('pills', {});
  let changed = false;
  for (const med of meds) {
    if (med.pills == null) continue;
    const p = pills[med.key];
    if (!p || p.s !== med.pills) { pills[med.key] = { n: med.pills, s: med.pills }; changed = true; }
  }
  if (changed) M.set('pills', pills);
  return { log, since, pills };
}
const statusOf = (log, d) => (log[d.date] || {})[d.key];
/** Doses that "taken"/"skip" applies to: today's, not yet answered, due by an hour from now; the latest one per medicine. */
function current(meds, S, L, filter) {
  const now = stampOf(L), soon = addMin(now, 60);
  const pick = {};
  for (const d of doses(meds, L.date)) {
    if (filter && !filter.includes(d.med)) continue;
    if (d.st > soon || statusOf(S.log, d)) continue;
    pick[d.med.key] = d;
  }
  return Object.values(pick).sort((a, b) => a.st.localeCompare(b.st));
}
function nextDose(meds, S, L) {
  const now = stampOf(L);
  const all = doses(meds, L.date).concat(doses(meds, addDays(L.date, 1)));
  return all.find((d) => d.st > now && !statusOf(S.log, d)) || null;
}
function mark(S, M, list, value, today) {
  for (const d of list) {
    S.log[d.date] = S.log[d.date] || {};
    S.log[d.date][d.key] = value;
    if (value !== 's' && S.pills[d.med.key] && S.pills[d.med.key].n > 0) S.pills[d.med.key].n -= 1;
  }
  const cut = addDays(today, -90);
  for (const k of Object.keys(S.log)) if (k < cut) delete S.log[k];
  M.set('log', S.log);
  if (value !== 's') M.set('pills', S.pills);
}
function daysLeft(med, p) { return Math.floor(p.n / Math.max(1, med.times.length)); }
async function refillAlerts(ctx, M, meds, S, who, warn) {
  const out = [];
  for (const med of meds) {
    const p = S.pills[med.key];
    if (!p) continue;
    const left = daysLeft(med, p);
    if (left <= warn && !p.w) {
      p.w = 1;
      out.push(`${med.name}: ${p.n} left`);
      const link = tel(ctx.settings.pharmacyPhone);
      await ctx.notify({
        title: `💊 Refill ${med.name} soon`,
        body: `${who} has ${p.n} ${med.name} left, about ${left} day${left === 1 ? '' : 's'} at ${med.times.length} a day. Order a refill${link ? ': tap to call the pharmacy' : ''}. Then say "refilled ${med.key.split(' ')[0]} 90".`,
        ...(link ? { link: { url: link, label: 'Call pharmacy' } } : {}),
      });
      M.set('pills', S.pills);
    }
  }
  return out;
}

// ---------- reports ----------
function dayRows(meds, S, L, date, esc) {
  const now = stampOf(L);
  return doses(meds, date).filter((d) => d.st >= S.since || statusOf(S.log, d)).map((d) => {
    const s = statusOf(S.log, d);
    let icon, note;
    if (s === 's') { icon = '⏭'; note = 'skipped'; }
    else if (s) { icon = '✓'; note = `taken ${s}`; }
    else if (d.st > now) { icon = '·'; note = 'later'; }
    else if (minsBetween(d.st, now) >= esc) { icon = '✗'; note = 'not taken'; }
    else { icon = '⏰'; note = 'due now'; }
    return { d, s, icon, line: `${icon} ${d.tm} ${d.med.name}: ${note}` };
  });
}
function adherence(meds, S, L, from, to) {
  const now = stampOf(L);
  let expected = 0, taken = 0, skipped = 0;
  const missed = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    for (const d of doses(meds, date)) {
      if (d.st < S.since || d.st > now) continue;
      expected++;
      const s = statusOf(S.log, d);
      if (s === 's') skipped++;
      else if (s) taken++;
      else missed.push(`${d.med.name} ${cap(dow(date))} ${d.tm}`);
    }
  }
  return { expected, taken, skipped, missed, pct: expected ? Math.round((taken / expected) * 100) : null };
}
function adherenceText(a) {
  if (!a.expected) return 'No doses recorded yet this week.';
  return `${a.taken} of ${a.expected} doses taken (${a.pct}%)${a.skipped ? `, ${a.skipped} skipped` : ''}${a.missed.length ? `. Missed: ${a.missed.slice(0, 6).join(', ')}${a.missed.length > 6 ? ` +${a.missed.length - 6} more` : ''}` : '. None missed'}.`;
}
function pillLines(meds, S, warn) {
  return meds.filter((m) => S.pills[m.key]).map((m) => { const p = S.pills[m.key], left = daysLeft(m, p); return `${m.name}: ${p.n} left (${left} day${left === 1 ? '' : 's'})${left <= warn ? ' ⚠️ refill soon' : ''}`; });
}

// ---------- appointments ----------
function nextNum(arr) { const used = new Set(arr.map((x) => x.n)); let n = 1; while (used.has(n)) n++; return n; }
const apStamp = (a) => `${a.d}T${a.tm || '09:00'}`;
const titleCase = (s) => s.replace(/\b([a-z])/g, (x) => x.toUpperCase());
async function apptReminders(ctx, M, L, who) {
  const appts = await M.get('appts', []);
  const now = stampOf(L), tom = addDays(L.date, 1);
  const link = tel(ctx.settings.doctorPhone);
  let changed = false;
  for (const a of appts) {
    if (a.d < L.date) continue;
    if (!a.r1 && a.d === tom && L.hour >= 18) {
      await ctx.notify({ title: `📅 Tomorrow: ${a.t}${a.tm ? ` at ${a.tm}` : ''}`, body: `${who} has ${a.t} tomorrow (${longDate(a.d)})${a.tm ? ` at ${a.tm}` : ''}. Bring the medicine list and any recent reports.`, ...(link ? { link: { url: link, label: 'Call the doctor' } } : {}) });
      a.r1 = 1; changed = true;
    }
    if (a.tm && !a.r2) {
      const mins = minsBetween(now, apStamp(a));
      if (mins > 0 && mins <= 120) {
        await ctx.notify({ title: `⏰ ${a.t} at ${a.tm}`, body: `${who}'s appointment is in ${mins >= 90 ? 'about 2 hours' : mins >= 45 ? 'about an hour' : `${mins} minutes`}. Time to get ready.`, ...(link ? { link: { url: link, label: 'Call the doctor' } } : {}) });
        a.r2 = 1; changed = true;
      }
    }
  }
  const cut = addDays(L.date, -30);
  const keep = appts.filter((a) => a.d >= cut);
  if (changed || keep.length !== appts.length) M.set('appts', keep);
}

// ---------- runs ----------
async function check(ctx, M, L, meds, S, who, esc, warn) {
  const now = stampOf(L);
  const alerts = await M.get('alerts', {});
  const due = [], late = [];
  for (const date of [addDays(L.date, -1), L.date]) {
    for (const d of doses(meds, date)) {
      if (d.st < S.since || d.st > now || statusOf(S.log, d)) continue;
      const el = minsBetween(d.st, now);
      const a = (alerts[date] || {})[d.key] || 0;
      if (el >= esc && a < 2 && el < esc + 240) late.push(d);
      else if (el < esc && a < 1 && el < 180) due.push(d);
    }
  }
  const groups = (list) => { const g = {}; for (const d of list) (g[d.st] = g[d.st] || []).push(d); return Object.values(g); };
  for (const g of groups(due)) {
    await ctx.notify({ title: `💊 ${who}: ${g[0].tm} medicine${g.length > 1 ? 's' : ''}`, body: `Time for ${names(g)}. ${who}: tap Run → Taken, or reply "taken".` });
  }
  for (const g of groups(late)) {
    const el = minsBetween(g[0].st, now);
    const link = tel(ctx.settings.personPhone);
    await ctx.notify({ title: `⚠️ ${who} hasn't taken the ${g[0].tm} ${names(g)}`, body: `${who} missed ${names(g)} (due ${g[0].tm}): no confirmation after ${el} minutes. Worth a call to check on ${who}.`, ...(link ? { link: { url: link, label: `Call ${who}` } } : {}) });
  }
  if (due.length || late.length) {
    for (const d of due) { alerts[d.date] = alerts[d.date] || {}; alerts[d.date][d.key] = 1; }
    for (const d of late) { alerts[d.date] = alerts[d.date] || {}; alerts[d.date][d.key] = 2; }
    for (const k of Object.keys(alerts)) if (k < addDays(L.date, -1)) delete alerts[k];
    M.set('alerts', alerts);
  }
  await refillAlerts(ctx, M, meds, S, who, warn);
  await apptReminders(ctx, M, L, who);
}

async function summary(ctx, M, L, meds, S, who, esc, warn) {
  const sent = await M.get('sent', {});
  if (sent.sum === L.date) return;
  sent.sum = L.date;
  M.set('sent', sent);
  const rows = dayRows(meds, S, L, L.date, esc);
  if (!rows.length && dow(L.date) !== 'sun') return;
  const taken = rows.filter((r) => r.s && r.s !== 's').length;
  const lines = rows.map((r) => r.line);
  const low = pillLines(meds, S, warn).filter((x) => x.includes('refill'));
  if (low.length) lines.push(`Refill soon: ${low.map((x) => x.replace(' ⚠️ refill soon', '')).join('; ')}`);
  const appts = (await M.get('appts', [])).filter((a) => a.d === addDays(L.date, 1));
  for (const a of appts) lines.push(`📅 Tomorrow: ${a.t}${a.tm ? ` at ${a.tm}` : ''}`);
  if (dow(L.date) === 'sun') lines.push(`📈 This week: ${adherenceText(adherence(meds, S, L, addDays(L.date, -6), L.date))}`);
  await ctx.notify({ title: `📋 ${who} today: ${taken} of ${rows.length} doses taken`, body: lines.join('\n') });
}

async function confirm(ctx, M, L, meds, S, who, warn, filter, skip, viaChat) {
  const list = current(meds, S, L, filter);
  if (!list.length) {
    const nd = nextDose(meds, S, L);
    const already = doses(meds, L.date).filter((d) => (!filter || filter.includes(d.med)) && statusOf(S.log, d) && statusOf(S.log, d) !== 's' && d.st <= addMin(stampOf(L), 60));
    const msg = `${already.length ? `Already recorded: ${already.map((d) => `${d.med.name} ${d.tm}`).join(', ')}. ` : 'Nothing is due right now. '}${nd ? `Next: ${nd.med.name} at ${nd.tm}${nd.date !== L.date ? ' tomorrow' : ''}.` : ''}`;
    if (viaChat) await ctx.reply(msg); else await ctx.notify({ title: `💊 ${who}: nothing due right now`, body: msg });
    return;
  }
  mark(S, M, list, skip ? 's' : L.time, L.date);
  const what = list.map((d) => `${d.med.name} (${d.tm})`).join(', ');
  const counts = skip ? '' : list.filter((d) => S.pills[d.med.key]).map((d) => `${d.med.name}: ${S.pills[d.med.key].n} left`).join(', ');
  const text = skip ? `⏭ Skipped ${what}.` : `✅ ${who} took ${what} at ${L.time}.${counts ? ` ${counts}.` : ''}`;
  const nd = nextDose(meds, S, L);
  if (viaChat) {
    await ctx.reply(`${text}${nd ? ` Next: ${nd.med.name} at ${nd.tm}${nd.date !== L.date ? ' tomorrow' : ''}.` : ''}`);
    // The family was told this dose was missed: tell them it's sorted.
    const alerts = await M.get('alerts', {});
    const late = list.filter((d) => ((alerts[d.date] || {})[d.key] || 0) >= 2);
    if (late.length) await ctx.notify({ title: `✅ ${who} ${skip ? 'skipped' : 'took'} the ${late[0].tm} ${names(late)} after all`, body: `${skip ? 'Skipped' : 'Confirmed'} at ${L.time}, after the missed-dose alert.` });
  }
  else await ctx.notify({ title: skip ? `⏭ ${who} skipped a dose` : `✅ ${who} took the ${list[0].tm} medicines`, body: text });
  if (!skip) await refillAlerts(ctx, M, meds, S, who, warn);
}

function helpText(who) {
  return `I look after ${who}'s medicines and appointments. You can say:
• taken / took metformin / took all
• skip evening metformin
• refilled metformin 90
• appointment dr rao tue 10am · appointments
• meds (today) · adherence (this week) · pills left
I ping at each dose time, warn the family if a dose isn't confirmed, warn before pills run out, and send a summary at 21:00 (weekly on Sundays).`;
}

async function onMessage(ctx, M, L, meds, S, who, esc, warn) {
  const raw = String(ctx.input.text || '').trim();
  const t = raw.toLowerCase().replace(/[!.?]+$/, '').trim();
  const today = L.date;
  const say = (s, link) => ctx.reply(s, link ? { link } : undefined);
  if (!t || /^(help|\?|what can you do|commands|hi|hello|hey)$/.test(t)) return say(helpText(who));
  if (!meds.length) return say('No medicines are set up yet. Add them under Settings, one per line, e.g. "Metformin 500mg | 08:00, 20:00 | 60".');

  if (/^(taken|took|took (?:it|them|all|everything|my (?:meds|medicines|pills|tablets))|all taken|done|yes|took all (?:of )?(?:them|my meds)?)$/.test(t)) return confirm(ctx, M, L, meds, S, who, warn, null, false, true);
  let m = t.match(/^(?:took|taken|had)\s+(?:the\s+|my\s+|her\s+|his\s+)?(?:(morning|afternoon|evening|night)\s+)?(.+)$/);
  if (m) {
    const hit = findMeds(meds, m[2]);
    if (!hit.length) return say(`I don't know "${m[2]}". ${who}'s medicines: ${meds.map((x) => x.name).join(', ')}.`);
    return confirm(ctx, M, L, meds, S, who, warn, hit, false, true);
  }
  m = t.match(/^skip(?:ped|ping)?\s*(?:the\s+)?(morning|afternoon|evening|night|tonight'?s?)?\s*(.*)$/);
  if (m) {
    const hit = m[2] ? findMeds(meds, m[2]) : meds;
    if (m[2] && !hit.length) return say(`I don't know "${m[2]}". ${who}'s medicines: ${meds.map((x) => x.name).join(', ')}.`);
    if (m[1]) {
      const want = /night|tonight/.test(m[1]) ? 'evening' : m[1];
      const list = doses(meds, today).filter((d) => hit.includes(d.med) && part(d.tm) === want && !statusOf(S.log, d));
      if (!list.length) return say(`There's no open ${want} dose${m[2] ? ` of ${names([{ med: hit[0] }])}` : ''} today.`);
      mark(S, M, list, 's', today);
      return say(`⏭ Skipped ${list.map((d) => `${d.med.name} (${d.tm})`).join(', ')} today. It won't trigger a missed-dose alert.`);
    }
    return confirm(ctx, M, L, meds, S, who, warn, hit, true, true);
  }
  m = t.match(/^(?:refill(?:ed)?|restock(?:ed)?|got|bought)\s+(.+?)\s+(\d{1,4})(?:\s*(?:pills|tablets|tabs|caps))?$/) || t.match(/^(?:refill(?:ed)?|restock(?:ed)?)\s+(\d{1,4})\s+(.+)$/);
  if (m) {
    const [words, num] = /^\d+$/.test(m[1]) ? [m[2], +m[1]] : [m[1], +m[2]];
    const hit = findMeds(meds, words);
    if (!hit.length) return say(`I don't know "${words}". ${who}'s medicines: ${meds.map((x) => x.name).join(', ')}.`);
    const med = hit[0];
    const p = S.pills[med.key] || { n: 0, s: med.pills };
    p.n += num;
    delete p.w;
    S.pills[med.key] = p;
    M.set('pills', S.pills);
    const left = daysLeft(med, p);
    return say(`📦 ${med.name}: +${num}, now ${p.n} pills (about ${left} days at ${med.times.length} a day).`);
  }
  m = raw.match(/^(?:appointment|appt|doctor'?s? appointment|dr appointment|visit)\s*[:\-]?\s+(.+)$/i);
  if (m) {
    const w = parseWhen(m[1], L);
    const what = titleCase(tidy(w.rest).replace(/^with\s+/i, '')).slice(0, 80);
    if (!w.date && !w.time) return say(`When is the appointment${what ? ` with ${what}` : ''}? e.g. "appointment dr rao tue 10am".`);
    let date = w.date || (w.time > L.time ? today : addDays(today, 1));
    if (w.wk && `${date}T${w.time || '23:59'}` <= stampOf(L)) date = addDays(date, 7);
    if (`${date}T${w.time || '23:59'}` < stampOf(L)) return say('That time has already passed. When is the appointment?');
    const appts = await M.get('appts', []);
    const a = { n: nextNum(appts), t: what || 'Doctor', d: date };
    if (w.time) a.tm = w.time;
    if (date <= today || (date === addDays(today, 1) && L.hour >= 18)) a.r1 = 1;
    if (w.time && minsBetween(stampOf(L), apStamp(a)) <= 120) a.r2 = 1;
    appts.push(a);
    M.set('appts', appts.slice(-100));
    const rem = [];
    if (!a.r1) rem.push('the evening before');
    if (a.tm && !a.r2) rem.push('2 hours before');
    const link = tel(ctx.settings.doctorPhone);
    return say(`📅 Appointment: ${a.t}, ${pretty(date, today)}${date === today || date === addDays(today, 1) ? ` (${longDate(date)})` : ''}${a.tm ? ` at ${a.tm}` : ''}.${rem.length ? ` I'll remind the family ${rem.join(' and ')}.` : ''}`, link ? { url: link, label: 'Call the doctor' } : null);
  }
  if (/^(appointments|appts|upcoming|visits)$/.test(t)) {
    const appts = (await M.get('appts', [])).filter((a) => a.d >= today).sort((a, b) => apStamp(a).localeCompare(apStamp(b)));
    if (!appts.length) return say('No upcoming appointments. Add one: "appointment dr rao tue 10am".');
    return say(`📅 Upcoming:\n${appts.map((a) => `${a.n}. ${a.t}: ${pretty(a.d, today)}${a.tm ? ` ${a.tm}` : ''}`).join('\n')}`);
  }
  m = t.match(/^(?:cancel|delete|remove)\s+(?:appointment|appt)\s+#?(.+)$/);
  if (m) {
    const appts = await M.get('appts', []);
    const a = /^\d+$/.test(m[1]) ? appts.find((x) => x.n === +m[1]) : appts.find((x) => x.t.toLowerCase().includes(m[1]));
    if (!a) return say(`I couldn't find appointment "${m[1]}". Say "appointments" to see them.`);
    appts.splice(appts.indexOf(a), 1);
    M.set('appts', appts);
    return say(`🗑 Cancelled: ${a.t} (${pretty(a.d, today)}${a.tm ? ` ${a.tm}` : ''}).`);
  }
  if (/^(meds|medicines|today|status|schedule|doses|what'?s due|how is (?:she|he|they) doing)$/.test(t)) {
    const rows = dayRows(meds, S, L, today, esc);
    const pl = pillLines(meds, S, warn);
    return say(`💊 ${who}, ${longDate(today)}:\n${rows.map((r) => r.line).join('\n') || 'No doses today.'}${pl.length ? `\nPills: ${pl.join('; ')}` : ''}`);
  }
  if (/^(adherence|this week|week|weekly|report|how was the week)$/.test(t)) {
    const a = adherence(meds, S, L, addDays(today, -6), today);
    const per = meds.map((med) => { const x = adherence([med], S, L, addDays(today, -6), today); return x.expected ? `${med.name} ${x.taken}/${x.expected}` : null; }).filter(Boolean);
    return say(`📈 ${who}, last 7 days: ${adherenceText(a)}${per.length > 1 ? `\nBy medicine: ${per.join(' · ')}` : ''}`);
  }
  if (/^(pills|pills left|stock|supply|how many (?:pills )?left|refills?)$/.test(t)) {
    const pl = pillLines(meds, S, warn);
    if (!pl.length) return say('I\'m not counting pills yet. Add a count to each medicine in Settings ("Metformin 500mg | 08:00, 20:00 | 60") or say "refilled metformin 60".');
    const link = tel(ctx.settings.pharmacyPhone);
    return say(`💊 Pills left:\n${pl.join('\n')}`, link && pl.some((x) => x.includes('refill')) ? { url: link, label: 'Call pharmacy' } : null);
  }
  return say(`I didn't catch "${raw.slice(0, 60)}". Try "taken", "took ${meds[0].key.split(' ')[0]}", "skip evening ${meds[0].key.split(' ')[0]}", "meds", "adherence", "pills left" or "appointment dr rao tue 10am". Say "help" for more.`);
}

async function run(ctx) {
  const L = ctx.local();
  const M = store(ctx);
  const meds = parseMeds(ctx.settings.medicines);
  const who = String(ctx.settings.person || '').trim().split(/\s+/)[0] || 'They';
  const esc = Math.min(Math.max(Number(ctx.settings.escalateAfter) || 60, 15), 600);
  const warn = Math.min(Math.max(Number(ctx.settings.refillDays) || 7, 1), 60);
  const type = ctx.trigger.type;
  if (type === 'message' && !meds.length) { await ctx.reply(/help/i.test(String(ctx.input.text || '')) ? helpText(who) : 'No medicines are set up yet. Add them under Settings, one per line, e.g. "Metformin 500mg | 08:00, 20:00 | 60".'); return; }
  if (!meds.length) { ctx.log('No medicines set up.'); return; }
  const S = await state(ctx, M, L, meds);
  if (type === 'message') await onMessage(ctx, M, L, meds, S, who, esc, warn);
  else if (type === 'manual') {
    const choice = String(ctx.input.status || '');
    await confirm(ctx, M, L, meds, S, who, warn, null, /skip/i.test(choice), false);
  } else if (type === 'schedule') await summary(ctx, M, L, meds, S, who, esc, warn);
  else await check(ctx, M, L, meds, S, who, esc, warn);
  await M.save();
}
