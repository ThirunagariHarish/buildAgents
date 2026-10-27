// "remind me to call John in 30 minutes" -> { at, text }. Plain-English times,
// worked out in the person's own time zone, with no libraries:
//   in 20 min / in an hour / in half an hour / in 3 days / in 2 weeks
//   at 5 / at 5pm / at 17:30 / noon / midnight
//   today / tonight / tomorrow (morning|afternoon|evening|night) / this evening
//   on friday / next tuesday / on oct 30 / on 30 october
// Returns null when there is no reminder or no time in it.

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const PARTS = { morning: 9, afternoon: 15, evening: 18, night: 20, tonight: 20 };

/** The wall-clock parts of a moment in a time zone. */
function partsIn(ms, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'long' });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second, wd: WEEKDAYS.indexOf(String(p.weekday).toLowerCase()) };
}
const offsetAt = (ms, tz) => { const p = partsIn(ms, tz); return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000; };
/** A wall-clock time in a time zone, as a moment (handles daylight saving). */
function zoned(y, mo, d, h, mi, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let at = guess - offsetAt(guess, tz);
  at = guess - offsetAt(at, tz);
  return at;
}
const validTz = (tz) => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };

const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, 'forty five': 45, 'a couple of': 2, 'a few': 3 };
const UNIT = (u) => (/^m/.test(u) ? 60e3 : /^h/.test(u) ? 3600e3 : /^d/.test(u) ? 864e5 : /^w/.test(u) ? 7 * 864e5 : 0);

