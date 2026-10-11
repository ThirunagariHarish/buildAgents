// Trip Concierge: turns booking confirmations (pasted, or forwarded to its inbox)
// into a trip plan, then walks you through it: check-in, weather and packing,
// when to leave for the airport, the hotel address on arrival day.

const MAX_TRIPS = 40;

// ---------- reference data ----------
const AIRPORTS = {
  SFO: ['San Francisco', 'US'], SJC: ['San Jose', 'US'], OAK: ['Oakland', 'US'], LAX: ['Los Angeles', 'US'], SAN: ['San Diego', 'US'],
  SEA: ['Seattle', 'US'], PDX: ['Portland', 'US'], LAS: ['Las Vegas', 'US'], PHX: ['Phoenix', 'US'], DEN: ['Denver', 'US'],
  SLC: ['Salt Lake City', 'US'], DFW: ['Dallas', 'US'], IAH: ['Houston', 'US'], AUS: ['Austin', 'US'], ORD: ['Chicago', 'US'],
  MSP: ['Minneapolis', 'US'], DTW: ['Detroit', 'US'], ATL: ['Atlanta', 'US'], MIA: ['Miami', 'US'], MCO: ['Orlando', 'US'],
  CLT: ['Charlotte', 'US'], BNA: ['Nashville', 'US'], JFK: ['New York', 'US'], LGA: ['New York', 'US'], EWR: ['Newark', 'US'],
  BOS: ['Boston', 'US'], PHL: ['Philadelphia', 'US'], IAD: ['Washington', 'US'], DCA: ['Washington', 'US'], BWI: ['Baltimore', 'US'],
  HNL: ['Honolulu', 'US'], ANC: ['Anchorage', 'US'],
  DEL: ['Delhi', 'IN'], BOM: ['Mumbai', 'IN'], BLR: ['Bengaluru', 'IN'], HYD: ['Hyderabad', 'IN'], MAA: ['Chennai', 'IN'],
  CCU: ['Kolkata', 'IN'], COK: ['Kochi', 'IN'], GOI: ['Goa', 'IN'], GOX: ['Goa', 'IN'], AMD: ['Ahmedabad', 'IN'], PNQ: ['Pune', 'IN'],
  JAI: ['Jaipur', 'IN'], LKO: ['Lucknow', 'IN'], TRV: ['Thiruvananthapuram', 'IN'], ATQ: ['Amritsar', 'IN'], IXC: ['Chandigarh', 'IN'],
  LHR: ['London', 'GB'], LGW: ['London', 'GB'], CDG: ['Paris', 'FR'], FRA: ['Frankfurt', 'DE'], MUC: ['Munich', 'DE'],
  AMS: ['Amsterdam', 'NL'], ZRH: ['Zurich', 'CH'], FCO: ['Rome', 'IT'], MAD: ['Madrid', 'ES'], BCN: ['Barcelona', 'ES'],
  IST: ['Istanbul', 'TR'], DXB: ['Dubai', 'AE'], AUH: ['Abu Dhabi', 'AE'], DOH: ['Doha', 'QA'], SIN: ['Singapore', 'SG'],
  HKG: ['Hong Kong', 'HK'], BKK: ['Bangkok', 'TH'], KUL: ['Kuala Lumpur', 'MY'], NRT: ['Tokyo', 'JP'], HND: ['Tokyo', 'JP'],
  ICN: ['Seoul', 'KR'], SYD: ['Sydney', 'AU'], MEL: ['Melbourne', 'AU'], YYZ: ['Toronto', 'CA'], YVR: ['Vancouver', 'CA'],
  MEX: ['Mexico City', 'MX'], CUN: ['Cancun', 'MX'],
};
const AIRLINES = {
  UA: ['United', 'https://www.united.com/en/us/checkin'],
  DL: ['Delta', 'https://www.delta.com/us/en/check-in/overview'],
  AA: ['American', 'https://www.aa.com/reservation/flightCheckInViewReservationsAccess.do'],
  WN: ['Southwest', 'https://www.southwest.com/air/check-in/'],
  AS: ['Alaska', 'https://www.alaskaair.com/booking/check-in'],
  B6: ['JetBlue', 'https://www.jetblue.com/check-in'],
  AI: ['Air India', 'https://www.airindia.com/in/en/manage/web-checkin.html'],
  EK: ['Emirates', 'https://www.emirates.com/english/manage-booking/online-check-in/'],
  LH: ['Lufthansa', 'https://www.lufthansa.com/us/en/online-check-in'],
  BA: ['British Airways', 'https://www.britishairways.com/travel/olcilandingpageauthreq/public/en_us'],
  '6E': ['IndiGo', ''], UK: ['Vistara', ''], AC: ['Air Canada', ''], SQ: ['Singapore Airlines', ''], QR: ['Qatar Airways', ''],
  AF: ['Air France', ''], KL: ['KLM', ''], NK: ['Spirit', ''], F9: ['Frontier', ''], HA: ['Hawaiian', ''], VS: ['Virgin Atlantic', ''],
  EY: ['Etihad', ''], QP: ['Akasa Air', ''], SG: ['SpiceJet', ''],
};
const AIRLINE_NAMES = [['british airways', 'BA'], ['air india', 'AI'], ['air canada', 'AC'], ['air france', 'AF'], ['singapore airlines', 'SQ'],
  ['qatar airways', 'QR'], ['virgin atlantic', 'VS'], ['akasa air', 'QP'], ['united', 'UA'], ['delta', 'DL'], ['american', 'AA'],
  ['southwest', 'WN'], ['alaska', 'AS'], ['jetblue', 'B6'], ['emirates', 'EK'], ['lufthansa', 'LH'], ['indigo', '6E'], ['vistara', 'UK'],
  ['klm', 'KL'], ['spirit', 'NK'], ['frontier', 'F9'], ['hawaiian', 'HA'], ['etihad', 'EY'], ['spicejet', 'SG']];
