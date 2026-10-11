// Chief of Staff: reminders, tasks, lists, notes, a morning brief and an evening wrap.
// Everything is local wall-clock time ("YYYY-MM-DDTHH:MM") from ctx.local().

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_RX = 'sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:s|nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?';
const MONTH_RX = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const MAX_ITEMS = 500;

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

// ---------- repeating ----------
function takeRepeat(text) {
  const re = new RegExp(`\\b(?:every|each)\\s+((?:(?:day|weekdays?|weekends?|morning|evening|night|${DAY_RX})s?\\b(?:\\s*(?:,|and|&|/)\\s*|\\s+)?)+)`, 'i');
  let m = text.match(re), words;
  if (m) words = m[1];
  else { m = text.match(/\b(daily|weekdays|weekends)\b/i); if (m) words = m[1]; }
  if (!m) return null;
  const w = words.toLowerCase();
  let rep, tm = null;
  if (/weekday/.test(w)) rep = 'weekdays';
  else if (/weekend/.test(w)) rep = 'weekends';
  else if (/\b(day|daily|morning|evening|night)\b/.test(w)) {
    rep = 'daily';
    if (/morning/.test(w)) tm = '09:00'; else if (/evening/.test(w)) tm = '18:00'; else if (/night/.test(w)) tm = '21:00';
  } else {
    const list = [];
    for (const x of w.match(new RegExp(DAY_RX, 'gi')) || []) { const d = x.slice(0, 3); if (!list.includes(d)) list.push(d); }
    list.sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b));
    rep = list.join(',');
  }
  if (!rep) return null;
  return { rep, tm, rest: `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}` };
}
function repMatches(rep, date) {
  const d = dow(date);
  if (rep === 'daily') return true;
  if (rep === 'weekdays') return d !== 'sat' && d !== 'sun';
  if (rep === 'weekends') return d === 'sat' || d === 'sun';
  return rep.split(',').includes(d);
}
function nextOcc(rep, tm, after) {
  for (let i = 0; i < 9; i++) {
    const d = addDays(after.slice(0, 10), i);
    if (repMatches(rep, d) && `${d}T${tm}` > after) return `${d}T${tm}`;
  }
  return `${addDays(after.slice(0, 10), 1)}T${tm}`;
}
function repText(rep) {
  if (rep === 'daily') return 'every day';
  if (rep === 'weekdays') return 'every weekday';
  if (rep === 'weekends') return 'every weekend day';
  return `every ${rep.split(',').map(cap).join(', ')}`;
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
function nextNum(items) { const used = new Set(items.map((x) => x.n)); let n = 1; while (used.has(n)) n++; return n; }
function itemLine(it, today) {
  if (it.k === 'r') {
    if (it.rep) return `${it.n}. 🔁 ${it.t} — ${repText(it.rep)} ${it.tm} (next ${prettyStamp(it.due, today)})`;
    return `${it.n}. ⏰ ${it.t} — ${prettyStamp(it.due, today)}${it.sent === it.due ? ' (reminded)' : ''}`;
  }
  return `${it.n}. ☐ ${it.t}${it.by ? ` — ${it.by < today ? 'overdue, was due' : 'by'} ${pretty(it.by, today)}` : ''}`;
}
function sortItems(items) {
  const key = (x) => (x.k === 'r' ? x.due : x.by ? `${x.by}T99` : '9999');
  return items.slice().sort((a, b) => key(a).localeCompare(key(b)) || a.n - b.n);
}
function findItems(items, q) {
  const s = q.toLowerCase().trim();
  if (/^\d+$/.test(s)) return items.filter((x) => x.n === +s);
  const exact = items.filter((x) => x.t.toLowerCase() === s);
  if (exact.length) return exact;
  const inc = items.filter((x) => x.t.toLowerCase().includes(s));
  if (inc.length) return inc;
  const words = s.split(/\s+/).filter((w) => w.length > 1);
  return words.length ? items.filter((x) => words.every((w) => x.t.toLowerCase().includes(w))) : [];
}
function logDone(log, date, t) { log.push({ d: date, t }); while (log.length > 300) log.shift(); }

// ---------- weather (Open-Meteo, no key) ----------
function wmo(c) {
  if (c === 0) return 'clear';
  if (c <= 2) return 'partly cloudy';
  if (c === 3) return 'cloudy';
  if (c === 45 || c === 48) return 'fog';
  if (c >= 51 && c <= 57) return 'drizzle';
  if (c >= 61 && c <= 67) return c >= 65 ? 'heavy rain' : 'rain';
  if (c >= 71 && c <= 77) return 'snow';
  if (c >= 80 && c <= 82) return 'showers';
  if (c >= 85 && c <= 86) return 'snow showers';
  if (c >= 95) return 'thunderstorms';
  return '';
}
async function getJson(ctx, url) {
  let r;
  try { r = await ctx.http.get(url); } catch (e) { return { err: 'no connection' }; }
  if (r.status !== 200) return { err: `status ${r.status}` };
  try { return { j: JSON.parse(r.text) }; } catch (e) { return { err: 'unreadable reply' }; }
}
async function weatherLine(ctx, M) {
  const city = String(ctx.settings.city || '').trim();
  if (!city) return null;
  const q = city.toLowerCase();
  let geo = await M.get('geo', null);
  if (!geo || geo.q !== q) {
    const g = await getJson(ctx, `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city.split(',')[0].trim())}&count=1`);
    if (g.err) return '🌤 Weather unavailable right now.';
    const hit = g.j && Array.isArray(g.j.results) ? g.j.results[0] : null;
    if (!hit || typeof hit.latitude !== 'number' || typeof hit.longitude !== 'number') {
      M.set('geo', { q, miss: 1 });
      return `🌤 I couldn't find "${city}". Check the city in settings.`;
    }
    geo = { q, lat: hit.latitude, lon: hit.longitude, name: hit.name || city };
    M.set('geo', geo);
  }
  if (geo.miss) return `🌤 I couldn't find "${city}". Check the city in settings.`;
  const f = await getJson(ctx, `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode&timezone=auto&forecast_days=1`);
  const d = f.j && f.j.daily;
  if (f.err || !d || !Array.isArray(d.temperature_2m_max) || typeof d.temperature_2m_max[0] !== 'number') return '🌤 Weather unavailable right now.';
  const hi = Math.round(d.temperature_2m_max[0]), lo = Math.round(d.temperature_2m_min[0]);
  const rain = Array.isArray(d.precipitation_probability_max) ? d.precipitation_probability_max[0] : null;
  const sky = Array.isArray(d.weathercode) ? wmo(d.weathercode[0]) : '';
  return `🌤 ${geo.name}: ${lo}–${hi}°C${sky ? `, ${sky}` : ''}${typeof rain === 'number' ? `, ${rain}% chance of rain` : ''}${rain >= 50 ? '. Take an umbrella.' : ''}`;
}

// ---------- calendar (iCal) ----------
function unfold(t) { return String(t || '').replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, ''); }
function icsText(v) { return String(v).replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim(); }
function wallIn(ms, tz) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(ms));
  const g = (t) => (p.find((x) => x.type === t) || {}).value;
  return `${g('year')}-${g('month')}-${g('day')}T${pad(Number(g('hour')) % 24)}:${g('minute')}`;
}
function utcOfWall(wall, tz) {
  const guess = Date.parse(`${wall}:00Z`);
  const off = Date.parse(`${wallIn(guess, tz)}:00Z`) - guess;
  let ms = guess - off;
  const off2 = Date.parse(`${wallIn(ms, tz)}:00Z`) - ms;
  if (off2 !== off) ms = guess - off2;
  return ms;
}
function parseDt(params, value) {
  const m = String(value).trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{0,2}(Z)?)?$/);
  if (!m) return null;
  const tz = (String(params).match(/TZID=("?)([^;:"]+)\1/i) || [])[2];
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: m[4] ? `${m[4]}:${m[5]}` : null, z: !!m[6], tzid: tz || null };
}
/** Owner-local "YYYY-MM-DDTHH:MM" for a timed DTSTART (wall date/time in its own zone). */
function toLocal(date, time, dt, tz) {
  const wall = `${date}T${time}`;
  try {
    if (dt.z) return wallIn(Date.parse(`${wall}:00Z`), tz);
    if (dt.tzid) return wallIn(utcOfWall(wall, dt.tzid), tz);
  } catch (e) { /* unknown zone name: treat as the owner's local time */ }
  return wall;
}
const BYDAY = { SU: 'sun', MO: 'mon', TU: 'tue', WE: 'wed', TH: 'thu', FR: 'fri', SA: 'sat' };
function mondayOf(d) { return addDays(d, -((DAYS.indexOf(dow(d)) + 6) % 7)); }
function daysInMonth(d) { return new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7), 0)).getUTCDate(); }
function ruleMatch(r, s, x) {
  const iv = Math.max(1, Number(r.INTERVAL) || 1);
  const by = r.BYDAY ? r.BYDAY.split(',').map((b) => { const m = b.trim().match(/^([+-]?\d+)?([A-Z]{2})$/); return m ? { n: m[1] ? +m[1] : 0, d: BYDAY[m[2]] } : null; }).filter(Boolean) : null;
  const day = +x.slice(8, 10);
  switch (r.FREQ) {
    case 'DAILY': return daysBetween(s, x) % iv === 0 && (!by || by.some((b) => b.d === dow(x)));
    case 'WEEKLY': {
      const days = by && by.length ? by.map((b) => b.d) : [dow(s)];
      return days.includes(dow(x)) && Math.floor(daysBetween(mondayOf(s), mondayOf(x)) / 7) % iv === 0;
    }
    case 'MONTHLY': {
      const months = (+x.slice(0, 4) - +s.slice(0, 4)) * 12 + (+x.slice(5, 7) - +s.slice(5, 7));
      if (months % iv !== 0) return false;
      if (by && by.length) return by.some((b) => b.d === dow(x) && (b.n === 0 || (b.n > 0 ? Math.ceil(day / 7) === b.n : day + 7 * (-b.n - 1) + 7 > daysInMonth(x) && day + 7 * (-b.n - 1) <= daysInMonth(x))));
      if (r.BYMONTHDAY) { const md = +r.BYMONTHDAY.split(',')[0]; return md > 0 ? day === md : day === daysInMonth(x) + md + 1; }
      return day === +s.slice(8, 10);
    }
    case 'YEARLY': {
      if ((+x.slice(0, 4) - +s.slice(0, 4)) % iv !== 0) return false;
      const mo = r.BYMONTH ? +r.BYMONTH.split(',')[0] : +s.slice(5, 7);
      return +x.slice(5, 7) === mo && day === +s.slice(8, 10);
    }
    default: return false;
  }
}
function occurs(r, s, x) {
  if (x < s) return false;
  if (r.UNTIL && x > `${r.UNTIL.slice(0, 4)}-${r.UNTIL.slice(4, 6)}-${r.UNTIL.slice(6, 8)}`) return false;
  if (!ruleMatch(r, s, x)) return false;
  if (r.COUNT) {
    let n = 0;
    for (let d = s, i = 0; d <= x && i < 3700; d = addDays(d, 1), i++) if (ruleMatch(r, s, d)) n++;
    return n <= Number(r.COUNT);
  }
  return true;
}
/** Events on the owner's local dates in `dates`: { date: [{ time, title }] }. */
function icsEvents(text, dates, tz) {
  const want = new Set(dates);
  const out = {};
  for (const d of dates) out[d] = [];
  const blocks = unfold(text).split('BEGIN:VEVENT').slice(1).map((b) => b.split('END:VEVENT')[0]);
  const evs = [];
  const moved = new Set();
  for (const b of blocks.slice(0, 3000)) {
    const ev = { ex: [] };
    for (const line of b.split('\n')) {
      const m = line.match(/^([A-Z-]+)([^:]*):(.*)$/);
      if (!m) continue;
      const [, name, params, value] = m;
      if (name === 'DTSTART') ev.start = parseDt(params, value);
      else if (name === 'DTEND') ev.end = parseDt(params, value);
      else if (name === 'SUMMARY') ev.title = icsText(value);
      else if (name === 'UID') ev.uid = value.trim();
      else if (name === 'STATUS') ev.status = value.trim().toUpperCase();
      else if (name === 'RRULE') { ev.rule = {}; for (const kv of value.split(';')) { const [k, v] = kv.split('='); if (k && v) ev.rule[k.toUpperCase()] = v.toUpperCase(); } }
      else if (name === 'EXDATE') for (const v of value.split(',')) { const p = parseDt(params, v); if (p) ev.ex.push(p.date); }
      else if (name === 'RECURRENCE-ID') { const p = parseDt(params, value); if (p) ev.rec = p.date; }
    }
    if (!ev.start) continue;
    if (ev.rec && ev.uid) moved.add(`${ev.uid}|${ev.rec}`);
    evs.push(ev);
  }
  for (const ev of evs) {
    if (ev.status === 'CANCELLED') continue;
    const title = ev.title || 'Untitled event';
    const st = ev.start;
    const add = (date, time) => { if (want.has(date) && !out[date].some((x) => x.time === time && x.title === title)) out[date].push({ time, title }); };
    const recurring = ev.rule && ev.rule.FREQ && !ev.rec;
    if (!st.time) {
      const len = ev.end && !ev.end.time ? Math.max(1, daysBetween(st.date, ev.end.date)) : 1;
      for (const d of dates) {
        if (recurring) { if (occurs(ev.rule, st.date, d) && !ev.ex.includes(d) && !moved.has(`${ev.uid}|${d}`)) add(d, null); }
        else { const k = daysBetween(st.date, d); if (k >= 0 && k < len) add(d, null); }
      }
      continue;
    }
    if (!recurring) { const loc = toLocal(st.date, st.time, st, tz); add(loc.slice(0, 10), loc.slice(11)); continue; }
    const cands = new Set();
    for (const d of dates) for (const k of [-1, 0, 1]) cands.add(addDays(d, k));
    for (const od of cands) {
      if (!occurs(ev.rule, st.date, od) || ev.ex.includes(od) || moved.has(`${ev.uid}|${od}`)) continue;
      const loc = toLocal(od, st.time, st, tz);
      add(loc.slice(0, 10), loc.slice(11));
    }
  }
  for (const d of dates) out[d].sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
  return out;
}
async function calendar(ctx, L, dates) {
  const url = String(ctx.settings.icsUrl || '').trim().replace(/^webcal:\/\//i, 'https://');
  if (!url) return null;
  if (!/^https:\/\//i.test(url)) return { err: 'the calendar address must start with https://' };
  let r;
  try { r = await ctx.http.get(url); } catch (e) { return { err: 'could not reach it' }; }
  if (r.status !== 200) return { err: `status ${r.status}` };
  if (!/BEGIN:VCALENDAR/i.test(r.text)) return { err: 'that address did not return a calendar' };
  try { return { days: icsEvents(r.text, dates, L.tz) }; } catch (e) { return { err: 'could not read it' }; }
}
const evText = (e) => `${e.time || 'All day'} ${e.title}`;

// ---------- the day ----------
async function dayLines(ctx, M, L, date, opts) {
  const today = L.date;
  const items = await M.get('items', []);
  const lines = [];
  let content = 0;
  if (opts.weather) { const w = await weatherLine(ctx, M); if (w) { lines.push(w); content++; } }
  const cal = await calendar(ctx, L, [date]);
  if (cal && cal.err) lines.push(`📅 Couldn't read your calendar (${cal.err}).`);
  else if (cal) {
    const ev = cal.days[date] || [];
    if (ev.length) { lines.push(`📅 ${ev.length} event${ev.length === 1 ? '' : 's'}: ${ev.slice(0, 8).map(evText).join(' · ')}`); content++; } else lines.push('📅 Nothing on the calendar.');
  }
  const rem = sortItems(items.filter((x) => x.k === 'r' && x.due.slice(0, 10) === date && !(x.sent === x.due)));
  if (rem.length) { lines.push(`⏰ Reminders: ${rem.map((x) => `${x.due.slice(11)} ${x.t}`).join(' · ')}`); content++; }
  const tasks = items.filter((x) => x.k === 't');
  const overdue = sortItems(tasks.filter((x) => x.by && x.by < date));
  const soon = sortItems(tasks.filter((x) => x.by && x.by >= date && x.by <= addDays(date, 3)));
  if (overdue.length) { lines.push(`⚠️ Overdue: ${overdue.map((x) => `${x.t} (was due ${pretty(x.by, today)})`).join(' · ')}`); content++; }
  if (soon.length) { lines.push(`🗓 Due soon: ${soon.map((x) => `${x.t} (${pretty(x.by, today)})`).join(' · ')}`); content++; }
  const other = tasks.length - overdue.length - soon.length;
  if (other > 0) lines.push(`☐ ${other} other open task${other === 1 ? '' : 's'}.`);
  if (opts.top) {
    const top = await M.get('top', null);
    if (top && top.d === date && top.l.length) lines.push(`🎯 Top ${top.l.length}: ${top.l.join(' · ')}`);
    else lines.push('🎯 What are your top 3 today? Reply "top 3: a; b; c".');
  }
  return { lines, content };
}

async function morningBrief(ctx, M, L) {
  const { lines, content } = await dayLines(ctx, M, L, L.date, { weather: true, top: true });
  if (!content) { ctx.log('Morning brief: nothing to say today.'); return; }
  await ctx.notify({ title: `☀️ Good morning: ${longDate(L.date)}`, body: lines.join('\n') });
}

async function eveningWrap(ctx, M, L) {
  const items = await M.get('items', []);
  const log = await M.get('log', []);
  const tom = addDays(L.date, 1);
  const done = log.filter((x) => x.d === L.date);
  const open = sortItems(items.filter((x) => x.k === 't' || (x.k === 'r' && !x.rep && x.sent === x.due)));
  const lines = [];
  if (done.length) lines.push(`✅ Done today (${done.length}): ${done.map((x) => x.t).join(' · ')}`);
  if (open.length) lines.push(`📝 Still open (${open.length}): ${open.slice(0, 6).map((x) => `${x.n}. ${x.t}`).join(' · ')}${open.length > 6 ? ' …' : ''}`);
  const cal = await calendar(ctx, L, [tom]);
  if (cal && cal.err) lines.push(`📅 Couldn't read your calendar (${cal.err}).`);
  else if (cal && (cal.days[tom] || []).length) {
    const ev = cal.days[tom];
    const first = ev.find((e) => e.time) || ev[0];
    lines.push(`📅 Tomorrow first: ${evText(first)}${ev.length > 1 ? ` (+${ev.length - 1} more)` : ''}`);
  }
  const rem = sortItems(items.filter((x) => x.k === 'r' && x.due.slice(0, 10) === tom));
  if (rem.length) lines.push(`⏰ Tomorrow: ${rem.map((x) => `${x.due.slice(11)} ${x.t}`).join(' · ')}`);
  if (!lines.length) { ctx.log('Evening wrap: nothing to report.'); return; }
  await ctx.notify({ title: `🌙 Evening wrap: ${done.length} done, ${open.length} open`, body: lines.join('\n') });
}

async function fireReminders(ctx, M, L) {
  const now = stampOf(L);
  const items = await M.get('items', []);
  const due = sortItems(items.filter((x) => x.k === 'r' && x.due <= now && x.sent !== x.due));
  if (!due.length) return;
  for (const it of due.slice(0, 4)) {
    const next = it.rep ? nextOcc(it.rep, it.tm, now) : null;
    const late = Math.round((Date.parse(`${now}:00Z`) - Date.parse(`${it.due}:00Z`)) / 60000) > 60 ? ` (was due ${prettyStamp(it.due, L.date)})` : '';
    await ctx.notify({
      title: `⏰ ${it.t}`,
      body: it.rep ? `${cap(repText(it.rep))} at ${it.tm}${late}. Next: ${prettyStamp(next, L.date)}. Reply "snooze ${it.n} 30m" if now's not good.`
        : `Reminder for ${it.due.slice(11)}${late}. Reply "done ${it.n}" when it's done, or "snooze ${it.n} 30m".`,
    });
  }
  if (due.length > 4) await ctx.notify({ title: `⏰ ${due.length - 4} more reminders`, body: due.slice(4).map((x) => `${x.n}. ${x.t}`).join('\n') });
  for (const it of due) { it.sent = it.due; if (it.rep) it.due = nextOcc(it.rep, it.tm, now); }
  M.set('items', items);
}

async function housekeeping(M, L) {
  const items = await M.get('items', []);
  const cut = addDays(L.date, -2);
  const keep = items.filter((x) => !(x.k === 'r' && !x.rep && x.sent === x.due && x.due.slice(0, 10) < cut));
  if (keep.length !== items.length) M.set('items', keep);
  const log = await M.get('log', []);
  const old = addDays(L.date, -60);
  if (log.length && log[0].d < old) M.set('log', log.filter((x) => x.d >= old));
}

// ---------- lists ----------
function listKey(name) {
  let k = String(name || '').toLowerCase().replace(/^(?:my|the|our)\s+/, '').replace(/\s+list$/, '').replace(/[^a-z0-9 '&-]/g, '').trim();
  if (k === 'grocery' || k === 'groceries list' || k === 'grocery list') k = 'groceries';
  if (k === 'shopping list') k = 'shopping';
  return k.slice(0, 24);
}
const RESERVED = new Set(['note', 'notes', 'todo', 'to-do', 'task', 'tasks', 'top', 'remind', 'reminder', 'list', 'lists', 'done', 'delete', 'snooze', 'help', 'today', 'tomorrow', 'priorities', 'every']);
function splitItems(s) { return String(s).split(/[,;\n]+/).map((x) => x.trim().replace(/\.$/, '')).filter(Boolean).slice(0, 30); }
function showList(name, arr) {
  if (!arr || !arr.length) return `${cap(name)} is empty. Add with "add milk to ${name}".`;
  return `🛒 ${cap(name)} (${arr.length}):\n${arr.map((x) => `• ${x}`).join('\n')}\nSay "got ${arr[0]}" to tick one off, or "clear ${name}".`;
}
const sameItem = (a, b) => { const n = (s) => s.toLowerCase().trim().replace(/e?s$/, ''); return n(a) === n(b); };

// ---------- messages ----------
const HELP = `I'm your chief of staff. Things you can say:
• remind me to call mom thursday 6pm
• remind me in 2 hours to stretch
• every monday 9am standup notes (also: daily, weekdays)
• todo renew passport by dec 1
• add milk to groceries · groceries: eggs, bread · groceries
• list · done 2 · delete 3 · snooze 1 30m
• today · tomorrow · top 3: a; b; c
• note: … · notes
Every morning at 07:30 you get a brief (weather, calendar, what's due) and in the evening a wrap-up.`;

async function onMessage(ctx, M, L) {
  const raw = String(ctx.input.text || '').trim();
  const t = raw.toLowerCase().replace(/[!?.]+$/, '').trim();
  const today = L.date, now = stampOf(L);
  const say = (s) => ctx.reply(s);

  if (!t || /^(help|\?|what can you do|commands|hi|hello|hey)$/.test(t)) return say(HELP);

  // Priorities
  let m = raw.match(/^(?:top\s*\d*|priorities)\s*:\s*(.+)$/is);
  if (m) {
    let parts = m[1].split(/[;\n]+/).map((x) => x.trim()).filter(Boolean);
    if (parts.length === 1) parts = m[1].split(',').map((x) => x.trim()).filter(Boolean);
    parts = parts.slice(0, 5);
    M.set('top', { d: today, l: parts });
    return say(`🎯 Today's top ${parts.length}:\n${parts.map((x, i) => `${i + 1}. ${x}`).join('\n')}`);
  }
  if (/^(top\s*\d*|priorities|my priorities)$/.test(t)) {
    const top = await M.get('top', null);
    if (top && top.d === today) return say(`🎯 Today's top ${top.l.length}:\n${top.l.map((x, i) => `${i + 1}. ${x}`).join('\n')}`);
    return say('No priorities set for today. Say "top 3: a; b; c".');
  }

  // Notes
  m = raw.match(/^note\s*[:\-]\s*(.+)$/is) || raw.match(/^note\s+(.+)$/is);
  if (m && !/^notes$/i.test(raw)) {
    const notes = await M.get('notes', []);
    notes.push({ d: today, t: m[1].trim().slice(0, 500) });
    while (notes.length > 200) notes.shift();
    M.set('notes', notes);
    return say(`📝 Noted (${notes.length} notes). Say "notes" to see them.`);
  }
  if (/^(notes|my notes|show notes)$/.test(t)) {
    const notes = await M.get('notes', []);
    if (!notes.length) return say('No notes yet. Say "note: …" to save one.');
    return say(`📝 Last ${Math.min(10, notes.length)} of ${notes.length} notes:\n${notes.slice(-10).reverse().map((x) => `• ${pretty(x.d, today)}: ${x.t}`).join('\n')}`);
  }

  // Reminders (one-off and repeating)
  if (/^(remind|every\b|each\b|daily\b|weekdays\b|weekends\b)/.test(t)) {
    const body = raw.replace(/^remind\s+(?:me\s+)?/i, '');
    const items = await M.get('items', []);
    if (items.length >= MAX_ITEMS) return say(`You have ${items.length} open items, my limit. Clear some with "done N" or "delete N".`);
    const rp = takeRepeat(body);
    if (rp) {
      const w = parseWhen(rp.rest, L);
      const tm = w.time || rp.tm || '09:00';
      const what = tidy(w.rest);
      if (!what) return say('What should I remind you about? e.g. "every monday 9am standup notes".');
      const it = { n: nextNum(items), k: 'r', t: cap(what).slice(0, 200), due: nextOcc(rp.rep, tm, now), rep: rp.rep, tm, c: today };
      items.push(it);
      M.set('items', items);
      return say(`🔁 Got it: "${it.t}" ${repText(it.rep)} at ${tm}. First one ${prettyStamp(it.due, today)}. (#${it.n})`);
    }
    const w = parseWhen(body, L);
    const due = whenStamp(w, L);
    const what = tidy(w.rest);
    if (!what) return say('What should I remind you about? e.g. "remind me tomorrow 9am pay rent".');
    if (!due) return say(`When should I remind you to ${what}? e.g. "remind me to ${what} tomorrow 9am" or "in 2 hours".`);
    if (due < now) return say(`${prettyStamp(due, today)} has already passed. Try a later time, e.g. "remind me to ${what} in 1 hour".`);
    const it = { n: nextNum(items), k: 'r', t: cap(what).slice(0, 200), due, c: today };
    items.push(it);
    M.set('items', items);
    return say(`⏰ I'll remind you ${prettyStamp(due, today)}: ${it.t}. (#${it.n})`);
  }

  // Tasks
  m = raw.match(/^(?:todo|to-do|to do|task|add task)\b\s*:?\s*(.+)$/is);
  if (m) {
    const items = await M.get('items', []);
    if (items.length >= MAX_ITEMS) return say(`You have ${items.length} open items, my limit. Clear some with "done N" or "delete N".`);
    const w = parseWhen(m[1], L);
    const what = tidy(w.rest);
    if (!what) return say('What\'s the task? e.g. "todo renew passport by dec 1".');
    const it = { n: nextNum(items), k: 't', t: cap(what).slice(0, 200), c: today };
    if (w.date) it.by = w.date;
    items.push(it);
    M.set('items', items);
    const open = items.filter((x) => x.k === 't').length;
    return say(`☐ Added #${it.n}: ${it.t}${it.by ? ` (by ${longDate(it.by)}${it.by === today ? ', today' : ''})` : ''}. ${open} open task${open === 1 ? '' : 's'}.`);
  }

  // Done / delete / snooze
  m = t.match(/^(?:done|did|finished|completed?|ticked?|check(?:ed)? off)\s+(.+)$/);
  if (m) return doneOrDelete(ctx, M, L, m[1], true);
  m = t.match(/^(?:delete|del|remove|cancel|drop)\s+(.+)$/);
  if (m && !/\s(?:from|off)\s/.test(m[1])) {
    const onList = !/^#?\d/.test(m[1]) && Object.values(await M.get('lists', {})).some((arr) => arr.some((y) => sameItem(y, m[1])));
    if (!onList) return doneOrDelete(ctx, M, L, m[1], false);
  }
  m = t.match(/^snooze\s+#?(\d+)\s*(.*)$/);
  if (m) {
    const items = await M.get('items', []);
    const it = items.find((x) => x.n === +m[1]);
    if (!it) return say(`There's no #${m[1]}. Say "list" to see the numbers.`);
    let due;
    const d = m[2].match(/^(?:for\s+)?(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)$/);
    if (d) due = addMin(now, +d[1] * (d[2][0] === 'h' ? 60 : d[2][0] === 'd' ? 1440 : 1));
    else if (m[2]) { const w = parseWhen(m[2].replace(/^(?:to|until|till)\s+/, ''), L); due = whenStamp(w, L); }
    else due = addMin(now, 30);
    if (!due || due <= now) return say('Snooze until when? e.g. "snooze 1 30m", "snooze 1 2h" or "snooze 1 tomorrow 9am".');
    if (it.k === 't') { it.k = 'r'; delete it.by; }
    it.due = due;
    delete it.sent;
    M.set('items', items);
    return say(`😴 Snoozed #${it.n} "${it.t}" to ${prettyStamp(due, today)}.`);
  }

  // Views
  if (/^(what'?s |what is )?(today|today's plan|my day|agenda|plan for today)( look like)?$|^what'?s on today$/.test(t)) {
    const { lines } = await dayLines(ctx, M, L, today, { weather: true, top: true });
    return say(`📋 ${longDate(today)}\n${lines.join('\n')}`);
  }
  if (/^(what'?s |what is )?(on )?tomorrow( look like)?$/.test(t)) {
    const { lines, content } = await dayLines(ctx, M, L, addDays(today, 1), { weather: false, top: false });
    return say(`📋 Tomorrow, ${longDate(addDays(today, 1))}\n${content || lines.length ? lines.join('\n') : 'Nothing scheduled yet.'}`);
  }
  if (/^(list|tasks|todos|to-?dos|reminders|open|what'?s open|my list|show list|show tasks)$/.test(t)) {
    const items = await M.get('items', []);
    if (!items.length) return say('Nothing open. Add one: "todo renew passport by dec 1" or "remind me in 2 hours to stretch".');
    const s = sortItems(items);
    return say(`Open (${s.length}):\n${s.slice(0, 40).map((x) => itemLine(x, today)).join('\n')}${s.length > 40 ? `\n…and ${s.length - 40} more` : ''}\nSay "done 2", "delete 3" or "snooze 1 30m".`);
  }

  // Lists
  const lists = await M.get('lists', {});
  if (/^lists$/.test(t)) {
    const names = Object.keys(lists);
    return say(names.length ? `Your lists: ${names.map((k) => `${k} (${lists[k].length})`).join(', ')}.` : 'No lists yet. Say "add milk to groceries".');
  }
  m = raw.match(/^add\s+(.+?)(?:\s+(?:to|on|onto)\s+(?:my\s+|the\s+)?([a-z][a-z0-9 '&-]{0,24}?)(?:\s+list)?)?\s*$/is);
  if (m) {
    const name = listKey(m[2] || 'groceries');
    const arr = lists[name] || [];
    const added = [];
    for (const x of splitItems(m[1])) if (!arr.some((y) => sameItem(y, x)) && arr.length < 200) { arr.push(x.slice(0, 80)); added.push(x); }
    lists[name] = arr;
    M.set('lists', lists);
    return say(`${added.length ? `Added ${added.join(', ')} to ${name}.` : `Already on ${name}.`} ${cap(name)} now has ${arr.length}: ${arr.join(', ')}.`);
  }
  m = raw.match(/^([a-z][a-z0-9 '&-]{0,24}?)(?:\s+list)?\s*:\s*(.+)$/is);
  if (m && !RESERVED.has(m[1].toLowerCase().trim())) {
    const name = listKey(m[1]);
    const arr = lists[name] || [];
    const added = [];
    for (const x of splitItems(m[2])) if (!arr.some((y) => sameItem(y, x)) && arr.length < 200) { arr.push(x.slice(0, 80)); added.push(x); }
    lists[name] = arr;
    M.set('lists', lists);
    return say(`${added.length ? `Added ${added.join(', ')} to ${name}.` : `Already on ${name}.`} ${cap(name)} now has ${arr.length}: ${arr.join(', ')}.`);
  }
  m = t.match(/^(?:clear|empty|reset)\s+(?:the\s+|my\s+)?(.+?)(?:\s+list)?$/);
  if (m && lists[listKey(m[1])]) {
    const name = listKey(m[1]);
    const n = lists[name].length;
    delete lists[name];
    M.set('lists', lists);
    return say(`Cleared ${name} (${n} item${n === 1 ? '' : 's'}).`);
  }
  m = raw.match(/^(?:got|bought|picked up|remove|delete|cross off)\s+(.+?)(?:\s+(?:from|off)\s+(?:my\s+|the\s+)?(.+?)(?:\s+list)?)?\s*$/is);
  if (m && (m[2] || Object.keys(lists).length)) {
    const names = m[2] ? [listKey(m[2])] : Object.keys(lists);
    const gone = [];
    for (const x of splitItems(m[1])) {
      for (const name of names) {
        const arr = lists[name] || [];
        const i = arr.findIndex((y) => sameItem(y, x));
        if (i >= 0) { gone.push(`${arr[i]} (${name})`); arr.splice(i, 1); break; }
      }
    }
    if (gone.length) {
      M.set('lists', lists);
      const left = names.map((n) => `${n}: ${(lists[n] || []).length} left`).join(', ');
      return say(`✓ Ticked off ${gone.join(', ')}. ${left}.`);
    }
    if (m[2] || /^(got|bought|picked up|cross off)/i.test(raw)) return say(`"${m[1]}" isn't on ${m[2] ? listKey(m[2]) : 'any list'}. Say "lists" to see them.`);
  }
  const asList = listKey(t);
  if (lists[asList] || asList === 'groceries' || asList === 'shopping') return say(showList(asList, lists[asList]));

  // Not understood
  const w = parseWhen(raw, L);
  if (w.date || w.time) return say(`I didn't catch that. Want a reminder? Say "remind me to ${raw}". Or "todo ${raw}" to keep it as a task.`);
  return say(`I didn't catch "${raw.slice(0, 60)}". I understand reminders ("remind me to call mom thursday 6pm"), tasks ("todo renew passport by dec 1"), lists ("add milk to groceries"), "list", "today" and "note: …". Say "help" for everything.`);
}

async function doneOrDelete(ctx, M, L, arg, done) {
  const items = await M.get('items', []);
  const today = L.date;
  const nums = arg.match(/^#?\d+(?:\s*(?:,|and|&|\s)\s*#?\d+)*$/) ? arg.match(/\d+/g).map(Number) : null;
  let hits;
  if (nums) {
    hits = nums.map((n) => items.find((x) => x.n === n)).filter(Boolean);
    if (!hits.length) return ctx.reply(`There's no #${nums.join(', #')}. Say "list" to see the numbers.`);
  } else {
    hits = findItems(items, arg.replace(/^#/, ''));
    if (!hits.length) return ctx.reply(`I couldn't find "${arg}" in your open items. Say "list" to see them.`);
    if (hits.length > 1) return ctx.reply(`Which one?\n${sortItems(hits).slice(0, 6).map((x) => itemLine(x, today)).join('\n')}\nSay "${done ? 'done' : 'delete'} <number>".`);
  }
  const log = await M.get('log', []);
  const said = [];
  for (const it of hits) {
    if (done && it.rep) {
      logDone(log, today, it.t);
      if (it.sent !== it.due && it.due.slice(0, 10) === today) { it.sent = it.due; it.due = nextOcc(it.rep, it.tm, it.due); }
      said.push(`✅ ${it.t} (repeats; next ${prettyStamp(it.due, today)})`);
      continue;
    }
    items.splice(items.indexOf(it), 1);
    if (done) { logDone(log, today, it.t); said.push(`✅ ${it.t}`); } else said.push(`🗑 ${it.t}${it.rep ? ` (${repText(it.rep)})` : ''}`);
  }
  M.set('items', items);
  if (done) M.set('log', log);
  const doneToday = log.filter((x) => x.d === today).length;
  return ctx.reply(`${said.join('\n')}\n${done ? `${doneToday} done today, ` : 'Deleted. '}${items.length} open.`);
}

async function run(ctx) {
  const L = ctx.local();
  const M = store(ctx);
  const type = ctx.trigger.type;
  if (type === 'message') { await onMessage(ctx, M, L); await M.save(); return; }
  await fireReminders(ctx, M, L);
  const sent = await M.get('sent', {});
  const eve = validTime(ctx.settings.eveningAt) || '20:30';
  const briefDue = sent.brief !== L.date && (type !== 'interval' || (L.time >= '07:30' && L.time < '11:00' && L.time < eve));
  if (briefDue) {
    await morningBrief(ctx, M, L);
    sent.brief = L.date;
    M.set('sent', sent);
  }
  if (type === 'interval' && sent.wrap !== L.date && L.time >= eve) {
    await eveningWrap(ctx, M, L);
    sent.wrap = L.date;
    M.set('sent', sent);
  }
  await housekeeping(M, L);
  await M.save();
}