function parseReminder(input, { now = Date.now(), tz = 'UTC' } = {}) {
  const raw = String(input || '').replace(/\s+/g, ' ').trim();
  if (!/\bremind(er)?\b/i.test(raw)) return null;
  if (!validTz(tz)) tz = 'UTC';
  let s = ` ${raw.toLowerCase()} `;
  const cut = (re) => { const m = s.match(re); if (m) s = s.replace(m[0], ' '); return m; };
  let at = null;

  // Relative: in 20 minutes, in an hour, in half an hour, after 2 days.
  const half = cut(/\b(?:in|after)\s+half\s+an?\s+hour\b/);
  const rel = !half && cut(/\b(?:in|after)\s+(\d+(?:\.\d+)?|an?|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty five|a couple of|a few)\s*(minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|wks?|w)\b/);
  if (half) at = now + 30 * 60e3;
  else if (rel) at = now + (Number(rel[1]) || NUM[rel[1]] || 1) * UNIT(rel[2]);

  if (at === null) {
    const today = partsIn(now, tz);
    let y = today.y, mo = today.mo, d = today.d, dayGiven = false, hour = null, minute = 0;
    const addDays = (n) => { const t = new Date(Date.UTC(y, mo - 1, d + n)); y = t.getUTCFullYear(); mo = t.getUTCMonth() + 1; d = t.getUTCDate(); };

    // A clock time: at 5, at 5pm, 17:30, 5:30 pm, noon, midnight.
    let clock = cut(/\b(?:at|@|by)\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?=\s|[.,!?:;]|$)/) || cut(/\b(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?\b/) || cut(/\b(\d{1,2})\s*(a\.?m\.?|p\.?m\.?)(?=\s|[.,!?:;]|$)/);
    if (clock && clock.length === 3) clock = [clock[0], clock[1], undefined, clock[2]];
    const named = !clock && cut(/\b(?:at\s+)?(noon|midday|midnight)\b/);
    let ampm = null;
    if (clock) { hour = Number(clock[1]); minute = Number(clock[2] || 0); ampm = clock[3] ? clock[3][0] : null; }
    if (named) { hour = named[1] === 'midnight' ? 0 : 12; minute = 0; ampm = 'x'; }
    if (hour !== null && (hour > 23 || minute > 59)) return null;

    // The day.
    const tomorrowPart = cut(/\b(?:tomorrow|tmrw|tmr)\s+(morning|afternoon|evening|night)\b/);
    const thisPart = !tomorrowPart && cut(/\b(?:this\s+)?(morning|afternoon|evening|tonight)\b/);
    const tomorrow = !tomorrowPart && cut(/\b(?:tomorrow|tmrw|tmr)\b/);
    const todayWord = cut(/\btoday\b/);
    const wd = cut(/\b(?:on\s+|this\s+|next\s+)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|sday|urday|rsday)?\b/);
    const monthDay = cut(/\b(?:on\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/) || cut(/\b(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/);

    let part = null;
    if (tomorrowPart) { addDays(1); dayGiven = true; part = tomorrowPart[1]; }
    else if (tomorrow) { addDays(1); dayGiven = true; }
    else if (wd) {
      const want = WEEKDAYS.findIndex((w) => w.startsWith(wd[1].slice(0, 3)));
      let diff = (want - today.wd + 7) % 7;
      if (/next/.test(wd[0]) && diff === 0) diff = 7;
      addDays(diff); dayGiven = true;
      if (diff === 0) dayGiven = 'today-weekday';
    } else if (monthDay) {
      const isNumFirst = /^\d/.test(monthDay[1]);
      const mName = isNumFirst ? monthDay[2] : monthDay[1];
      const dayNum = Number(isNumFirst ? monthDay[1] : monthDay[2]);
      const mIdx = MONTHS.indexOf(mName.slice(0, 3));
      if (mIdx < 0 || dayNum < 1 || dayNum > 31) return null;
      mo = mIdx + 1; d = dayNum; dayGiven = true;
      if (Date.UTC(y, mo - 1, d) < Date.UTC(today.y, today.mo - 1, today.d)) y += 1;
    } else if (todayWord) dayGiven = true;
    if (thisPart) part = thisPart[1];

    if (hour === null && part) { hour = PARTS[part]; minute = 0; ampm = 'x'; }
    if (hour === null && !dayGiven) return null; // "remind me to call John": no time yet
    if (hour === null) { hour = 9; minute = 0; ampm = 'x'; }
    // 12-hour clock without am/pm: pick the reading that makes sense.
    if (ampm === 'p' && hour < 12) hour += 12;
    else if (ampm === 'a' && hour === 12) hour = 0;
    else if (!ampm && hour >= 1 && hour <= 12) {
      if (part && PARTS[part] >= 12 && hour < 12) hour += 12;
      else if (!part && hour <= 6) hour += 12; // "at 3" means 3pm
    }
    at = zoned(y, mo, d, hour, minute, tz);
    // A time already past today (no day given) means tomorrow; a past weekday time today means next week.
    if (at <= now && (!dayGiven || dayGiven === true && (todayWord || thisPart) || dayGiven === 'today-weekday')) {
      if (!ampm && hour < 12 && zoned(y, mo, d, hour + 12, minute, tz) > now && !dayGiven) at = zoned(y, mo, d, hour + 12, minute, tz);
      else { addDays(dayGiven === 'today-weekday' ? 7 : 1); at = zoned(y, mo, d, hour, minute, tz); }
    }
    if (at <= now) return null;
  }

  // What to be reminded about: the rest of the sentence.
  let text = s.replace(/\b(please\s+)?(set\s+a\s+)?remind(er)?(\s+me)?(\s+to|\s+that|\s+about|:)?\b/, ' ').replace(/\s+/g, ' ').replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '').trim();
  text = text.replace(/(^|\s)(at|on|by|in)(?=\s*[:;,.]|\s*$)/g, ' ').replace(/\s+/g, ' ').replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '').trim();
  text = text.replace(/^(to|that|about)\s+/, '');
  // Keep the person's own capitalisation where the words survived.
  const orig = raw.toLowerCase().indexOf(text);
  if (text && orig >= 0) text = raw.slice(orig, orig + text.length);
  return { at, text: text ? text[0].toUpperCase() + text.slice(1) : 'Reminder' };
}

/** "Tue 3:30 PM" in the person's time zone. */
function describe(at, tz = 'UTC', now = Date.now()) {
  if (!validTz(tz)) tz = 'UTC';
  const p = partsIn(at, tz), n = partsIn(now, tz);
  const time = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(at));
  const sameDay = p.y === n.y && p.mo === n.mo && p.d === n.d;
  const tmr = partsIn(now + 864e5, tz);
  if (sameDay) return `today at ${time}`;
  if (p.y === tmr.y && p.mo === tmr.mo && p.d === tmr.d) return `tomorrow at ${time}`;
  const day = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(at));
  return `${day} at ${time}`;
}

module.exports = { parseReminder, describe, partsIn, zoned, validTz };