const CARS = ['hertz', 'avis', 'enterprise', 'budget', 'sixt', 'national', 'alamo', 'thrifty', 'dollar', 'europcar', 'zoomcar'];

// ---------- dates ----------
const WD = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const pad = (n) => String(n).padStart(2, '0');
function dayNum(date) { const [y, m, d] = date.split('-').map(Number); return Date.UTC(y, m - 1, d) / 864e5; }
function addDays(date, n) { return new Date((dayNum(date) + n) * 864e5).toISOString().slice(0, 10); }
function weekday(date) { return WD[new Date(dayNum(date) * 864e5).getUTCDay()]; }
const cap = (s) => s[0].toUpperCase() + s.slice(1);
function nice(date) { const [, m, d] = date.split('-').map(Number); return `${cap(weekday(date))} ${cap(MONTHS[m - 1])} ${d}`; }
function short(date) { const [, m, d] = date.split('-').map(Number); return `${cap(MONTHS[m - 1])} ${d}`; }
/** Minutes since the epoch for a naive local "YYYY-MM-DDTHH:MM". */
function mins(key) { const [d, t] = key.split('T'); const [h, mi] = (t || '00:00').split(':').map(Number); return dayNum(d) * 1440 + h * 60 + mi; }
function hm(total) { const m = ((total % 1440) + 1440) % 1440; return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; }
function makeDate(y, mo, d, today) {
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
  const ty = Number(today.slice(0, 4));
  let date = `${y || ty}-${pad(mo)}-${pad(d)}`;
  if (!y && dayNum(date) < dayNum(today) - 60) date = `${ty + 1}-${pad(mo)}-${pad(d)}`;
  return date;
}
/** Every date in the text: [{ v: "YYYY-MM-DD", i, len }]. */
function allDates(text, today) {
  const t = text.toLowerCase();
  const out = [];
  const push = (m, v) => { if (v && !out.some((x) => m.index < x.i + x.len && x.i < m.index + m[0].length)) out.push({ v, i: m.index, len: m[0].length }); };
  for (const m of t.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) push(m, makeDate(+m[1], +m[2], +m[3], today));
  for (const m of t.matchAll(new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s*(\\d{4})\\b)?`, 'g'))) push(m, makeDate(m[3] ? +m[3] : 0, MONTHS.indexOf(m[1].slice(0, 3)) + 1, +m[2], today));
  for (const m of t.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}\\b\\.?(?:,?\\s*(\\d{4})\\b)?`, 'g'))) push(m, makeDate(m[3] ? +m[3] : 0, MONTHS.indexOf(m[2].slice(0, 3)) + 1, +m[1], today));
  for (const m of t.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)) {
    let a = +m[1], b = +m[2];
    if (a > 12) [a, b] = [b, a];
    push(m, makeDate(m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : 0, a, b, today));
  }
  for (const m of t.matchAll(/\b(today|tomorrow)\b/g)) push(m, m[1] === 'today' ? today : addDays(today, 1));
  if (!out.length) {
    for (const m of t.matchAll(/\b(sun|mon|tue|wed|thu|fri|sat)(?:day|sday|nesday|rsday|urday|s|rs|r)?\b/g)) {
      let diff = (WD.indexOf(m[1]) - WD.indexOf(weekday(today)) + 7) % 7;
      if (diff === 0) diff = 7;
      push(m, addDays(today, diff));
    }
  }
  return out.sort((a, b) => a.i - b.i);
}
function allTimes(text) {
  const out = [];
  for (const m of text.toLowerCase().matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)|\b([01]?\d|2[0-3])[:h]([0-5]\d)\b/g)) {
    let h, mi;
    if (m[3]) { h = +m[1] % 12 + (m[3][0] === 'p' ? 12 : 0); mi = m[2] || '00'; } else { h = +m[4]; mi = m[5]; }
    if (h > 23) continue;
    out.push({ v: `${pad(h)}:${mi}`, i: m.index, len: m[0].length });
  }
  return out;
}
function allRoutes(text, loose) {
  const out = [];
  for (const m of text.matchAll(/\(([A-Z]{3})\)[^()\n]{0,80}?(?:\n[^()\n]{0,80}?)?\(([A-Z]{3})\)/g)) out.push({ v: [m[1], m[2]], i: m.index, len: m[0].length });
  const src = loose ? text.toUpperCase() : text;
  for (const m of src.matchAll(/\b([A-Z]{3})\s*(→|->|–|—|-|>|\bTO\b|\bto\b)\s*([A-Z]{3})\b/g)) {
    if (out.some((x) => m.index < x.i + x.len && x.i < m.index + m[0].length)) continue;
    if (!loose && !AIRPORTS[m[1]] && !AIRPORTS[m[3]] && !/→|->/.test(m[2])) continue;
    if (m[1] === m[3]) continue;
    out.push({ v: [m[1], m[3]], i: m.index, len: m[0].length });
  }
  return out.sort((a, b) => a.i - b.i);
}
/** The match nearest to a span [from, to): the last one before or the first one after, whichever is closer. */
function nearest(list, from, to, lo, hi) {
  let best = null, dist = Infinity;
  for (const x of list) {
    if (x.i < lo || x.i + x.len > hi) continue;
    const d = x.i >= to ? x.i - to : x.i + x.len <= from ? from - (x.i + x.len) : 0;
    if (d < dist) { best = x; dist = d; }
  }
  return best;
}
const cityOf = (code) => (AIRPORTS[code] ? AIRPORTS[code][0] : code);
const intl = (f) => !!(AIRPORTS[f.f] && AIRPORTS[f.to] && AIRPORTS[f.f][1] !== AIRPORTS[f.to][1]);

