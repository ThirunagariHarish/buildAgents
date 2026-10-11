// Family Hub: shared lists, fair chore rotation with swaps and scores, family events with reminders.
// ctx.input.from is the first name of whoever in the family sent the message.

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

// ---------- people and chores ----------
const DEFAULT_CHORES = 'Dishes daily\nTrash weekly mon\nLaundry weekly sat\nBathroom weekly sun';
function splitLines(v) { return String(v || '').split(/[\n,]+/).map((x) => x.trim()).filter(Boolean); }
function parsePeople(v) {
  const out = [];
  for (const x of splitLines(v)) { const n = cap(x.replace(/\s+/g, ' ').slice(0, 30)); if (!out.some((y) => y.toLowerCase() === n.toLowerCase())) out.push(n); }
  return out.slice(0, 12);
}
function parseChores(v) {
  const out = [];
  for (const line of String(v == null ? DEFAULT_CHORES : v).split(/\n+/).map((x) => x.trim()).filter(Boolean).slice(0, 20)) {
    let m = line.match(new RegExp(`^(.+?)\\s*[-:|]?\\s+(daily|every ?day|weekly|every ?week)(?:\\s+(?:on\\s+)?(${DAY_RX})s?)?\\.?$`, 'i'));
    let name, f, day = null;
    if (m) { name = m[1]; f = /week/i.test(m[2]) ? 'weekly' : 'daily'; if (m[3]) day = m[3].slice(0, 3).toLowerCase(); }
    else if ((m = line.match(new RegExp(`^(.+?)\\s+(?:on\\s+)?(${DAY_RX})s?\\.?$`, 'i')))) { name = m[1]; f = 'weekly'; day = m[2].slice(0, 3).toLowerCase(); }
    else { name = line; f = 'daily'; }
    name = name.trim().slice(0, 30);
    if (!name || out.some((c) => c.k === name.toLowerCase())) continue;
    out.push({ name: cap(name), k: name.toLowerCase(), f, day, i: out.filter((c) => c.f === f).length });
  }
  return out;
}
function dayNum(date) { return Math.round(Date.parse(`${date}T00:00:00Z`) / 86400000); }
function mondayOf(d) { return addDays(d, -((DAYS.indexOf(dow(d)) + 6) % 7)); }
const slotOf = (ch, date) => (ch.f === 'daily' ? date : mondayOf(date));
/** Deterministic round robin: daily chores move one person per day, weekly ones one person per week. */
function rotation(ch, slot, P) {
  if (!P.length) return null;
  const idx = ch.f === 'daily' ? dayNum(slot) + ch.i : Math.floor((dayNum(slot) - 4) / 7) + ch.i;
  return P[((idx % P.length) + P.length) % P.length];
}
function assignee(ch, date, P, swaps) { const slot = slotOf(ch, date); return swaps[`${slot}|${ch.k}`] || rotation(ch, slot, P); }
function doneIn(ch, date, done) {
  const slot = slotOf(ch, date);
  const end = ch.f === 'daily' ? slot : addDays(slot, 6);
  return done.find((x) => x.c === ch.k && x.d >= slot && x.d <= end) || null;
}
const norm = (s) => String(s || '').toLowerCase().trim().replace(/^the\s+/, '').replace(/[^a-z0-9 ]/g, '').replace(/(?:es|s)$/, '');
function findChore(chores, words) {
  const q = norm(words);
  if (!q) return null;
  return chores.find((c) => norm(c.k) === q) || chores.find((c) => norm(c.k).includes(q) || q.includes(norm(c.k))) || null;
}
function findPerson(P, name) {
  const q = String(name || '').toLowerCase().trim();
  return P.find((p) => p.toLowerCase() === q) || P.find((p) => p.toLowerCase().split(' ')[0] === q.split(' ')[0]) || null;
}
const whenLabel = (ch, date) => (ch.f === 'daily' || ch.day === dow(date) ? 'today' : ch.day ? `this ${cap(ch.day)}` : 'this week');
function choreLines(chores, date, P, swaps, done) {
  const lines = [];
  for (const ch of chores) {
    const today = ch.f === 'daily' || ch.day === dow(date);
    const who = assignee(ch, date, P, swaps) || 'nobody yet';
    const d = doneIn(ch, date, done);
    const tick = d ? ` ✓ done by ${d.p}` : '';
    if (today) lines.push(`• ${ch.name}: ${who}${tick}`);
    else lines.push(`• ${ch.name} (${ch.day ? cap(ch.day) : 'this week'}): ${who}${tick}`);
  }
  return lines;
}
function weekScores(done, date, P) {
  const mon = mondayOf(date), sun = addDays(mon, 6);
  const counts = {};
  for (const p of P) counts[p] = 0;
  for (const x of done) if (x.d >= mon && x.d <= sun) counts[x.p] = (counts[x.p] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
const scoreText = (s) => s.map(([p, n], i) => `${i === 0 && n > 0 ? '🥇 ' : ''}${p} ${n}`).join(' · ');

// ---------- events ----------
function nextNum(arr) { const used = new Set(arr.map((x) => x.n)); let n = 1; while (used.has(n)) n++; return n; }
const evStamp = (e) => `${e.d}T${e.tm || '00:00'}`;
const evLine = (e, today) => `${e.n}. ${e.t}: ${pretty(e.d, today)}${e.tm ? ` ${e.tm}` : ''}${e.by ? ` (added by ${e.by})` : ''}`;
function minsUntil(fromStamp, toStamp) { return Math.round((Date.parse(`${toStamp}:00Z`) - Date.parse(`${fromStamp}:00Z`)) / 60000); }

// ---------- lists ----------
function listKey(name) {
  let k = String(name || '').toLowerCase().replace(/^(?:my|the|our)\s+/, '').replace(/\s+list$/, '').replace(/[^a-z0-9 '&-]/g, '').trim();
  if (k === 'grocery' || k === 'shopping' || k === 'list') k = 'groceries';
  return k.slice(0, 24);
}
function splitItems(s) { return String(s).split(/[,;\n]+/).map((x) => x.trim().replace(/\.$/, '')).filter(Boolean).slice(0, 30); }
const sameItem = (a, b) => norm(a) === norm(b);
function showList(name, arr) {
  if (!arr || !arr.length) return `${cap(name)} is empty. Say "add eggs${name === 'groceries' ? '' : ` to ${name}`}".`;
  const open = arr.filter((x) => !x.b), got = arr.filter((x) => x.b);
  const lines = open.map((x) => `• ${x.t}${x.by ? ` (${x.by})` : ''}`).concat(got.map((x) => `✓ ${x.t}, got by ${x.b}`));
  return `${name === 'groceries' ? '🛒' : '📋'} ${cap(name)}: ${open.length} to get${got.length ? `, ${got.length} got` : ''}\n${lines.join('\n')}${open.length ? `\nSay "bought ${open[0].t}" when you have it.` : '\nSay "clear bought" to tidy up.'}`;
}
const RESERVED = new Set(['event', 'events', 'chores', 'help', 'scores', 'note', 'swap', 'done', 'add']);

const HELP = `I'm the family hub. Anyone in the family can say:
• add eggs, milk (to groceries) · groceries · bought eggs · clear bought
• packing: passports (any list by name) · lists
• chores · who's on dishes? · done dishes
• swap dishes with Maya today
• event: dinner at grandma's sat 6pm · events
• scores (this week's chores per person)
Every morning at 07:30: today's chores and events (scores on Sundays). Events get a reminder the evening before and 2 hours ahead.`;

async function onMessage(ctx, M, L, P, chores) {
  const raw = String(ctx.input.text || '').trim();
  const t = raw.toLowerCase().replace(/[!.]+$/, '').trim();
  const from = cap(String(ctx.input.from || 'Someone').trim().split(/\s+/)[0] || 'Someone');
  const me = findPerson(P, from) || from;
  const today = L.date;
  const say = (s) => ctx.reply(s);

  const seen = await M.get('seen', []);
  if (ctx.input.from && !seen.includes(me)) { seen.push(me); M.set('seen', seen.slice(-12)); }
  if (!P.length) P = seen.slice();

  if (!t || /^(help|\?|what can you do|commands|hi|hello|hey)$/.test(t)) return say(HELP);

  // Events
  let m = raw.match(/^(?:event|add event|new event|plan)\s*[:\-]?\s+(.+)$/is) || raw.match(/^event\s*:\s*(.+)$/is);
  if (m) {
    const w = parseWhen(m[1], L);
    const title = cap(tidy(w.rest)).slice(0, 120);
    if (!title) return say('What\'s the event? e.g. "event: dinner at grandma\'s sat 6pm".');
    if (!w.date && !w.time) return say(`When is "${title}"? e.g. "event: ${title} sat 6pm".`);
    let date = w.date || (w.time > L.time ? today : addDays(today, 1));
    if (w.wk && `${date}T${w.time || '23:59'}` <= stampOf(L)) date = addDays(date, 7);
    if (`${date}T${w.time || '23:59'}` < stampOf(L)) return say(`${pretty(date, today)}${w.time ? ` ${w.time}` : ''} has already passed. When is it?`);
    const events = await M.get('events', []);
    const e = { n: nextNum(events), t: title, d: date };
    if (w.time) e.tm = w.time;
    e.by = me;
    // Reminders whose moment already passed are not sent late.
    if (date <= today || (date === addDays(today, 1) && L.hour >= 19)) e.e = 1;
    if (w.time && minsUntil(stampOf(L), evStamp(e)) <= 120) e.h = 1;
    events.push(e);
    M.set('events', events.slice(-200));
    const rem = [];
    if (!e.e) rem.push('the evening before');
    if (e.tm && !e.h) rem.push('2 hours before');
    return say(`📅 Added: ${e.t}, ${pretty(e.d, today)}${e.tm ? ` at ${e.tm}` : ''}.${rem.length ? ` I'll remind everyone ${rem.join(' and ')}.` : ''}`);
  }
  if (/^(events|calendar|what'?s coming up|upcoming|plans)$/.test(t)) {
    const events = (await M.get('events', [])).filter((e) => e.d >= today).sort((a, b) => evStamp(a).localeCompare(evStamp(b)));
    if (!events.length) return say('No upcoming events. Add one: "event: dinner at grandma\'s sat 6pm".');
    return say(`📅 Coming up (${events.length}):\n${events.slice(0, 15).map((e) => evLine(e, today)).join('\n')}\nSay "cancel event 2" to remove one.`);
  }
  m = t.match(/^(?:cancel|delete|remove)\s+event\s+#?(.+)$/);
  if (m) {
    const events = await M.get('events', []);
    const e = /^\d+$/.test(m[1]) ? events.find((x) => x.n === +m[1]) : events.find((x) => x.t.toLowerCase().includes(m[1]));
    if (!e) return say(`I couldn't find event "${m[1]}". Say "events" to see them.`);
    events.splice(events.indexOf(e), 1);
    M.set('events', events);
    return say(`🗑 Cancelled: ${e.t} (${pretty(e.d, today)}${e.tm ? ` ${e.tm}` : ''}).`);
  }

  // Chores
  const swaps = await M.get('swaps', {});
  const done = await M.get('done', []);
  if (/^(chores|today'?s chores|what are the chores|rota|chore list)$/.test(t)) {
    if (!chores.length) return say('No chores set up. Add them under Settings, one per line, e.g. "Dishes daily" or "Trash weekly mon".');
    const pplNote = P.length ? '' : '\n(Add family names under Settings so I can share chores out.)';
    return say(`🧹 Chores, ${longDate(today)}:\n${choreLines(chores, today, P, swaps, done).join('\n')}${pplNote}\nSay "done dishes" when finished.`);
  }
  // "today", "tomorrow", "saturday", "next week" → which day (or week) a chore question is about.
  const whenOf = (ch, words) => {
    const w = parseWhen(String(words || '').replace(/\bthis week\b/, ''), L);
    const date = w.date && w.date >= today ? w.date : today;
    const label = date === today ? whenLabel(ch, today) : ch.f === 'weekly' ? (mondayOf(date) === mondayOf(today) ? 'this week' : `the week of ${longDate(mondayOf(date))}`) : pretty(date, today);
    return { date, label };
  };
  m = t.match(/^who(?:'s| is|s)\s+(?:on|doing|got)\s+(?:the\s+)?(.+?)\??$/);
  if (m) {
    const w = parseWhen(m[1], L);
    const ch = findChore(chores, w.rest);
    if (!ch) return say(`"${w.rest || m[1]}" isn't one of the chores (${chores.map((c) => c.name).join(', ') || 'none set'}).`);
    const { date, label } = whenOf(ch, m[1]);
    const who = assignee(ch, date, P, swaps);
    if (!who) return say('Add family names under Settings so I can share the chores out.');
    const d = doneIn(ch, date, done);
    return say(`${ch.name} ${label}: ${who}.${d && date <= today ? ` ✓ Already done by ${d.p}.` : ''}`);
  }
  m = t.match(/^swap\s+(?:the\s+)?(.+?)\s+with\s+([a-z][\w'-]*)(?:\s+(.+))?$/);
  if (m) {
    const ch = findChore(chores, m[1]);
    if (!ch) return say(`"${m[1]}" isn't one of the chores (${chores.map((c) => c.name).join(', ') || 'none set'}).`);
    const other = findPerson(P, m[2]);
    if (!other) return say(`I don't know ${cap(m[2])}. The family list is: ${P.join(', ') || 'empty (add names under Settings)'}.`);
    const { date, label: when } = whenOf(ch, m[3]);
    const slot = slotOf(ch, date);
    const cur = assignee(ch, date, P, swaps);
    if (cur === other) return say(`${other} is already on ${ch.name.toLowerCase()} ${when}.`);
    if (P.includes(me) && cur !== me) return say(`${ch.name} ${when} is ${cur}'s turn, not yours. ${cur} can say "swap ${ch.k} with ${other}".`);
    if (doneIn(ch, date, done)) return say(`${ch.name} is already done ${when}.`);
    // Fair trade: the other person takes this turn, and their next own turn goes to the person they swapped with.
    let back = null;
    for (let k = 1; k <= 60 && !back; k++) {
      const s2 = ch.f === 'daily' ? addDays(slot, k) : addDays(slot, 7 * k);
      if (!swaps[`${s2}|${ch.k}`] && rotation(ch, s2, P) === other) back = s2;
    }
    swaps[`${slot}|${ch.k}`] = other;
    if (back) swaps[`${back}|${ch.k}`] = cur;
    const cut = addDays(today, -14);
    for (const k of Object.keys(swaps)) if (k.slice(0, 10) < cut) delete swaps[k];
    M.set('swaps', swaps);
    return say(`🔄 Swapped: ${other} does ${ch.name.toLowerCase()} ${when}${back ? `, and ${cur} takes ${other}'s turn ${ch.f === 'daily' ? pretty(back, today) : `the week of ${longDate(back)}`}` : ''}.`);
  }
  m = t.match(/^(?:done|did|finished|i did|we did)\s+(?:the\s+)?(.+)$/);
  if (m) {
    const ch = findChore(chores, m[1]);
    if (ch) {
      const already = doneIn(ch, today, done);
      if (already) return say(`${ch.name} was already done ${ch.f === 'daily' ? 'today' : 'this week'} by ${already.p} ✓`);
      const who = assignee(ch, today, P, swaps);
      done.push({ d: today, c: ch.k, p: me });
      const cut = addDays(today, -56);
      M.set('done', done.filter((x) => x.d >= cut).slice(-1000));
      const mine = weekScores(done, today, P).find(([p]) => p === me);
      return say(`✓ ${ch.name} done. Credit to ${me} (${mine ? mine[1] : 1} this week).${who && who !== me ? ` It was ${who}'s turn. Nice of you!` : ''}`);
    }
    const task = m[1].replace(/[^\w '-]/g, '').trim().slice(0, 30).toLowerCase();
    if (!task) return say('Done what? e.g. "done dishes".');
    done.push({ d: today, c: task, p: me, x: 1 });
    M.set('done', done.slice(-1000));
    return say(`✓ Logged "${task}" for ${me}. It isn't on the chore list (${chores.map((c) => c.name.toLowerCase()).join(', ')}), but it counts in this week's scores.`);
  }
  if (/^(scores?|scoreboard|leaderboard|points|who did the most)$/.test(t)) {
    const s = weekScores(done, today, P);
    if (!s.length) return say('No chores logged this week yet. Say "done dishes" when you finish one.');
    return say(`🏆 Chores done this week (since ${longDate(mondayOf(today))}): ${scoreText(s)}`);
  }

  // Lists
  const lists = await M.get('lists', {});
  if (/^lists$/.test(t)) {
    const names = Object.keys(lists);
    return say(names.length ? `Lists: ${names.map((k) => `${k} (${lists[k].filter((x) => !x.b).length})`).join(', ')}.` : 'No lists yet. Say "add eggs" or "packing: passports".');
  }
  const addTo = (name, words) => {
    const arr = lists[name] || [];
    const added = [];
    for (const x of splitItems(words)) {
      const have = arr.find((y) => sameItem(y.t, x));
      if (have && !have.b) continue;
      if (have) arr.splice(arr.indexOf(have), 1);
      if (arr.length >= 200) break;
      arr.push({ t: x.slice(0, 80), by: me });
      added.push(x);
    }
    lists[name] = arr;
    M.set('lists', lists);
    const open = arr.filter((x) => !x.b);
    return say(`${added.length ? `Added ${added.join(', ')} to ${name}.` : `Already on ${name}.`} ${open.length} to get: ${open.map((x) => x.t).join(', ')}.`);
  };
  m = raw.match(/^(?:add|we need|need|get)\s+(.+?)(?:\s+(?:to|on)\s+(?:the\s+|our\s+|my\s+)?([a-z][a-z0-9 '&-]{0,24}?)(?:\s+list)?)?\s*$/is);
  if (m) return addTo(listKey(m[2] || 'groceries'), m[1]);
  m = raw.match(/^([a-z][a-z0-9 '&-]{0,24}?)(?:\s+list)?\s*:\s*(.+)$/is);
  if (m && !RESERVED.has(m[1].toLowerCase().trim())) return addTo(listKey(m[1]), m[2]);
  m = t.match(/^clear\s+(?:the\s+)?(?:bought|got|done|ticked)(?:\s+(?:from|on)\s+(?:the\s+)?(.+?))?(?:\s+list)?$/);
  if (m) {
    const names = m[1] ? [listKey(m[1])] : Object.keys(lists);
    let n = 0;
    for (const k of names) if (lists[k]) { const before = lists[k].length; lists[k] = lists[k].filter((x) => !x.b); n += before - lists[k].length; }
    M.set('lists', lists);
    return say(n ? `Cleared ${n} bought item${n === 1 ? '' : 's'}. ${names.map((k) => `${k}: ${(lists[k] || []).length} left`).join(', ')}.` : 'Nothing marked bought yet.');
  }
  m = t.match(/^(?:clear|empty|delete)\s+(?:the\s+)?(.+?)(?:\s+list)?$/);
  if (m && lists[listKey(m[1])]) {
    const k = listKey(m[1]);
    const n = lists[k].length;
    delete lists[k];
    M.set('lists', lists);
    return say(`Cleared the ${k} list (${n} item${n === 1 ? '' : 's'}).`);
  }
  m = raw.match(/^(bought|got|picked up|packed|have|remove|delete|drop)\s+(.+?)(?:\s+(?:from|off|on)\s+(?:the\s+)?(.+?)(?:\s+list)?)?\s*$/is);
  if (m) {
    const bought = !/^(remove|delete|drop)$/i.test(m[1]);
    const names = m[3] ? [listKey(m[3])] : Object.keys(lists);
    const hit = [], miss = [];
    for (const x of splitItems(m[2])) {
      let found = false;
      for (const k of names) {
        const it = (lists[k] || []).find((y) => sameItem(y.t, x) && (!bought || !y.b));
        if (it) { if (bought) it.b = me; else lists[k].splice(lists[k].indexOf(it), 1); hit.push(it.t); found = true; break; }
      }
      if (!found) miss.push(x);
    }
    if (hit.length) M.set('lists', lists);
    const left = names.filter((k) => lists[k]).map((k) => `${k}: ${lists[k].filter((y) => !y.b).length} left`).join(', ');
    if (!hit.length) return say(`${miss.join(', ')} ${miss.length === 1 ? 'isn\'t' : 'aren\'t'} on ${m[3] ? listKey(m[3]) : 'any list'}. Say "groceries" to see it.`);
    return say(`${bought ? `✓ ${me} got` : '🗑 Removed'} ${hit.join(', ')}.${miss.length ? ` (Not on a list: ${miss.join(', ')}.)` : ''} ${left}.`);
  }
  const k = listKey(t);
  if (lists[k] || k === 'groceries') return say(showList(k, lists[k]));

  return say(`I didn't catch "${raw.slice(0, 60)}". Try "add eggs", "chores", "done dishes", "who's on trash?", "event: dinner sat 6pm" or "help".`);
}

async function daily(ctx, M, L, P, chores) {
  const today = L.date;
  const swaps = await M.get('swaps', {});
  const done = await M.get('done', []);
  const events = await M.get('events', []);
  const lines = [];
  const todays = chores.filter((c) => c.f === 'daily' || c.day === dow(today) || (!c.day && dow(today) === 'mon'));
  if (todays.length) {
    lines.push('🧹 Chores today:');
    for (const ch of todays) { const d = doneIn(ch, today, done); lines.push(`• ${ch.name}: ${assignee(ch, today, P, swaps) || 'nobody yet (add names in Settings)'}${ch.f === 'weekly' && !ch.day ? ' (this week)' : ''}${d ? ` ✓ done by ${d.p}` : ''}`); }
  }
  const ev = events.filter((e) => e.d === today).sort((a, b) => evStamp(a).localeCompare(evStamp(b)));
  if (ev.length) lines.push(`📅 Today: ${ev.map((e) => `${e.tm || 'all day'} ${e.t}`).join(' · ')}`);
  const lists = await M.get('lists', {});
  const groc = (lists.groceries || []).filter((x) => !x.b);
  if (lines.length && groc.length) lines.push(`🛒 Groceries: ${groc.length} to get (${groc.slice(0, 5).map((x) => x.t).join(', ')}${groc.length > 5 ? '…' : ''})`);
  if (dow(today) === 'sun') {
    const s = weekScores(done, today, P);
    if (s.some(([, n]) => n > 0)) lines.push(`🏆 This week's chores: ${scoreText(s)}`);
  }
  if (!lines.length) { ctx.log('Nothing for the family today.'); return; }
  await ctx.notify({ title: `🏡 ${longDate(today)}${ev.length ? `: ${ev.length} event${ev.length === 1 ? '' : 's'}` : ''}`, body: lines.join('\n') });
}

async function eventReminders(ctx, M, L) {
  const events = await M.get('events', []);
  const now = stampOf(L), tom = addDays(L.date, 1);
  let changed = false;
  for (const e of events) {
    if (e.d < L.date) continue;
    if (!e.e && e.d === tom && L.hour >= 19) {
      await ctx.notify({ title: `📅 Tomorrow: ${e.t}`, body: `${e.t} is tomorrow (${longDate(e.d)})${e.tm ? ` at ${e.tm}` : ''}.${e.by ? ` Added by ${e.by}.` : ''}` });
      e.e = 1; changed = true;
    }
    if (e.tm && !e.h) {
      const mins = minsUntil(now, evStamp(e));
      if (mins > 0 && mins <= 120) {
        await ctx.notify({ title: `⏰ At ${e.tm}: ${e.t}`, body: `${e.t} starts at ${e.tm}, in ${mins >= 90 ? 'about 2 hours' : mins >= 45 ? 'about an hour' : `${mins} minutes`}.` });
        e.h = 1; changed = true;
      }
    }
  }
  const cut = addDays(L.date, -7);
  const keep = events.filter((e) => e.d >= cut);
  if (changed || keep.length !== events.length) M.set('events', keep);
}

async function run(ctx) {
  const L = ctx.local();
  const M = store(ctx);
  let P = parsePeople(ctx.settings.people);
  const chores = parseChores(ctx.settings.chores);
  const type = ctx.trigger.type;
  if (type === 'message') { await onMessage(ctx, M, L, P, chores); await M.save(); return; }
  if (!P.length) P = await M.get('seen', []);
  const sent = await M.get('sent', {});
  const dailyDue = sent.daily !== L.date && (type !== 'interval' || (L.time >= '07:30' && L.time < '10:30'));
  if (dailyDue) {
    await daily(ctx, M, L, P, chores);
    sent.daily = L.date;
    M.set('sent', sent);
  }
  await eventReminders(ctx, M, L);
  await M.save();
}