// ---------- extraction ----------
function findFlights(text, loose) {
  const hits = [];
  const codeRe = new RegExp(`\\b(${Object.keys(AIRLINES).join('|')})\\s?-?(\\d{1,4})\\b`, 'g');
  for (const m of (loose ? text.toUpperCase() : text).matchAll(codeRe)) hits.push({ al: m[1], n: String(+m[2]), i: m.index, len: m[0].length });
  const nameRe = new RegExp(`\\b(${AIRLINE_NAMES.map((x) => x[0]).join('|')})(?:\\s+air\\s?lines?)?(?:\\s+flight)?\\s+(?:#\\s*)?(?:(?:[A-Z][A-Z0-9]|\\d[A-Z])\\s?)?(\\d{1,4})\\b`, 'gi');
  for (const m of text.matchAll(nameRe)) {
    const al = AIRLINE_NAMES.find((x) => x[0] === m[1].toLowerCase())[1];
    const over = hits.find((h) => m.index < h.i + h.len && h.i < m.index + m[0].length);
    if (over) { over.i = Math.min(over.i, m.index); continue; }
    hits.push({ al, n: String(+m[2]), i: m.index, len: m[0].length });
  }
  hits.sort((a, b) => a.i - b.i);
  return hits.filter((h, k) => !hits.slice(0, k).some((x) => x.al === h.al && x.n === h.n));
}
function confCode(text) {
  for (const m of text.matchAll(/(?:confirmation|booking|reservation|record locator|pnr|reference)(?=\s*(?:code|number|no\.?|#|ref|id)?\s*(?:is)?\s*[:#]?\s*([A-Z0-9]{5,12})\b)/gi)) {
    if (m[1] === m[1].toUpperCase() && /\d/.test(m[1]) || /^[A-Z]{6}$/.test(m[1])) return m[1];
  }
  return '';
}
function extract(text, today, loose) {
  const flights = [], hotels = [], cars = [];
  let partial = false;
  const fl = findFlights(text, loose);
  const dates = allDates(text, today), times = allTimes(text), routes = allRoutes(text, loose);
  const conf = confCode(text);
  fl.forEach((h, k) => {
    const lo = k ? fl[k - 1].i + fl[k - 1].len : 0;
    const hi = k + 1 < fl.length ? fl[k + 1].i : text.length;
    const from = h.i, to = h.i + h.len;
    const d = nearest(dates, from, to, Math.max(lo, from - 150), Math.min(hi, to + 300));
    const r = nearest(routes, from, to, Math.max(lo, from - 150), Math.min(hi, to + 300));
    const dep = text.slice(to, Math.min(hi, to + 300)).search(/depart/i);
    const tAfter = dep >= 0 ? times.find((x) => x.i >= to + dep && x.i < hi) : null;
    const t = tAfter || nearest(times, from, to, Math.max(lo, from - 80), Math.min(hi, to + 200));
    if (!d || !r) { partial = true; return; }
    flights.push({ k: 'f', al: h.al, n: h.n, d: d.v, t: t ? t.v : '', f: r.v[0], to: r.v[1], cf: conf });
  });
  if (/\bcheck[- ]?in\b/i.test(text) && /\bcheck[- ]?out\b/i.test(text)) {
    const at = (re) => { const m = text.search(re); return m < 0 ? null : dates.find((x) => x.i > m && x.i - m < 50); };
    const din = at(/check[- ]?in(?!\s+online)/i), dout = at(/check[- ]?out/i);
    let name = '';
    let m = text.match(/(?:hotel|property)(?:\s+name)?\s*:\s*([^\n]{3,70})/i)
      || text.match(/(?:[Yy]our (?:stay|reservation|booking) at|[Rr]eservation at|[Bb]ooked at|[Ww]elcome to|[Tt]hank you for (?:choosing|staying at))\s+(?:the\s+)?([A-Z][^\n,.!]{2,60})/)
      || text.match(/^[ \t]*([^\n]{0,40}\b(?:Marriott|Hilton|Hyatt|Sheraton|Westin|Holiday Inn|Courtyard|Hampton|Radisson|Novotel|Ibis|Taj|Oberoi|ITC|Leela|Four Seasons|Ritz|InterContinental|Crowne Plaza|Best Western|Hotel|Inn|Suites|Resort)\b[^\n]{0,40})$/m);
    if (m) name = m[1].replace(/\s+/g, ' ').replace(/\s+(?:is|has been|was|are)\b.*$/i, '').trim();
    const a = text.match(/address\s*:\s*([^\n]{5,120})/i) || text.match(/^[ \t]*(\d+[^\n]{2,40}\b(?:street|st|avenue|ave|road|rd|boulevard|blvd|broadway|way|lane|ln|drive|dr|marg|nagar)\b[^\n]{0,80})$/im);
    if (din && dout && name) hotels.push({ k: 'h', nm: name.slice(0, 60), in: din.v, out: dout.v, ad: a ? a[1].trim() : '', cf: conf });
    else if (din || dout || name) partial = true;
  }
  const carCo = CARS.find((c) => new RegExp(`\\b${c}\\b`, 'i').test(text));
  if (carCo && /\b(pick[- ]?up|rental|car)\b/i.test(text)) {
    const p = text.search(/pick[- ]?up/i);
    const d = p >= 0 ? dates.find((x) => x.i > p) : dates[0];
    const t = p >= 0 ? times.find((x) => x.i > p) : null;
    const loc = text.match(/pick[- ]?up (?:location|at|from)\s*:?\s*([^\n]{3,80})/i);
    if (d) cars.push({ k: 'c', co: cap(carCo), d: d.v, t: t ? t.v : '', loc: loc ? loc[1].trim() : '', cf: conf });
    else partial = true;
  }
  return { items: [...flights, ...hotels, ...cars], partial: partial || (!flights.length && fl.length > 0) };
}
function fromModel(out, today) {
  if (!out) return [];
  const s = out.indexOf('{'), e = out.lastIndexOf('}');
  if (s < 0 || e < s) return [];
  let j;
  try { j = JSON.parse(out.slice(s, e + 1)); } catch (err) { return []; }
  const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && String(v) >= addDays(today, -60);
  const items = [];
  for (const f of Array.isArray(j.flights) ? j.flights : []) {
    const al = String(f.airline || '').toUpperCase(), n = String(f.number || '').replace(/\D/g, '');
    const from = String(f.from || '').toUpperCase(), to = String(f.to || '').toUpperCase();
    if (!/^[A-Z0-9]{2}$/.test(al) || !n || !isDate(f.date) || !/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) continue;
    items.push({ k: 'f', al, n: String(+n), d: f.date, t: /^\d{2}:\d{2}$/.test(String(f.time || '')) ? f.time : '', f: from, to, cf: String(j.confirmation || '').slice(0, 10) });
  }
  for (const h of Array.isArray(j.hotels) ? j.hotels : []) {
    if (!h.name || !isDate(h.checkin) || !isDate(h.checkout)) continue;
    items.push({ k: 'h', nm: String(h.name).slice(0, 60), in: h.checkin, out: h.checkout, ad: String(h.address || '').slice(0, 120), cf: String(j.confirmation || '').slice(0, 10) });
  }
  return items;
}

// ---------- trips ----------
const startOf = (i) => (i.k === 'h' ? i.in : i.d);
const endOf = (i) => (i.k === 'h' ? i.out : i.d);
const sortKey = (i) => `${startOf(i)}T${i.k === 'h' ? '15:00' : i.t || '12:00'}`;
function span(trip) {
  const s = trip.items.map(startOf).sort(), e = trip.items.map(endOf).sort();
  return { start: s[0], end: e[e.length - 1] };
}
function flightsOf(trip) { return trip.items.filter((i) => i.k === 'f').sort((a, b) => (a.d + a.t).localeCompare(b.d + b.t)); }
function destOf(trip) {
  const fs = flightsOf(trip);
  if (fs.length) return cityOf(fs[0].to);
  const h = trip.items.find((i) => i.k === 'h');
  if (h && h.ad) {
    const parts = h.ad.split(',').map((x) => x.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const last = parts[parts.length - 1].replace(/\b[A-Z]?\d[\dA-Z -]*$/, '').trim();
      return last.length >= 3 ? last : parts[parts.length - 2];
    }
  }
  return h ? h.nm : 'your trip';
}
const isReturn = (trip, f) => { const fs = flightsOf(trip); return fs.length > 1 && f === fs[fs.length - 1] && f.to === fs[0].f; };
function describe(i) {
  if (i.k === 'f') return `✈️ ${i.al} ${i.n} ${i.f} → ${i.to}, ${nice(i.d)}${i.t ? ` ${i.t}` : ' (time?)'}${i.cf ? ` · ${i.cf}` : ''}`;
  if (i.k === 'h') return `🏨 ${i.nm}, ${short(i.in)}–${short(i.out)} (${dayNum(i.out) - dayNum(i.in)} night${dayNum(i.out) - dayNum(i.in) === 1 ? '' : 's'})${i.cf ? ` · ${i.cf}` : ''}`;
  return `🚗 ${i.co} pick-up ${nice(i.d)}${i.t ? ` ${i.t}` : ''}${i.loc ? `, ${i.loc}` : ''}${i.cf ? ` · ${i.cf}` : ''}`;
}
function sameItem(a, b) {
  if (a.k !== b.k) return false;
  if (a.k === 'f') return a.al === b.al && a.n === b.n && a.d === b.d;
  if (a.k === 'h') return a.nm.toLowerCase() === b.nm.toLowerCase() && a.in === b.in;
  return a.co === b.co && a.d === b.d;
}
/** Put items into trips (joining one whose dates are within 3 days); returns the trips touched. */
function addItems(trips, items) {
  const touched = [];
  for (const it of items) {
    let trip = trips.find((t) => t.items.some((x) => sameItem(x, it)));
    if (trip) {
      const x = trip.items.find((y) => sameItem(y, it));
      for (const [k, v] of Object.entries(it)) if (v && !x[k]) x[k] = v;
    } else {
      trip = trips.find((t) => { const s = span(t); return dayNum(startOf(it)) >= dayNum(s.start) - 3 && dayNum(startOf(it)) <= dayNum(s.end) + 3; });
      if (!trip) { trip = { id: trips.reduce((m, t) => Math.max(m, t.id), 0) + 1, items: [] }; trips.push(trip); }
      trip.items.push(it);
      trip.items.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    }
    if (!touched.includes(trip)) touched.push(trip);
  }
  trips.sort((a, b) => span(a).start.localeCompare(span(b).start));
  return touched;
}
function upcoming(trips, today) { return trips.filter((t) => span(t).end >= today); }
function tidy(trips, today) { return trips.filter((t) => t.items.length && span(t).end >= addDays(today, -30)).slice(-MAX_TRIPS); }
const dates = (s) => (s.start === s.end ? nice(s.start) : `${nice(s.start)} – ${nice(s.end)}`);
function tripTitle(t) { return `${destOf(t)} · ${dates(span(t))}`; }

// ---------- weather and packing ----------
async function forecast(ctx, city, start, end, today) {
  const last = addDays(today, 15);
  if (!city || start > last) return null;
  const s = start < today ? today : start, e = end > last ? last : end;
  let r;
  try { r = await ctx.http.get(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`); } catch (err) { return null; }
  if (r.status !== 200) return null;
  let g;
  try { g = JSON.parse(r.text); } catch (err) { return null; }
  const place = g && Array.isArray(g.results) && g.results[0];
  if (!place || typeof place.latitude !== 'number') return null;
  try { r = await ctx.http.get(`https://api.open-meteo.com/v1/forecast?latitude=${place.latitude.toFixed(2)}&longitude=${place.longitude.toFixed(2)}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&start_date=${s}&end_date=${e}`); } catch (err) { return null; }
  if (r.status !== 200) return null;
  let f;
  try { f = JSON.parse(r.text); } catch (err) { return null; }
  const d = f && f.daily;
  if (!d || !Array.isArray(d.time) || !d.time.length) return null;
  const days = d.time.map((t, i) => ({ d: t, hi: d.temperature_2m_max[i], lo: d.temperature_2m_min[i], rain: d.precipitation_probability_max ? d.precipitation_probability_max[i] : null })).filter((x) => typeof x.hi === 'number');
  if (!days.length) return null;
  return { city: place.name || city, days };
}
function weatherLine(w) {
  const hi = Math.round(Math.max(...w.days.map((x) => x.hi))), lo = Math.round(Math.min(...w.days.map((x) => x.lo)));
  const wet = w.days.filter((x) => x.rain != null).sort((a, b) => b.rain - a.rain)[0];
  return `${w.city}, ${short(w.days[0].d)}–${short(w.days[w.days.length - 1].d)}: ${lo}–${hi}°C${wet && wet.rain >= 30 ? `, rain ${wet.rain}% on ${short(wet.d)}` : ', mostly dry'}.`;
}
function packingList(trip, w) {
  const s = span(trip);
  const nights = Math.max(dayNum(s.end) - dayNum(s.start), 0);
  const abroad = flightsOf(trip).some(intl);
  const list = [abroad ? 'Passport (and visa if needed)' : 'ID', `${Math.min(nights + 1, 7)} days of clothes`, 'Phone charger', 'Toiletries', 'Any medication'];
  if (abroad) list.push('Power adapter');
  if (w) {
    const lo = Math.min(...w.days.map((x) => x.lo)), hi = Math.max(...w.days.map((x) => x.hi));
    const rain = Math.max(...w.days.map((x) => x.rain || 0));
    if (lo < 5) list.push('Warm coat, hat and gloves');
    else if (lo < 14) list.push('Jacket or warm layer');
    if (hi >= 25) list.push('Light clothes', 'Sunscreen and sunglasses');
    if (rain >= 40) list.push('Umbrella or rain jacket');
  }
  if (nights >= 7) list.push('Laundry bag');
  if (flightsOf(trip).length) list.push('Headphones for the flight');
  return list;
}

// ---------- timeline ----------
function bufferHours(ctx, f) {
  const n = Number(ctx.settings.bufferHours);
  return n > 0 ? n : intl(f) ? 3 : 2;
}
async function timeline(ctx) {
  const loc = ctx.local();
  const today = loc.date;
  const now = mins(`${today}T${loc.time}`);
  let trips = (await ctx.memory.get('trips')) || [];
  let changed = false;
  for (const trip of trips) {
    const s = span(trip);
    if (s.end < today) continue;
    for (const f of flightsOf(trip)) {
      if (!f.t) continue;
      const dep = mins(`${f.d}T${f.t}`);
      const ret = isReturn(trip, f) ? ' (return flight)' : '';
      if (!f.ci) {
        if (now >= dep - 60) { f.ci = 1; changed = true; }
        else if (now >= dep - 24 * 60) {
          f.ci = 1; changed = true;
          const al = AIRLINES[f.al] || ['', ''];
          await ctx.notify({ title: `Check in now: ${f.al} ${f.n} ${f.f} → ${f.to}${ret}`, body: `Online check-in is open for ${al[0] || f.al} ${f.n}, departing ${nice(f.d)} at ${f.t}.${f.cf ? ` Confirmation ${f.cf}.` : ''}${al[1] ? '' : ' Check in on the airline\'s app or site.'}`, link: al[1] ? { url: al[1], label: `Check in with ${al[0]}` } : undefined });
        }
      }
      if (!f.lv) {
        const b = bufferHours(ctx, f);
        const leave = dep - b * 60;
        if (now >= dep - 30) { f.lv = 1; changed = true; }
        else if (now >= leave - 60) {
          f.lv = 1; changed = true;
          await ctx.notify({ title: `Leave for ${f.f} by ${hm(leave)}`, body: `${f.al} ${f.n} to ${cityOf(f.to)} departs ${f.t}${ret}. That leaves ${b} hours at the airport (${intl(f) ? 'international' : 'domestic'}).${f.cf ? ` Confirmation ${f.cf}.` : ''}`, link: { url: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${cityOf(f.f)} ${f.f} airport`)}`, label: 'Directions' } });
        }
      }
    }
    if (!trip.wx) {
      if (today > s.start) { trip.wx = 1; changed = true; }
      else if (today >= addDays(s.start, -2)) {
        trip.wx = 1; changed = true;
        const w = await forecast(ctx, destOf(trip), s.start, s.end, today);
        const pack = packingList(trip, w);
        const dd = dayNum(s.start) - dayNum(today);
        await ctx.notify({ title: `🧳 ${destOf(trip)} ${dd === 0 ? 'today' : dd === 1 ? 'tomorrow' : `in ${dd} days`}: weather and packing`, body: `${w ? weatherLine(w) : 'No forecast available right now.'}\nPack: ${pack.join(', ')}.` });
      }
    }
    for (const i of trip.items) {
      if (i.k === 'f' || i.sent) continue;
      const day = i.k === 'h' ? i.in : i.d;
      if (today > day) { i.sent = 1; changed = true; continue; }
      if (today !== day || loc.hour < 7) continue;
      i.sent = 1; changed = true;
      if (i.k === 'h') {
        const q = i.ad || `${i.nm} ${destOf(trip)}`;
        await ctx.notify({ title: `Tonight: ${i.nm}`, body: `${i.ad ? `Address: ${i.ad}` : 'No address saved.'}\n${dayNum(i.out) - dayNum(i.in)} night(s), check out ${nice(i.out)}.${i.cf ? ` Confirmation ${i.cf}.` : ''}`, link: { url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`, label: 'Open in Maps' } });
      } else {
        await ctx.notify({ title: `Car pick-up today: ${i.co}`, body: `${i.t ? `At ${i.t}` : 'Today'}${i.loc ? `, ${i.loc}` : ''}. Bring your licence and the card you booked with.${i.cf ? ` Confirmation ${i.cf}.` : ''}` });
      }
    }
  }
  const kept = tidy(trips, today);
  if (changed || kept.length !== trips.length) await ctx.memory.set('trips', kept);
}

// ---------- talking ----------
const HELP = `I turn booking confirmations into a trip plan and walk you through it. Paste a confirmation email here (or forward it to my inbox), or say:
• "trips" — your trips, numbered
• "next" — what's coming up
• "packing" — weather and a packing list for your next trip
• "add flight UA123 dec 3 08:15 SFO-JFK"
• "add hotel Marriott Times Square dec 3-6"
• "add car Hertz dec 3 10:00 JFK"
• "delete trip 1"
I remind you to check in 24 hours before each flight, send weather and packing 2 days before, tell you when to leave for the airport, and give you the hotel address on arrival day.`;
const ASK = 'Type the details like this: "add flight UA123 dec 3 08:15 SFO-JFK" or "add hotel Marriott Times Square dec 3-6".';

function addedText(touched, items) {
  const t = touched[0];
  const lines = items.map(describe);
  const missingTime = items.some((i) => i.k === 'f' && !i.t);
  return `Added to your ${destOf(t)} trip (${dates(span(t))}):\n${lines.join('\n')}${missingTime ? '\nA flight has no departure time; add it with "add flight UA123 dec 3 08:15 SFO-JFK" so I can time check-in and leaving.' : ''}\nI'll remind you about check-in, weather and packing, and when to leave.`;
}

function parseAddFlight(arg, today) {
  const fl = findFlights(arg, true)[0];
  const d = allDates(arg, today)[0];
  const t = allTimes(arg)[0];
  const r = allRoutes(arg, true).find((x) => x.v[0] !== fl?.al);
  const missing = [];
  if (!fl) missing.push('the flight number (UA123)');
  if (!d) missing.push('the date (dec 3)');
  if (!r) missing.push('the route (SFO-JFK)');
  if (missing.length) return { missing };
  return { item: { k: 'f', al: fl.al, n: fl.n, d: d.v, t: t ? t.v : '', f: r.v[0], to: r.v[1], cf: confCode(arg) } };
}
function parseAddHotel(arg, today) {
  const dates = allDates(arg, today);
  if (!dates.length) return { missing: ['the dates (dec 3-6)'] };
  const first = dates[0];
  const name = arg.slice(0, first.i).replace(/\b(from|on|at|for)\s*$/i, '').trim();
  let out = dates[1] ? dates[1].v : null;
  if (!out) {
    const m = arg.slice(first.i + first.len).match(/^\s*(?:-|–|to|until|through|thru)\s*(\d{1,2})\b/i);
    if (m) { out = `${first.v.slice(0, 8)}${pad(+m[1])}`; if (out <= first.v) out = addDays(first.v, 1); }
  }
  const nights = arg.match(/(\d+)\s+nights?/i);
  if (!out && nights) out = addDays(first.v, +nights[1]);
  if (!name) return { missing: ['the hotel name'] };
  if (!out) return { missing: ['the check-out date (dec 3-6)'] };
  const ad = arg.match(/address\s*:?\s*(.+)$/i);
  return { item: { k: 'h', nm: cap(name.replace(/\s+/g, ' ')).slice(0, 60), in: first.v, out, ad: ad ? ad[1].trim() : '', cf: '' } };
}
function parseAddCar(arg, today) {
  const d = allDates(arg, today)[0];
  if (!d) return { missing: ['the pick-up date (dec 3)'] };
  const t = allTimes(arg)[0];
  const co = arg.trim().split(/\s+/)[0];
  const code = arg.match(/\b([A-Z]{3})\b/);
  return { item: { k: 'c', co: cap(co.toLowerCase()), d: d.v, t: t ? t.v : '', loc: code ? code[1] : '', cf: '' } };
}

async function intake(ctx, text, inbox) {
  const today = ctx.local().date;
  let { items, partial } = extract(text, today, false);
  let via = 'rules';
  if (!items.length) {
    const out = await ctx.model.generate(`Extract the travel bookings from this confirmation email. Today is ${today}. Answer with JSON only, like {"flights":[{"airline":"UA","number":"123","date":"YYYY-MM-DD","time":"HH:MM","from":"SFO","to":"JFK"}],"hotels":[{"name":"","checkin":"YYYY-MM-DD","checkout":"YYYY-MM-DD","address":""}],"confirmation":""}. Use IATA airport and airline codes.\n\nEmail:\n${text.slice(0, 6000)}`, { maxWords: 200 });
    items = fromModel(out, today);
    via = 'model';
  }
  if (!items.length) {
    if (inbox) await ctx.notify({ title: 'Couldn\'t read that booking', body: `Reply in the chat with the details. ${ASK}` });
    return ctx.reply(`${partial ? 'I found part of a booking but not the date, time or route.' : "I couldn't find booking details in that."} ${ASK}`);
  }
  const trips = (await ctx.memory.get('trips')) || [];
  const touched = addItems(trips, items);
  await ctx.memory.set('trips', tidy(trips, today));
  const msg = addedText(touched, items);
  ctx.log(`Added ${items.length} item(s) using ${via}.`);
  if (inbox) await ctx.notify({ title: `🧳 Added to your ${destOf(touched[0])} trip`, body: items.map(describe).join('\n') });
  return ctx.reply(msg);
}

async function onMessage(ctx) {
  const raw = String(ctx.input.text || '').trim();
  const t = raw.toLowerCase().replace(/\s+/g, ' ').replace(/[?!.]+$/, '');
  const loc = ctx.local();
  const today = loc.date;
  let m;
  if (!t || /^(help|what can you do|commands|hi|hello)$/.test(t)) return ctx.reply(HELP);

  if ((m = raw.match(/^add\s+(flight|hotel|car)\s+(.+)$/is))) {
    const kind = m[1].toLowerCase();
    const p = kind === 'flight' ? parseAddFlight(m[2], today) : kind === 'hotel' ? parseAddHotel(m[2], today) : parseAddCar(m[2], today);
    if (!p.item) return ctx.reply(`I still need ${p.missing.join(' and ')}. For example: ${kind === 'flight' ? '"add flight UA123 dec 3 08:15 SFO-JFK"' : kind === 'hotel' ? '"add hotel Marriott Times Square dec 3-6"' : '"add car Hertz dec 3 10:00 JFK"'}.`);
    const trips = (await ctx.memory.get('trips')) || [];
    const touched = addItems(trips, [p.item]);
    await ctx.memory.set('trips', tidy(trips, today));
    return ctx.reply(addedText(touched, [p.item]));
  }

  if (/^(trips|my trips|list trips|show trips|list)$/.test(t)) {
    const trips = upcoming((await ctx.memory.get('trips')) || [], today);
    if (!trips.length) return ctx.reply('No trips yet. Paste a booking confirmation here, or say "add flight UA123 dec 3 08:15 SFO-JFK".');
    return ctx.reply(trips.map((x, i) => `${i + 1}. ${tripTitle(x)}\n${x.items.map((it) => `   ${describe(it)}`).join('\n')}`).join('\n\n'));
  }

  if ((m = t.match(/^(?:delete|remove|cancel) trip #?(\d+)$/))) {
    const all = (await ctx.memory.get('trips')) || [];
    const list = upcoming(all, today);
    const x = list[Number(m[1]) - 1];
    if (!x) return ctx.reply(`There's no trip ${m[1]}. ${list.length ? `You have ${list.length}; say "trips" to see them.` : 'You have no upcoming trips.'}`);
    await ctx.memory.set('trips', all.filter((y) => y !== x && y.id !== x.id));
    return ctx.reply(`Deleted trip ${m[1]}: ${tripTitle(x)} (${x.items.length} booking${x.items.length === 1 ? '' : 's'}). No more reminders for it.`);
  }

  if (/^(next|what'?s next|whats next|what is next|next trip|upcoming)$/.test(t)) {
    const trips = upcoming((await ctx.memory.get('trips')) || [], today);
    const now = `${today}T${loc.time}`;
    const evs = [];
    for (const trip of trips) for (const i of trip.items) {
      const key = i.k === 'h' ? `${i.in}T15:00` : `${i.d}T${i.t || '00:00'}`;
      if (key.slice(0, 10) > today || (key.slice(0, 10) === today && (key >= now || !i.t))) evs.push({ key, i, trip });
    }
    evs.sort((a, b) => a.key.localeCompare(b.key));
    if (!evs.length) return ctx.reply('Nothing coming up. Paste a booking confirmation, or say "add flight UA123 dec 3 08:15 SFO-JFK".');
    const e = evs[0];
    const days = dayNum(e.key.slice(0, 10)) - dayNum(today);
    const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
    let extra = '';
    let link;
    if (e.i.k === 'f') {
      const al = AIRLINES[e.i.al];
      if (e.i.t) extra = ` Check-in opens ${nice(addDays(e.i.d, -1))} at ${e.i.t}; leave for the airport by ${hm(mins(e.key) - bufferHours(ctx, e.i) * 60)}.`;
      if (al && al[1]) link = { url: al[1], label: `Check in with ${al[0]}` };
    }
    return ctx.reply(`Next (${when}): ${describe(e.i)} — ${destOf(e.trip)} trip.${extra}`, { link });
  }

  if (/^(packing|pack|packing list|what (?:should i|to|do i) pack.*|weather)$/.test(t)) {
    const trips = upcoming((await ctx.memory.get('trips')) || [], today);
    if (!trips.length) return ctx.reply('No upcoming trip to pack for. Paste a booking confirmation first.');
    const trip = trips[0];
    const s = span(trip);
    const w = await forecast(ctx, destOf(trip), s.start, s.end, today);
    const note = w ? weatherLine(w) : s.start > addDays(today, 15) ? `The forecast for ${destOf(trip)} isn't out yet (more than 16 days away); I'll send it 2 days before.` : `I couldn't get the forecast for ${destOf(trip)} right now.`;
    return ctx.reply(`${tripTitle(trip)}\n${note}\nPack: ${packingList(trip, w).join(', ')}.`);
  }

  if (raw.length > 60 || findFlights(raw, false).length || /\b(confirmation|itinerary|booking|reservation|check-in|e-ticket|pnr)\b/i.test(raw)) return intake(ctx, raw, false);

  return ctx.reply(`I didn't catch that ("${raw.slice(0, 60)}"). Paste a booking confirmation, or try "trips", "next", "packing", "add flight UA123 dec 3 08:15 SFO-JFK" or "help".`);
}

async function run(ctx) {
  const type = ctx.trigger.type;
  if (type === 'message') return onMessage(ctx);
  if (type === 'inbox') {
    const text = String(ctx.input.text || (ctx.input.data && (ctx.input.data.text || ctx.input.data.body)) || '').trim();
    if (!text) return ctx.reply('Your inbox got an empty message; nothing to add.');
    return intake(ctx, text, true);
  }
  return timeline(ctx);
}
