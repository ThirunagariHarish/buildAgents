// Money Manager: a running ledger of what you spend, fed by plain messages,
// bank texts and Apple Pay purchases; budgets, bills, subscriptions, a daily
// safe-to-spend, a Sunday review and a monthly report.
//
// Memory:
//   ledger  [[day, cents, cat, merchant, flags, id]]  day = days since 1970-01-01 (local date),
//           cents > 0 spent (or income when cat = Income), < 0 refund; flags 1 = inbox, 2 = refund
//   state   { n: next id, r: {merchantKey: cat} rules, bo: {budgetKey: cents} overrides,
//             ba: [{n, c, d, l}] added bills, br: [billKey] removed bills, al: {alertKey: day},
//             sent: {key: day}, sn: {merchantKey: day} subscriptions told, seen: [[minute, key]],
//             ll: [ids] last list, d: last daily date, rep: last month reported }

const CATS = ['Groceries', 'Dining', 'Transport', 'Shopping', 'Subscriptions', 'Utilities', 'Housing', 'Health', 'Travel', 'Entertainment', 'Income', 'Other'];
const INC = 10;
const OTH = 11;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WD = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const KEEP_DAYS = 548; // 18 months
let CUR = '$';

// Merchant keywords per category (already normalised: lowercase, punctuation as spaces).
// "key=Display name"; a leading "~" marks a generic word that sets the category but keeps the owner's name.
const KW_SRC = [
  /* Groceries */ "costco|walmart|kroger|whole foods|trader joe=Trader Joe's|safeway|aldi|h e b=H-E-B|heb=H-E-B|publix|wegmans|albertsons|sprouts|food lion|meijer|vons|ralphs|giant eagle|stop & shop=Stop & Shop|winco|instacart|sams club=Sam's Club|sam s club=Sam's Club|7 eleven=7-Eleven|bigbasket=BigBasket|big basket=BigBasket|blinkit|zepto|dmart=DMart|jiomart=JioMart|reliance fresh|swiggy instamart=Instamart|instamart|nature s basket=Nature's Basket|spencers=Spencer's|~grocery|~groceries|~supermarket|~market|~milk|~vegetables",
  /* Dining */ "starbucks|mcdonald=McDonald's|chipotle|doordash=DoorDash|uber eats=Uber Eats|ubereats=Uber Eats|grubhub|postmates|swiggy|zomato|dunkin|subway|taco bell|wendy=Wendy's|burger king|kfc=KFC|domino=Domino's|pizza hut|panera|chick fil a=Chick-fil-A|chickfila=Chick-fil-A|panda express|five guys|shake shack|sweetgreen|in n out=In-N-Out|blue bottle|peet=Peet's|tim hortons|dutch bros|cava|haldiram=Haldiram's|chaayos|cafe coffee day|barista|~coffee|~cafe|~restaurant|~lunch|~dinner|~breakfast|~brunch|~pizza|~burger|~takeout|~tacos|~sushi|~bakery|~food|~drinks|~beer|~snacks",
  /* Transport */ "uber|lyft|ola|rapido|shell|chevron|exxon|exxonmobil=ExxonMobil|mobil|bp=BP|arco=ARCO|valero|sunoco|speedway|circle k|marathon petro=Marathon|76|wawa|quiktrip=QuikTrip|indian oil|hpcl=HPCL|bpcl=BPCL|iocl=IOCL|fastag=FASTag|e zpass=E-ZPass|ezpass=E-ZPass|fastrak=FasTrak|clipper|mta=MTA|bart=BART|caltrain|metro card|~gas|~fuel|~petrol|~diesel|~parking|~toll|~tolls|~taxi|~cab|~bus|~metro|~transit|~car wash|~oil change",
  /* Shopping */ "amazon|amzn=Amazon|amzn mktp=Amazon|target|best buy|flipkart|myntra|ajio|nykaa|meesho|ebay|etsy|ikea=IKEA|home depot|lowe=Lowe's|macy=Macy's|nordstrom|tj maxx=TJ Maxx|tjmaxx=TJ Maxx|marshalls|ross|kohl=Kohl's|old navy|gap|uniqlo|zara|h&m=H&M|nike|apple store|sephora|ulta|shein|temu|wayfair|croma|reliance digital|decathlon|dollar tree|michaels|staples|~shopping|~clothes|~shoes|~gift|~gifts",
  /* Subscriptions */ "netflix|spotify|hulu|disney plus=Disney+|disneyplus=Disney+|disney=Disney+|youtube premium=YouTube Premium|youtube=YouTube|apple com bill=Apple|itunes=Apple|icloud=iCloud|chatgpt=ChatGPT|openai=OpenAI|anthropic|claude ai=Claude|hbo max=Max|paramount=Paramount+|peacock|audible|kindle unlimited|prime video=Prime Video|amazon prime=Amazon Prime|adobe|dropbox|google one|google storage=Google One|microsoft 365|office 365=Microsoft 365|xbox game pass=Xbox Game Pass|playstation plus=PlayStation Plus|patreon|substack|new york times=NYTimes|nytimes=NYTimes|wsj=WSJ|medium|linkedin premium=LinkedIn Premium|duolingo|headspace|calm|hotstar=Disney+ Hotstar|jiocinema=JioCinema|sonyliv=SonyLIV|zee5=ZEE5|github=GitHub|notion|canva|1password=1Password|nordvpn=NordVPN|expressvpn=ExpressVPN|~subscription|~membership",
  /* Utilities */ "comcast|xfinity|at&t=AT&T|att=AT&T|verizon|t mobile=T-Mobile|tmobile=T-Mobile|sprint|spectrum|cox|pg&e=PG&E|pge=PG&E|con edison|coned=Con Edison|duke energy|national grid|southern california edison|airtel|jio|vodafone|bsnl=BSNL|tata power|bescom=BESCOM|adani electricity|act fibernet=ACT Fibernet|~electric|~electricity|~power bill|~water bill|~internet|~wifi|~phone bill|~utility|~utilities|~mobile recharge|~recharge",
  /* Housing */ "~rent|~mortgage|~landlord|~hoa|~maintenance|~property tax|~home insurance|~renters insurance",
  /* Health */ "cvs=CVS|walgreens|rite aid|apollo pharmacy|apollo|1mg=Tata 1mg|pharmeasy=PharmEasy|netmeds|practo|kaiser|planet fitness|equinox|cult fit=Cult.fit|cultfit=Cult.fit|24 hour fitness|la fitness=LA Fitness|~pharmacy|~doctor|~dentist|~dental|~hospital|~clinic|~medical|~medicine|~gym|~therapy|~yoga|~vitamins",
  /* Travel */ "airbnb|delta|united airlines|united|american airlines|southwest|jetblue=JetBlue|alaska air|spirit airlines|frontier airlines|marriott|hilton|hyatt|ihg=IHG|holiday inn|expedia|booking com=Booking.com|hotels com=Hotels.com|kayak|vrbo=Vrbo|indigo=IndiGo|air india|vistara|spicejet=SpiceJet|akasa|makemytrip=MakeMyTrip|goibibo|cleartrip|irctc=IRCTC|oyo=OYO|amtrak|greyhound|~hotel|~flight|~airline|~airport|~trip|~vacation",
  /* Entertainment */ "amc=AMC|regal|cinemark|fandango|ticketmaster|stubhub=StubHub|eventbrite|steam|bookmyshow=BookMyShow|pvr=PVR|inox=INOX|nintendo|~movie|~movies|~cinema|~concert|~tickets|~game|~games|~bowling|~museum|~books",
  /* Income */ "~payroll|~salary|~paycheck|~direct deposit|~interest|~dividend|~bonus",
  /* Other */ '',
];

// Budget / category words → categories.
const ALIAS = {
  food: [0, 1], groceries: [0], grocery: [0], supermarket: [0],
  dining: [1], 'dining out': [1], 'eating out': [1], restaurants: [1], restaurant: [1], takeout: [1], coffee: [1], 'food delivery': [1],
  transport: [2], transportation: [2], gas: [2], fuel: [2], car: [2], commute: [2], rides: [2], petrol: [2],
  shopping: [3], stuff: [3], clothes: [3],
  subscriptions: [4], subscription: [4], subs: [4], streaming: [4],
  utilities: [5], utility: [5], bills: [5], phone: [5], internet: [5],
  housing: [6], rent: [6], mortgage: [6], home: [6],
  health: [7], medical: [7], pharmacy: [7], fitness: [7], gym: [7],
  travel: [8], trips: [8], vacation: [8], holidays: [8],
  entertainment: [9], fun: [9], movies: [9], games: [9],
  income: [10], other: [11], misc: [11], miscellaneous: [11],
};

const CANCEL = {
  netflix: 'https://www.netflix.com/cancelplan', spotify: 'https://www.spotify.com/account/subscription/',
  hulu: 'https://secure.hulu.com/account', disney: 'https://www.disneyplus.com/account/subscription',
  youtube: 'https://www.youtube.com/paid_memberships', apple: 'https://apps.apple.com/account/subscriptions',
  icloud: 'https://apps.apple.com/account/subscriptions', amazonprime: 'https://www.amazon.com/gp/primecentral',
  primevideo: 'https://www.amazon.com/gp/primecentral', audible: 'https://www.audible.com/account/overview',
  adobe: 'https://account.adobe.com/plans', dropbox: 'https://www.dropbox.com/account/plan',
  googleone: 'https://one.google.com/settings', peacock: 'https://www.peacocktv.com/account/plans',
  paramount: 'https://www.paramountplus.com/account/', chatgpt: 'https://chatgpt.com/#settings/Subscription',
  openai: 'https://chatgpt.com/#settings/Subscription', linkedinpremium: 'https://www.linkedin.com/premium/manage/',
  microsoft365: 'https://account.microsoft.com/services', xboxgamepass: 'https://account.microsoft.com/services',
  patreon: 'https://www.patreon.com/settings/memberships', nytimes: 'https://myaccount.nytimes.com/seg/subscription',
  max: 'https://auth.max.com/subscription',
};

async function run(ctx) {
  const L = ctx.local();
  CUR = String(ctx.settings.currency || '').trim().slice(0, 4) || '$';
  const today = dayNum(L.date);
  const E = {
    ctx, L, today,
    dmy: /₹|rs|inr|£|€/i.test(CUR) || (!/^America\//.test(L.tz) && L.tz !== 'UTC'),
    ledger: (await ctx.memory.get('ledger')) || [],
    st: (await ctx.memory.get('state')) || {},
    dl: false, ds: false, replies: [],
  };
  if (!Array.isArray(E.ledger)) E.ledger = [];
  const st = E.st;
  st.n = st.n || E.ledger.reduce((m, e) => Math.max(m, e[5] || 0), 0) + 1;
  for (const k of ['r', 'bo', 'al', 'sent', 'sn']) if (!st[k] || typeof st[k] !== 'object' || Array.isArray(st[k])) st[k] = {};
  for (const k of ['ba', 'br', 'seen', 'll']) if (!Array.isArray(st[k])) st[k] = [];
  E.budgets = budgetsOf(E);
  E.bills = billsOf(E);

  const type = ctx.trigger.type;
  if (type === 'message') await onMessage(E);
  else if (type === 'inbox') await onInbox(E);
  else await onDaily(E);

  if (E.dl) {
    const cut = today - KEEP_DAYS;
    E.ledger = E.ledger.filter((e) => e[0] >= cut);
    await ctx.memory.set('ledger', E.ledger);
  }
  if (E.ds || E.dl) {
    for (const k of ['al', 'sent']) for (const x of Object.keys(st[k])) if (st[k][x] < today - 70) delete st[k][x];
    await ctx.memory.set('state', st);
  }
}

// ---------- dates and money ----------
function dayNum(iso) { const [y, m, d] = String(iso).split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); }
function dn(y, m, d) { return Math.round(Date.UTC(y, m - 1, d) / 864e5); }
function ymd(n) { const d = new Date(n * 864e5); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), wd: d.getUTCDay() }; }
function monthLen(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
function mkey(n) { const t = ymd(n); return `${t.y}-${String(t.m).padStart(2, '0')}`; }
function prevMonth(y, m) { return m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 }; }
function monthRange(y, m) { return [dn(y, m, 1), dn(y, m, monthLen(y, m))]; }
function fdate(n) { const t = ymd(n); return `${MONTHS[t.m - 1].slice(0, 3)} ${t.d}`; }
function fday(n) { const t = ymd(n); return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][t.wd]} ${fdate(n)}`; }
function money(c, dec) {
  const neg = c < 0;
  const v = Math.abs(c) / 100;
  const s = dec ? v.toFixed(2) : String(Math.round(v));
  const [i, f] = s.split('.');
  return `${neg ? '-' : ''}${CUR}${i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${f ? `.${f}` : ''}`;
}
function pct(a, b) { return b > 0 ? Math.round((a / b) * 100) : 0; }
function toCents(s) {
  let t = String(s == null ? '' : s).trim().toLowerCase();
  let mult = 1;
  if (/k$/.test(t)) { mult = 1000; t = t.slice(0, -1); }
  t = t.replace(/[^\d.,]/g, '');
  if (/^\d+,\d{2}$/.test(t)) t = t.replace(',', '.');
  t = t.replace(/,/g, '');
  const v = parseFloat(t);
  return Number.isFinite(v) && v > 0 ? Math.round(v * mult * 100) : null;
}
function change(now, before) {
  if (!before) return '';
  const p = Math.round(((now - before) / before) * 100);
  return `${p >= 0 ? '+' : ''}${p}%`;
}

// ---------- text helpers ----------
function normText(s) { return String(s || '').toLowerCase().replace(/[’‘`]/g, "'").replace(/[^a-z0-9&]+/g, ' ').trim(); }
function normKey(s) { return normText(s).replace(/ /g, ''); }
function title(s) { return String(s).split(' ').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' '); }
function hasWord(text, w) { return ` ${normText(text)} `.includes(` ${normText(w)} `); }

let KW = null;
function kwList() {
  if (KW) return KW;
  KW = [];
  KW_SRC.forEach((src, cat) => {
    for (const e of src.split('|')) {
      if (!e) continue;
      const generic = e[0] === '~';
      const [k, name] = (generic ? e.slice(1) : e).split('=');
      KW.push({ k, name: name || title(k), cat, generic });
    }
  });
  KW.sort((a, b) => b.k.length - a.k.length);
  return KW;
}
function kwMatch(text) {
  const p = ` ${normText(text)} `;
  let gen = null;
  for (const w of kwList()) {
    if (p.includes(` ${w.k} `) || p.includes(` ${w.k}s `)) {
      if (!w.generic) return w;
      if (!gen) gen = w;
    }
  }
  return gen;
}
function cleanName(raw) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (s.includes('*')) {
    const parts = s.split('*').map((x) => x.trim()).filter(Boolean);
    if (parts.length > 1 && /^(sq|sqc|tst|sp|pp|paypal|py|dd|in|ic|pos|bt|gg|eb|fs|wl|wpy|lmt|par|google|goog|cke|ck)$/i.test(parts[0])) s = parts.slice(1).join(' ');
    else s = parts[0] || s;
  }
  s = s.replace(/#\s*\d+/g, ' ')
    .replace(/\b(pos|whse|wholesale|purchase|debit|credit|card|visa|mastercard|recurring|txn|inc|llc|ltd|pvt|corp|store|online|www|com|net|org|usa|us)\b\.?/gi, ' ');
  let toks = s.split(/[\s/,]+/).filter((w) => w && !/\d{3,}/.test(w) && !/^(?=.*\d)(?=.*[a-z])[a-z\d]{5,}$/i.test(w) && !/^[-.:]+$/.test(w));
  if (toks.length > 2 && /^[A-Z]{2}$/.test(toks[toks.length - 1])) toks = toks.slice(0, -1);
  const out = title(toks.join(' ').replace(/[^\w&'+ .-]/g, '').trim()).slice(0, 30).trim();
  return out || 'Unknown';
}
// A category from the owner's word ("groceries", "eating out", "lunch").
function catFromWord(w) {
  const t = normText(w).replace(/^(the|my|a|an)\s+/, '').replace(/\s+(category|budget)$/, '');
  if (!t) return null;
  if (ALIAS[t]) return ALIAS[t][0];
  const i = CATS.findIndex((c) => c.toLowerCase() === t || c.toLowerCase().startsWith(t) && t.length >= 4);
  if (i >= 0) return i;
  const h = kwMatch(t);
  return h ? h.cat : null;
}
function catsFor(name) {
  const t = normText(name);
  if (ALIAS[t]) return ALIAS[t];
  const i = CATS.findIndex((c) => c.toLowerCase() === t || c.toLowerCase() === t.replace(/s$/, ''));
  if (i >= 0) return [i];
  const h = kwMatch(t);
  return h ? [h.cat] : [OTH];
}

// ---------- settings ----------
function lines(v) { return (Array.isArray(v) ? v.map(String) : String(v == null ? '' : v).split(/\r?\n|;/)).map((s) => s.trim()).filter(Boolean); }
function budgetsOf(E) {
  const out = [];
  const seen = {};
  for (const ln of lines(E.ctx.settings.budgets)) {
    const m = ln.match(/^(.+?)\s*[:=-]?\s*[$₹€£]?\s*(\d[\d,]*(?:\.\d+)?k?)\s*(?:\/\s*mo(?:nth)?|a month|per month|monthly)?$/i);
    if (!m) continue;
    const name = title(m[1].replace(/[:=-]+$/, '').trim());
    const key = normText(name);
    const lim = toCents(m[2]);
    if (!lim || seen[key]) continue;
    seen[key] = 1;
    out.push({ name, key, lim, cats: catsFor(name) });
  }
  for (const [key, lim] of Object.entries(E.st.bo)) {
    const b = out.find((x) => x.key === key);
    if (b) b.lim = lim;
    else out.push({ name: title(key), key, lim, cats: catsFor(key) });
  }
  return out.filter((b) => b.lim > 0);
}
function parseBill(ln) {
  const url = (ln.match(/https?:\/\/\S+/i) || [])[0] || '';
  const s = ln.replace(/https?:\/\/\S+/i, '').trim();
  const m = s.match(/^(.+?)\s+[$₹€£]?\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(?:,\s*)?(?:(?:due\s+)?(?:on|due|every)\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?$/i);
  if (!m) return null;
  const d = Number(m[3]);
  const c = toCents(m[2]);
  if (!c || d < 1 || d > 31) return null;
  return { n: title(m[1].replace(/[:-]+$/, '').trim()).slice(0, 30), c, d, l: url };
}
function billsOf(E) {
  const added = E.st.ba;
  const keys = new Set(added.map((b) => normKey(b.n)));
  const removed = new Set(E.st.br);
  const out = [];
  for (const ln of lines(E.ctx.settings.bills)) {
    const b = parseBill(ln);
    if (b && !keys.has(normKey(b.n)) && !removed.has(normKey(b.n))) out.push(b);
  }
  return out.concat(added);
}
function income(E) { const v = toCents(E.ctx.settings.income); return v || 0; }

// ---------- ledger maths ----------
function isSpend(e) { return e[2] !== INC; }
function sumSpend(E, from, to, cats) {
  let s = 0;
  for (const e of E.ledger) if (isSpend(e) && e[0] >= from && e[0] <= to && (!cats || cats.includes(e[2]))) s += e[1];
  return s;
}
function byCat(E, from, to) {
  const t = {};
  for (const e of E.ledger) if (isSpend(e) && e[0] >= from && e[0] <= to) t[e[2]] = (t[e[2]] || 0) + e[1];
  return Object.entries(t).map(([c, v]) => ({ c: Number(c), v })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
}
function byMerchant(E, from, to) {
  const t = {};
  for (const e of E.ledger) {
    if (!isSpend(e) || e[0] < from || e[0] > to) continue;
    const k = normKey(e[3]);
    if (!t[k]) t[k] = { name: e[3], v: 0, n: 0 };
    t[k].v += e[1]; t[k].n += 1;
  }
  return Object.values(t).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
}
function thisMonth(E) { const t = ymd(E.today); return monthRange(t.y, t.m); }
function budgetFor(E, cat) { return E.budgets.find((b) => b.cats.includes(cat)) || null; }
function budgetLine(E, cat) {
  const [from] = thisMonth(E);
  const b = budgetFor(E, cat);
  if (b) { const sp = sumSpend(E, from, E.today, b.cats); return `${b.name}: ${money(sp)} of ${money(b.lim)} (${pct(sp, b.lim)}%).`; }
  const v = sumSpend(E, from, E.today, [cat]);
  return `${CATS[cat]} this month: ${money(v, v % 100 !== 0 && Math.abs(v) < 10000)}.`;
}
function billKeyMatch(bill, e) { const a = normKey(bill.n), b = normKey(e[3]); return a && b && (a === b || b.includes(a) || a.includes(b)); }
function nextDue(b, today) {
  const t = ymd(today);
  for (let off = 0; off < 2; off++) {
    let y = t.y, m = t.m + off;
    if (m > 12) { m = 1; y += 1; }
    const n = dn(y, m, Math.min(b.d, monthLen(y, m)));
    if (n >= today) return n;
  }
  return today;
}
function paidFor(E, b, due) { return E.ledger.find((e) => isSpend(e) && e[1] > 0 && e[0] >= due - 20 && e[0] <= E.today && billKeyMatch(b, e)) || null; }

function subsOf(E, asOf, onlyKey) {
  const groups = {};
  const billKeys = E.bills.map((b) => normKey(b.n));
  for (const e of E.ledger) {
    if (e[1] <= 0 || e[0] > asOf || [0, 1, 2, 6, INC].includes(e[2])) continue;
    const k = normKey(e[3]);
    if (onlyKey && k !== onlyKey) continue;
    if (billKeys.includes(k)) continue;
    (groups[k] = groups[k] || []).push(e);
  }
  const out = [];
  for (const [k, es] of Object.entries(groups)) {
    es.sort((a, b) => a[0] - b[0]);
    let hit = false;
    for (let i = 1; i < es.length && !hit; i++) {
      for (let j = i - 1; j >= 0; j--) {
        const gap = es[i][0] - es[j][0];
        if (gap > 35) break;
        if (gap >= 25 && mkey(es[i][0]) !== mkey(es[j][0]) && Math.abs(es[i][1] - es[j][1]) <= 0.1 * es[j][1]) { hit = true; break; }
      }
    }
    if (hit) { const last = es[es.length - 1]; out.push({ k, name: last[3], c: last[1], last: last[0] }); }
  }
  return out.sort((a, b) => b.c - a.c);
}
function cancelLink(name) {
  const k = normKey(name);
  const hit = Object.keys(CANCEL).sort((a, b) => b.length - a.length).find((x) => k === x || k.startsWith(x));
  return hit ? { url: CANCEL[hit], label: `Cancel ${name}`.slice(0, 40) } : null;
}

// ---------- adding an entry ----------
function resolveName(raw, kind) {
  const hit = kwMatch(raw);
  let name = hit && !hit.generic ? hit.name : cleanName(raw);
  if ((!raw || !String(raw).trim()) && kind === 'income') name = 'Paycheck';
  else if (!raw || !String(raw).trim()) name = 'Misc';
  return { name, hit };
}
async function resolveCat(E, name, hit, kind) {
  if (kind === 'income') return { cat: INC };
  const rk = normKey(name);
  if (E.st.r[rk] !== undefined) return { cat: E.st.r[rk] };
  if (hit && hit.cat !== INC) return { cat: hit.cat };
  if (name === 'Misc' || name === 'Unknown') return { cat: OTH, unknown: true };
  const ans = await E.ctx.model.generate(`Which spending category fits the merchant "${name}"? Answer with exactly one word from: ${CATS.filter((c) => c !== 'Income').join(', ')}.`, { maxWords: 5 });
  if (ans) {
    const low = ans.toLowerCase();
    const i = CATS.findIndex((c, ix) => ix !== INC && low.includes(c.toLowerCase()));
    if (i >= 0 && i !== OTH) { E.st.r[rk] = i; return { cat: i, guessed: true }; }
  }
  return { cat: OTH, unknown: true };
}
// Adds the entry and works out what matters about it: budget lines, alerts, subscriptions, unusual size.
async function addEntry(E, p, inbox) {
  const { name, hit } = resolveName(p.merchant, p.kind);
  const rc = await resolveCat(E, name, hit, p.kind);
  const cents = p.kind === 'refund' ? -p.cents : p.cents;
  const e = [p.day, cents, rc.cat, name, (inbox ? 1 : 0) | (p.kind === 'refund' ? 2 : 0), E.st.n];
  // Unusual: compared with what came before in this category.
  const prior = E.ledger.filter((x) => x[2] === rc.cat && x[1] > 0 && rc.cat !== INC);
  E.ledger.push(e);
  E.st.n += 1;
  E.dl = true;
  const out = { e, name, cat: rc.cat, rc, alerts: [], link: null };
  if (p.kind !== 'spend') return out;
  if (prior.length >= 3) {
    const avg = prior.reduce((s, x) => s + x[1], 0) / prior.length;
    if (p.cents > 3 * avg && p.cents > 5000) out.alerts.push({ t: `Large charge: ${money(p.cents, 1)} at ${name}`, b: `That's ${(p.cents / avg).toFixed(1)}× your usual ${CATS[rc.cat]} charge (${money(avg, 1)}). Not you? Call your bank.` });
  }
  const [from, to] = thisMonth(E);
  if (p.day >= from && p.day <= to) {
    for (const b of E.budgets.filter((x) => x.cats.includes(rc.cat))) {
      const sp = sumSpend(E, from, E.today, b.cats);
      const pc = pct(sp, b.lim);
      const mk = mkey(E.today);
      for (const th of [100, 80]) {
        const key = `${mk}|${b.key}|${th}`;
        if (pc < th || E.st.al[key]) continue;
        E.st.al[key] = E.today;
        if (th === 100) E.st.al[`${mk}|${b.key}|80`] = E.today;
        const left = to - E.today + 1;
        out.alerts.push(th === 100
          ? { t: `${b.name} budget used up (${pc}%)`, b: `${b.name}: ${money(sp)} of ${money(b.lim)} with ${left} day${left === 1 ? '' : 's'} left in ${MONTHS[ymd(E.today).m - 1]}, ${money(sp - b.lim)} over.`, s: `That's ${money(sp - b.lim)} over your ${b.name} budget with ${left} day${left === 1 ? '' : 's'} to go.` }
          : { t: `${b.name} budget at ${pc}%`, b: `${b.name}: ${money(sp)} of ${money(b.lim)}, ${money(b.lim - sp)} left for ${left} day${left === 1 ? '' : 's'}.`, s: `Heads up: ${pc}% of your ${b.name} budget is gone, ${money(b.lim - sp)} left for ${left} day${left === 1 ? '' : 's'}.` });
        break;
      }
    }
  }
  const k = normKey(name);
  if (!E.st.sn[k]) {
    const s = subsOf(E, E.today, k)[0];
    if (s) {
      E.st.sn[k] = E.today;
      const cl = cancelLink(name);
      out.alerts.push({ t: `New subscription: ${name} ${money(s.c, 1)}/month`, b: `${name} charges about ${money(s.c, 1)} a month (${money(s.c * 12)} a year).${cl ? ' Not using it? Cancel with one tap.' : ''}` });
      if (cl) out.link = cl;
    }
  }
  return out;
}
function loggedLine(E, r, p) {
  const when = r.e[0] !== E.today ? ` (${r.e[0] === E.today - 1 ? 'yesterday, ' : ''}${fdate(r.e[0])})` : '';
  if (p.kind === 'income') {
    const [from] = thisMonth(E);
    const inc = E.ledger.filter((e) => e[2] === INC && e[0] >= from).reduce((s, e) => s + e[1], 0);
    return `Logged income ${money(p.cents, 1)} (${r.name})${when}. Income this month: ${money(inc)}.`;
  }
  const verb = p.kind === 'refund' ? 'refund' : '';
  let s = `Logged ${verb ? `${verb} ` : ''}${money(p.cents, 1)} ${r.name} → ${CATS[r.cat]}${when}.`;
  if (r.rc.guessed) s += ` (My guess; say "that was groceries" or another category to fix.)`;
  if (r.rc.unknown && r.name !== 'Misc') s += ` Say "${r.name.toLowerCase()} is dining" (or any category) and I'll remember.`;
  if (r.name === 'Misc') s += ' Say "that was dining" (or any category) to file it.';
  if (r.cat !== OTH || budgetFor(E, r.cat)) s += ` ${budgetLine(E, r.cat)}`;
  return s;
}

// ---------- messages ----------
async function say(E, text, link) { await E.ctx.reply(text, link ? { link } : undefined); }

async function onMessage(E) {
  const orig = String(E.ctx.input.text || '').trim();
  let low = orig.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 2; i++) low = low.replace(/^(?:hey|hi|ok|okay|so|no|nope|actually|oops|um|please|wait)\b[,!.]?\s*/, '');
  low = low.replace(/[?!]+$/, '').replace(/\.$/, '').trim();
  let m;
  if (!low || /^(help|commands|menu|what can you do|how does this work|what do you understand|\?)/.test(low)) return say(E, helpText(E));
  if (/^(undo|scratch that|delete last|remove last|undo last|undo that|cancel last|cancel that|delete that|remove that|delete the last one|remove the last one)$/.test(low)) return undo(E);
  if ((m = low.match(/^(?:delete|remove|del)\s+(?:#|no\.?\s*|number\s+|entry\s+)?(\d{1,2})$/))) return delN(E, Number(m[1]));
  if ((m = low.match(/^(?:set|change|make|update)?\s*(?:the\s+|my\s+)?(?:budget\s+(?:for\s+|on\s+)?(.+?)|(.+?)\s+budget)\s+(?:to\s+|=\s*|at\s+|is\s+)?[$₹€£]?\s*(\d[\d,]*(?:\.\d+)?k?)$/))) return setBudget(E, (m[1] || m[2]).trim(), toCents(m[3]));
  if ((m = low.match(/^(?:remove|delete|drop|clear)\s+(?:the\s+|my\s+)?(?:budget\s+(?:for\s+)?(.+)|(.+?)\s+budget)$/))) return setBudget(E, (m[1] || m[2]).trim(), 0);
  if (/^add\s+(?:a\s+)?bill\b/.test(low)) return addBill(E, orig);
  if ((m = low.match(/^(?:remove|delete|drop|cancel|stop)\s+(?:the\s+|my\s+)?(?:bill\s+(?:for\s+)?(.+)|(.+?)\s+bill)$/))) return removeBill(E, (m[1] || m[2]).trim());
  if ((m = low.match(/^(?:that|it|this|that one|last one|the last one|last|last entry|the last entry)\s+(?:was|is|should be|should have been|goes (?:to|in|under)|=|to|as)\s+(?:an?\s+|in\s+|for\s+|under\s+)?(.+)$/))
    || (m = low.match(/^(?:make|change|move|switch|recategori[sz]e|put|file)\s+(?:that|it|this|last one|the last one|last|the last entry)\s+(?:to|as|into|in|under)\s+(.+)$/))) return fixLast(E, m[1]);
  if ((m = low.match(/^(?:categori[sz]e|file|put|always file)\s+(.+?)\s+(?:as|under|in|into)\s+(.+)$/))
    || (m = low.match(/^(.+?)\s+(?:is|are|=|->|→|goes to|goes in|goes under|should be|is always|always goes to)\s+(?:an?\s+|always\s+|in\s+|under\s+)?(.+)$/))) {
    const left = m[1].trim();
    if (!/\d/.test(left) && !/^(how|what|when|where|why|which|who|is|my|i|total|budget|safe|this|last|spending)\b/.test(left) && catFromWord(m[2]) !== null) return learn(E, left, catFromWord(m[2]));
  }
  const question = /^(how|what|show|when|where|why|which|is|are|do|did|can|tell|give)\b/.test(low);
  const p = !question ? parseLogMsg(low, E) : null;
  if (p) {
    const r = await addEntry(E, p, false);
    let text = loggedLine(E, r, p);
    if (r.alerts.length) text += `\n${r.alerts.map((a) => a.s || a.b).join('\n')}`;
    E.ds = true;
    return say(E, text, r.link);
  }
  if (/\b(safe to spend|can i spend|left to spend|daily allowance|spend today|allowance)\b/.test(low)) return say(E, safeReply(E));
  if (/\b(subs|subscriptions?|recurring)\b/.test(low)) return subsReply(E);
  if (/^(list|recent|history|entries|transactions|ledger|show (?:me )?(?:the )?(?:list|entries|recent|last|transactions))\b|\blast (?:10|ten) (?:entries|transactions)\b/.test(low)) return listReply(E);
  if (/\b(top merchants?|biggest merchants?|top stores?|where do i spend|where did i spend|top places)\b/.test(low)) return topReply(E, low);
  if (/\b(bills?|due)\b/.test(low)) return billsReply(E);
  if (/\b(report|summary|review|recap)\b/.test(low)) return reportReply(E, low);
  if (/\b(budgets?|how am i doing|status|on track)\b/.test(low)) return budgetReply(E);
  if (/\b(how much|spent|spend|spending|total|today|yesterday|week|month|year)\b/.test(low) || catFromWord(low) !== null) return spendReply(E, low);
  return say(E, `I didn't catch an amount or a question in "${orig.slice(0, 60)}". Try "spent 42 at costco", "uber 18.50", "how much on food this month", "budget" or "help".`);
}

function extractDate(s, E) {
  const today = E.today;
  const t = ymd(today);
  let day = null;
  const MON = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
  const pastYear = (m, d) => { if (m < 1 || m > 12 || d < 1 || d > monthLen(t.y, m)) return null; const n = dn(t.y, m, d); return n > today ? dn(t.y - 1, m, Math.min(d, monthLen(t.y - 1, m))) : n; };
  const monIx = (w) => ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(w.slice(0, 3)) + 1;
  const rules = [
    [/\b(?:on\s+)?(?:the\s+)?day before yesterday\b/, () => today - 2],
    [/\b(?:on\s+)?yesterday\b|\blast night\b/, () => today - 1],
    [/\b(?:on\s+)?today\b|\btonight\b|\bthis morning\b/, () => today],
    [/\b(\d{1,2})\s+days?\s+ago\b/, (a) => today - Number(a[1])],
    [new RegExp(`\\b(?:on\\s+)?${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`), (a) => pastYear(monIx(a[1]), Number(a[2]))],
    [new RegExp(`\\b(?:on\\s+)?(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MON}(?=\\s|$)`), (a) => pastYear(monIx(a[2]), Number(a[1]))],
    [/\b(?:on\s+)?(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\b/, (a) => (E.dmy ? pastYear(Number(a[2]), Number(a[1])) : pastYear(Number(a[1]), Number(a[2])))],
    [/\b(?:on\s+)?(last\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues|tue|wed|thurs|thur|thu|fri|sat)\b/, (a) => { const diff = (t.wd - WD.indexOf(a[2].slice(0, 3)) + 7) % 7; return today - (diff === 0 && a[1] ? 7 : diff); }],
  ];
  for (const [re, fn] of rules) {
    const a = s.match(re);
    if (!a) continue;
    const d = fn(a);
    if (d === null || d > today) continue;
    day = d;
    s = s.replace(re, ' ');
    break;
  }
  return { day, rest: s };
}

const FILL = new Set(['spent', 'spend', 'paid', 'pay', 'for', 'at', 'on', 'in', 'to', 'from', 'bought', 'buy', 'purchased', 'purchase', 'got', 'get', 'a', 'an', 'the', 'my', 'i', 'some', 'just', 'of', 'was', 'with', 'via', 'using', 'dollars', 'dollar', 'bucks', 'rupees', 'cost', 'costs', 'charged', 'and', 'me', 'refund', 'refunded', 'returned', 'reimbursed', 'cashback', 'received', 'income', 'earned', 'deposit', 'deposited', 'back', 'it', 'is', 'had', 'did']);
function parseLogMsg(low, E) {
  const dt = extractDate(` ${low} `, E);
  let s = dt.rest.replace(/[$₹€£]/g, ' ').replace(/\b(?:rs|inr|usd|eur|gbp)\.?(?=\s|\d|$)/g, ' ');
  s = s.replace(/(\d)(?:rs|bucks)\b/g, '$1 ');
  const toks = s.split(/\s+/).filter(Boolean);
  const ai = toks.findIndex((w) => /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?k?$/.test(w));
  if (ai < 0) return null;
  const cents = toCents(toks[ai]);
  if (!cents) return null;
  let kind = 'spend';
  if (/\b(refund|refunded|returned|reimbursed|reimbursement|cashback)\b/.test(low)) kind = 'refund';
  else if (/^(?:i\s+)?(?:got paid|get paid|was paid|paid me|salary|paycheck|pay ?check|payday|income|received|earned|bonus|deposit(?:ed)?)\b/.test(low) || /^got\b.*\bfrom\b/.test(low)) kind = 'income';
  const merchant = toks.filter((w, i) => i !== ai && !FILL.has(w)).join(' ').replace(/^[^a-z0-9]+|[^a-z0-9'+&]+$/g, '');
  return { cents, merchant, day: dt.day === null ? E.today : dt.day, kind };
}

async function undo(E) {
  if (!E.ledger.length) return say(E, 'Nothing to undo: the ledger is empty.');
  const last = E.ledger.reduce((a, e) => ((e[5] || 0) > (a[5] || 0) ? e : a), E.ledger[0]);
  E.ledger = E.ledger.filter((e) => e !== last);
  E.dl = true;
  return say(E, `Removed ${describe(last)}.${last[2] !== INC && last[2] !== OTH ? ` ${budgetLine(E, last[2])}` : ''}`);
}
function describe(e) { return `${money(Math.abs(e[1]), 1)}${e[1] < 0 ? ' refund' : ''} ${e[3]} (${CATS[e[2]]}, ${fdate(e[0])})`; }
async function delN(E, n) {
  const id = E.st.ll[n - 1];
  const e = id && E.ledger.find((x) => x[5] === id);
  if (!e) return say(E, E.st.ll.length ? `There's no #${n} in the last list (it had ${E.st.ll.length}). Say "list" to see them again.` : 'Say "list" first, then "delete 3" removes the 3rd entry.');
  E.ledger = E.ledger.filter((x) => x !== e);
  E.st.ll = E.st.ll.filter((x) => x !== id);
  E.dl = true; E.ds = true;
  return say(E, `Deleted #${n}: ${describe(e)}.`);
}
async function fixLast(E, word) {
  const cat = catFromWord(word);
  if (cat === null) return say(E, `Which category? I know ${CATS.join(', ')}.`);
  if (!E.ledger.length) return say(E, 'There is nothing logged yet to change.');
  const last = E.ledger.reduce((a, e) => ((e[5] || 0) > (a[5] || 0) ? e : a), E.ledger[0]);
  const was = CATS[last[2]];
  if (last[2] === cat) return say(E, `${money(Math.abs(last[1]), 1)} ${last[3]} (${fdate(last[0])}) is already under ${was}.`);
  last[2] = cat;
  E.dl = true;
  return say(E, `Changed ${money(Math.abs(last[1]), 1)} ${last[3]} (${fdate(last[0])}) from ${was} to ${CATS[cat]}.${cat !== INC ? ` ${budgetLine(E, cat)}` : ''} Say "${last[3].toLowerCase()} is ${CATS[cat].toLowerCase()}" to always file it there.`);
}
async function learn(E, left, cat) {
  const { name } = resolveName(left, 'spend');
  const k = normKey(name);
  E.st.r[k] = cat;
  E.ds = true;
  let n = 0, v = 0;
  for (const e of E.ledger) if (normKey(e[3]) === k && e[2] !== cat && e[2] !== INC) { e[2] = cat; n += 1; v += e[1]; E.dl = true; }
  return say(E, `Got it: ${name} → ${CATS[cat]} from now on.${n ? ` Moved ${n} past entr${n === 1 ? 'y' : 'ies'} (${money(v, 1)}) to ${CATS[cat]}.` : ''}`);
}
async function setBudget(E, word, cents) {
  const name = title(normText(word));
  const key = normText(word);
  if (!key) return say(E, 'Say it like "set budget food 450".');
  const cats = catsFor(key);
  E.st.bo[key] = cents || 0;
  E.ds = true;
  E.budgets = budgetsOf(E);
  if (!cents) return say(E, `Removed the ${name} budget.`);
  const [from] = thisMonth(E);
  const sp = sumSpend(E, from, E.today, cats);
  return say(E, `${name} budget set to ${money(cents)} a month (covers ${cats.map((c) => CATS[c]).join(' + ')}). So far this month: ${money(sp)} (${pct(sp, cents)}%).`);
}
async function addBill(E, orig) {
  const s = orig.replace(/^\s*add\s+(?:a\s+)?bill\s+(?:for\s+)?/i, '');
  const b = parseBill(s);
  if (!b) return say(E, 'Say it like "add bill netflix 15.49 on 7" (add a pay link at the end if you like).');
  const k = normKey(b.n);
  E.st.ba = E.st.ba.filter((x) => normKey(x.n) !== k).concat([b]);
  E.st.br = E.st.br.filter((x) => x !== k);
  E.ds = true;
  E.bills = billsOf(E);
  const due = nextDue(b, E.today);
  return say(E, `Added bill ${b.n} ${money(b.c, 1)} due on the ${ordinal(b.d)}. Next: ${fday(due)}${due === E.today ? ' (today)' : ` (in ${due - E.today} day${due - E.today === 1 ? '' : 's'})`}. I'll remind you 3 days before and on the day.`);
}
function ordinal(n) { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
async function removeBill(E, word) {
  const k = normKey(word);
  const b = E.bills.find((x) => normKey(x.n) === k) || E.bills.find((x) => normKey(x.n).includes(k) || k.includes(normKey(x.n)));
  if (!b) return say(E, `No bill called "${word}". Your bills: ${E.bills.map((x) => x.n).join(', ') || 'none yet'}.`);
  const bk = normKey(b.n);
  E.st.ba = E.st.ba.filter((x) => normKey(x.n) !== bk);
  if (!E.st.br.includes(bk)) E.st.br.push(bk);
  E.ds = true;
  E.bills = billsOf(E);
  return say(E, `Removed the ${b.n} bill (${money(b.c, 1)} on the ${ordinal(b.d)}). No more reminders for it.`);
}

// ---------- answers ----------
function safeCalc(E) {
  const base = income(E) || E.budgets.reduce((s, b) => s + b.lim, 0);
  if (!base) return null;
  const t = ymd(E.today);
  const [from, to] = monthRange(t.y, t.m);
  const spent = sumSpend(E, from, E.today);
  let billsDue = 0;
  for (const b of E.bills) { const due = dn(t.y, t.m, Math.min(b.d, monthLen(t.y, t.m))); if (due >= E.today && !paidFor(E, b, due)) billsDue += b.c; }
  const days = to - E.today + 1;
  const left = base - spent - billsDue;
  return { base, spent, billsDue, days, left, daily: left / days, from: income(E) ? 'income' : 'budgets' };
}
function safeReply(E) {
  const s = safeCalc(E);
  if (!s) return 'Add your monthly income or budgets in Settings (or say "set budget food 400") and I will work out a safe daily number.';
  if (s.left <= 0) return `Nothing safe to spend today: ${money(s.base)} (${s.from}) − ${money(s.spent)} spent − ${money(s.billsDue)} bills still due leaves ${money(s.left)} with ${s.days} days left.`;
  let t = `Safe to spend today: ${money(s.daily)}. That's ${money(s.base)} (${s.from}) − ${money(s.spent)} spent − ${money(s.billsDue)} bills still due = ${money(s.left)} for ${s.days} day${s.days === 1 ? '' : 's'}.`;
  const pd = Number(E.ctx.settings.payday);
  if (pd >= 1 && pd <= 31) { const n = nextDue({ d: pd }, E.today); t += ` Next payday: ${fday(n)}${n === E.today ? ' (today)' : ''}.`; }
  return t;
}
async function budgetReply(E) {
  if (!E.budgets.length) return say(E, 'No budgets yet. Add them in Settings ("Food 400", one per line) or say "set budget food 400".');
  const [from, to] = thisMonth(E);
  const ls = E.budgets.map((b) => { const sp = sumSpend(E, from, E.today, b.cats); const p = pct(sp, b.lim); return `${b.name}: ${money(sp)} of ${money(b.lim)} (${p}%)${p >= 100 ? ' over' : p >= 80 ? ' close' : ''}`; });
  const left = to - E.today + 1;
  return say(E, `${MONTHS[ymd(E.today).m - 1]}, ${left} day${left === 1 ? '' : 's'} left:\n${ls.join('\n')}`);
}
async function subsReply(E) {
  const subs = subsOf(E, E.today).filter((s) => s.last >= E.today - 45);
  const keys = new Set(subs.map((s) => s.k));
  const once = byMerchant(E, E.today - 35, E.today).filter((m) => !keys.has(normKey(m.name)) && E.ledger.some((e) => e[2] === 4 && normKey(e[3]) === normKey(m.name)));
  if (!subs.length && !once.length) return say(E, 'No subscriptions spotted yet. I flag a charge as one when the same merchant bills about the same amount in two months in a row.');
  const tot = subs.reduce((s, x) => s + x.c, 0);
  let t = subs.length ? `${subs.length} subscription${subs.length === 1 ? '' : 's'}: ${subs.map((s) => `${s.name} ${money(s.c, 1)}`).join(', ')}. Total ${money(tot, 1)}/month = ${money(tot * 12, 1)}/year.` : '';
  if (once.length) t += `${t ? '\n' : ''}Seen once so far: ${once.map((m) => `${m.name} ${money(m.v, 1)}`).join(', ')}.`;
  const first = subs.map((s) => cancelLink(s.name)).find(Boolean);
  return say(E, t, first);
}
async function billsReply(E) {
  if (!E.bills.length) return say(E, 'No bills yet. Add them in Settings ("Rent 1800 on 1") or say "add bill netflix 15.49 on 7".');
  const rows = E.bills.map((b) => ({ b, due: nextDue(b, E.today) })).sort((x, y) => x.due - y.due);
  const ls = rows.map(({ b, due }) => { const paid = paidFor(E, b, due); const dd = due - E.today; return `${b.n} ${money(b.c, 1)}: ${dd === 0 ? 'due today' : `due ${fday(due)} (${dd} day${dd === 1 ? '' : 's'})`}${paid ? `, paid ${fdate(paid[0])}` : ''}`; });
  const t = ymd(E.today);
  const left = E.bills.reduce((s, b) => { const due = dn(t.y, t.m, Math.min(b.d, monthLen(t.y, t.m))); return s + (due >= E.today && !paidFor(E, b, due) ? b.c : 0); }, 0);
  const next = rows.find((r) => r.b.l);
  return say(E, `${ls.join('\n')}\nStill due this month: ${money(left, 1)}.`, next ? { url: next.b.l, label: `Pay ${next.b.n}`.slice(0, 40) } : null);
}
async function listReply(E) {
  const es = E.ledger.slice().sort((a, b) => (b[5] || 0) - (a[5] || 0)).slice(0, 10);
  if (!es.length) return say(E, 'Nothing logged yet. Try "spent 42 at costco".');
  E.st.ll = es.map((e) => e[5]);
  E.ds = true;
  return say(E, `Last ${es.length}:\n${es.map((e, i) => `${i + 1}. ${fdate(e[0])} ${e[3]} ${e[2] === INC ? '+' : ''}${money(e[1], 1)} ${CATS[e[2]]}`).join('\n')}\nSay "delete 3" to remove one.`);
}
function parsePeriod(low, today) {
  const t = ymd(today);
  const mon = today - ((t.wd + 6) % 7);
  if (/\btoday\b/.test(low)) return { from: today, to: today, label: 'today' };
  if (/\byesterday\b/.test(low)) return { from: today - 1, to: today - 1, label: 'yesterday' };
  if (/\blast week\b/.test(low)) return { from: mon - 7, to: mon - 1, label: 'last week' };
  if (/\b(last|past) (7|seven) days\b/.test(low)) return { from: today - 6, to: today, label: 'in the last 7 days' };
  if (/\bweek\b/.test(low)) return { from: mon, to: today, label: 'this week' };
  if (/\blast month\b/.test(low)) { const p = prevMonth(t.y, t.m); const [from, to] = monthRange(p.y, p.m); return { from, to, label: `in ${MONTHS[p.m - 1]}` }; }
  if (/\b(this year|year to date|ytd)\b/.test(low)) return { from: dn(t.y, 1, 1), to: today, label: `in ${t.y}` };
  const mm = low.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/);
  if (mm && !/\bmay i\b/.test(low)) {
    const m = MONTHS.map((x) => x.toLowerCase()).indexOf(mm[1]) + 1;
    const y = m > t.m ? t.y - 1 : t.y;
    const [from, to] = monthRange(y, m);
    return { from, to: Math.min(to, today), label: `in ${MONTHS[m - 1]}` };
  }
  const [from] = monthRange(t.y, t.m);
  return { from, to: today, label: 'this month' };
}
function findFilter(E, low) {
  for (const b of E.budgets) if (hasWord(low, b.key)) return { cats: b.cats, label: b.name, budget: b };
  const p = ` ${normText(low)} `;
  const al = Object.keys(ALIAS).sort((a, b) => b.length - a.length).find((k) => p.includes(` ${k} `));
  if (al && al !== 'income') return { cats: ALIAS[al], label: title(al) };
  const ci = CATS.findIndex((c, i) => i !== INC && p.includes(` ${c.toLowerCase()} `));
  if (ci >= 0) return { cats: [ci], label: CATS[ci] };
  const names = [...new Set(E.ledger.map((e) => e[3]))].sort((a, b) => b.length - a.length);
  const nm = names.find((n) => normText(n) && p.includes(` ${normText(n)} `));
  if (nm) return { merchant: normKey(nm), label: nm };
  return null;
}
async function spendReply(E, low) {
  const P = parsePeriod(low, E.today);
  const f = findFilter(E, low);
  const es = E.ledger.filter((e) => isSpend(e) && e[0] >= P.from && e[0] <= P.to);
  if (f && f.cats) {
    const sel = es.filter((e) => f.cats.includes(e[2]));
    const tot = sel.reduce((s, e) => s + e[1], 0);
    if (!sel.length) return say(E, `Nothing on ${f.label.toLowerCase()} ${P.label} yet.`);
    let t = `${f.label} ${P.label}: ${money(tot, 1)} over ${sel.length} entr${sel.length === 1 ? 'y' : 'ies'}`;
    if (f.cats.length > 1) t += ` (${f.cats.map((c) => `${CATS[c]} ${money(sel.filter((e) => e[2] === c).reduce((s, e) => s + e[1], 0))}`).join(', ')})`;
    t += '.';
    const b = f.budget || E.budgets.find((x) => x.cats.join() === f.cats.join());
    if (b && P.label === 'this month') t += ` Budget ${money(b.lim)}: ${pct(tot, b.lim)}% used, ${money(b.lim - tot)} left.`;
    const top = byMerchant({ ledger: sel }, P.from, P.to).slice(0, 3);
    if (top.length > 1) t += ` Top: ${top.map((x) => `${x.name} ${money(x.v)}`).join(', ')}.`;
    return say(E, t);
  }
  if (f && f.merchant) {
    const sel = es.filter((e) => normKey(e[3]) === f.merchant);
    const tot = sel.reduce((s, e) => s + e[1], 0);
    return say(E, sel.length ? `${f.label} ${P.label}: ${money(tot, 1)} over ${sel.length} visit${sel.length === 1 ? '' : 's'}.` : `Nothing at ${f.label} ${P.label}.`);
  }
  const tot = es.reduce((s, e) => s + e[1], 0);
  const inc = E.ledger.filter((e) => e[2] === INC && e[0] >= P.from && e[0] <= P.to).reduce((s, e) => s + e[1], 0);
  if (!es.length && !inc) return say(E, `Nothing logged ${P.label} yet.`);
  const cats = byCat({ ledger: es }, P.from, P.to).slice(0, 3);
  let t = `${P.label[0].toUpperCase()}${P.label.slice(1)}: ${money(tot, 1)} spent over ${es.length} entr${es.length === 1 ? 'y' : 'ies'}.`;
  if (cats.length) t += ` Top: ${cats.map((x) => `${CATS[x.c]} ${money(x.v)}`).join(', ')}.`;
  if (inc) t += ` Income: ${money(inc)}.`;
  return say(E, t);
}
async function topReply(E, low) {
  const P = parsePeriod(low, E.today);
  const top = byMerchant(E, P.from, P.to).slice(0, 5);
  if (!top.length) return say(E, `No spending logged ${P.label} yet.`);
  return say(E, `Top merchants ${P.label}:\n${top.map((x, i) => `${i + 1}. ${x.name} ${money(x.v, 1)} (${x.n}×)`).join('\n')}`);
}
async function reportReply(E, low) {
  const t = ymd(E.today);
  const last = /\blast month\b/.test(low);
  const p = last ? prevMonth(t.y, t.m) : { y: t.y, m: t.m };
  const r = monthReport(E, p.y, p.m, !last);
  return say(E, r ? `${r.title}\n${r.text}` : `Nothing logged for ${MONTHS[p.m - 1]} yet.`);
}

// ---------- reports ----------
function monthReport(E, y, m, partial) {
  const [from, end] = monthRange(y, m);
  const to = Math.min(end, E.today);
  const es = E.ledger.filter((e) => e[0] >= from && e[0] <= to);
  if (!es.length) return null;
  const total = sumSpend(E, from, to);
  const inc = es.filter((e) => e[2] === INC).reduce((s, e) => s + e[1], 0);
  const pm = prevMonth(y, m);
  const [pf, pt] = monthRange(pm.y, pm.m);
  const prev = sumSpend(E, pf, partial ? Math.min(pt, pf + (to - from)) : pt);
  const name = MONTHS[m - 1];
  const out = [];
  out.push(`Total ${money(total, 1)} spent${inc ? `, ${money(inc)} came in (${inc >= total ? `saved ${money(inc - total)}` : `${money(total - inc)} more out than in`})` : ''}.${prev ? ` vs ${MONTHS[pm.m - 1]}${partial ? ' at this point' : ''}: ${money(prev)} (${change(total, prev)}).` : ''}`);
  const cats = byCat(E, from, to);
  if (cats.length) out.push(`By category: ${cats.map((x) => { const b = E.budgets.find((bb) => bb.cats.length === 1 && bb.cats[0] === x.c); return `${CATS[x.c]} ${money(x.v)}${b ? ` (${pct(x.v, b.lim)}% of ${money(b.lim)})` : ''}`; }).join(', ')}.`);
  const multi = E.budgets.filter((b) => b.cats.length > 1);
  if (multi.length) out.push(`Budgets: ${multi.map((b) => { const sp = sumSpend(E, from, to, b.cats); return `${b.name} ${money(sp)} of ${money(b.lim)} (${pct(sp, b.lim)}%)`; }).join(', ')}.`);
  const top = byMerchant(E, from, to).slice(0, 3);
  if (top.length) out.push(`Biggest merchants: ${top.map((x) => `${x.name} ${money(x.v)}`).join(', ')}.`);
  const subs = subsOf(E, to).filter((s) => s.last >= to - 45);
  if (subs.length) { const st = subs.reduce((s, x) => s + x.c, 0); out.push(`Subscriptions: ${money(st, 1)}/month (${subs.length}: ${subs.map((s) => s.name).join(', ')}).`); }
  return { title: `${name}${partial ? ' so far' : ''}: ${money(total)} spent`, text: out.join('\n') };
}
function weekReview(E) {
  const to = E.today - 1, from = E.today - 7;
  const total = sumSpend(E, from, to);
  const prev = sumSpend(E, from - 7, from - 1);
  if (!total && !prev) return null;
  const cats = byCat(E, from, to).slice(0, 3);
  const vs = prev ? ` vs ${money(prev)} the week before (${change(total, prev)})` : '';
  return { title: `Your week: ${money(total)} spent`, text: `Last 7 days: ${money(total, 1)} spent${vs}.${cats.length ? ` Top: ${cats.map((x) => `${CATS[x.c]} ${money(x.v)}`).join(', ')}.` : ''}` };
}

// ---------- the 08:00 run ----------
async function onDaily(E) {
  const { st, L, today } = E;
  if (st.d === L.date) return;
  st.d = L.date;
  E.ds = true;
  const t = ymd(today);
  const parts = [];
  let link = null, tBill = null, tReport = null, tWeek = null, tSoon = null;
  for (const b of E.bills.slice().sort((x, y) => nextDue(x, today) - nextDue(y, today))) {
    const due = nextDue(b, today);
    const dd = due - today;
    if (dd !== 0 && dd !== 3) continue;
    if (paidFor(E, b, due)) continue;
    const key = `b|${normKey(b.n)}|${due}|${dd}`;
    if (st.sent[key]) continue;
    st.sent[key] = today;
    const line = dd === 0 ? `${b.n} ${money(b.c, 1)} is due today.` : `${b.n} ${money(b.c, 1)} is due in 3 days (${fday(due)}).`;
    parts.push(`${line}${b.l ? ' Tap to pay.' : ''}`);
    if (b.l && !link) link = { url: b.l, label: `Pay ${b.n}`.slice(0, 40) };
    if (dd === 0 && !tBill) tBill = `${b.n} ${money(b.c)} due today`;
    if (dd === 3 && !tSoon) tSoon = `${b.n} ${money(b.c)} due ${fday(due).slice(0, 3)}`;
  }
  const s = safeCalc(E);
  if (s) parts.push(s.left > 0 ? `Safe to spend today: ${money(s.daily)} (${money(s.left)} left for ${s.days} day${s.days === 1 ? '' : 's'}${s.billsDue ? ` after ${money(s.billsDue)} in bills still due` : ''}).` : `Nothing safe to spend today: you're ${money(-s.left)} past your ${s.from} for ${MONTHS[t.m - 1]} once bills are paid.`);
  if (L.weekday === 'sun') { const w = weekReview(E); if (w) { parts.push(w.text); tWeek = w.title; } }
  const lm = prevMonth(t.y, t.m);
  const lmKey = `${lm.y}-${String(lm.m).padStart(2, '0')}`;
  if (t.d <= 7 && st.rep !== lmKey) {
    st.rep = lmKey;
    const r = monthReport(E, lm.y, lm.m, false);
    if (r) { parts.push(`${MONTHS[lm.m - 1]} report:\n${r.text}`); tReport = r.title; }
  }
  if (!parts.length) return;
  const head = tBill || tReport || tWeek || tSoon || (s && s.left > 0 ? `Safe to spend today: ${money(s.daily)}` : 'Money check');
  await E.ctx.notify({ title: head, body: parts.join('\n\n'), link });
}

// ---------- the inbox ----------
function findAmount(text) {
  const re = /(?:(?:\b(?:rs\.?|inr|usd|eur|gbp)|us\$|[$₹€£])\s*(\d[\d,]*(?:\.\d{1,2})?))|(?:(\d[\d,]*(?:\.\d{1,2})?)\s*(?:rs|inr|usd|dollars|rupees)\b)/i;
  const m = text.match(re);
  return m ? toCents(m[1] || m[2]) : null;
}
function bankDate(text, E) {
  const today = E.today;
  const t = ymd(today);
  const ok = (y, m, d) => { if (y < 100) y += 2000; if (m < 1 || m > 12 || d < 1 || d > monthLen(y, m)) return null; const n = dn(y, m, d); return n <= today && n >= today - 10 ? n : null; };
  let a = text.match(/\b(20\d\d)-(\d{1,2})-(\d{1,2})\b/);
  if (a) { const n = ok(Number(a[1]), Number(a[2]), Number(a[3])); if (n !== null) return n; }
  a = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/) || text.match(/\b(\d{1,2})[/-](\d{1,2})\b(?![/.-]\d)/);
  if (a) {
    const x = Number(a[1]), y = Number(a[2]), yr = a[3] ? Number(a[3]) : t.y;
    const order = E.dmy ? [[yr, y, x], [yr, x, y]] : [[yr, x, y], [yr, y, x]];
    for (const o of order) { const n = ok(...o); if (n !== null) return n; }
  }
  a = text.match(/\b(\d{1,2})[- ]?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[- ,]*(\d{2,4})?\b/i);
  if (a) { const n = ok(a[3] ? Number(a[3]) : t.y, ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(a[2].toLowerCase()) + 1, Number(a[1])); if (n !== null) return n; }
  return null;
}
function parseBank(text, E) {
  const raw = String(text || '').trim();
  const low = raw.toLowerCase();
  if (!raw) return { skip: 'it was empty' };
  if (/\b(otp|one[- ]time (?:password|passcode|code|pin)|verification code|security code|login code|passcode|do not share|never share)\b/.test(low)) return { skip: 'it looks like a one-time code' };
  const kv = {};
  for (const ln of raw.split(/\r?\n/)) { const m = ln.match(/^\s*([A-Za-z][A-Za-z ]{1,20}?)\s*[:=]\s*(.+?)\s*$/); if (m) kv[m[1].trim().toLowerCase()] = m[2]; }
  const kvAmt = kv.amount || kv.total || kv.price || kv.value;
  const kvMer = kv.merchant || kv.name || kv.payee || kv.store || kv.vendor || kv.description || kv.place;
  const refund = /\b(refund(?:ed)?|reversal|reversed|returned|chargeback)\b/.test(low);
  if (kvAmt && kvMer) {
    const cents = toCents(kvAmt);
    if (!cents) return { skip: 'the amount was unreadable' };
    return { cents, merchant: kvMer, kind: refund ? 'refund' : /\b(deposit|deposited|payroll|salary|credited)\b/.test(low) ? 'income' : 'spend', day: E.today };
  }
  const strong = /\b(debited|charged|charge of|authori[sz]ed|spent|withdrawn|withdrawal of|deducted|was used|paid|purchase of|txn of|transaction of|deposited|credited|received|refund(?:ed)?|sent)\b/.test(low);
  const weak = /\b(purchase|payment|transaction|txn|debit|deposit|charge)\b/.test(low);
  const promo = /\b(offer|cashback up to|use code|coupon|apply now|pre-?approved|limited time|hurry|win|discount|upgrade|eligible|click|exclusive|loan|sale|%\s*off|t&c)\b|\d+%/.test(low);
  const cents = findAmount(raw);
  if (!cents) return { skip: promo ? 'it looks like a promotion' : 'there was no amount in it' };
  if (!strong && (promo || !weak)) return { skip: promo ? 'it looks like a promotion' : 'it did not say money moved' };
  const debit = /\b(debited|charged|charge of|authori[sz]ed|spent|withdrawn|withdrawal|deducted|was used|paid|purchase|txn|transaction|sent|debit)\b/.test(low);
  const credit = /\b(deposited|deposit|credited|received|payroll|salary|direct dep)\b/.test(low);
  const kind = refund ? 'refund' : credit && !debit ? 'income' : 'spend';
  let merchant = '';
  const stop = '(?=\\s+(?:was|is|on|for|using|with|via|from|has|have|ref|avl|avail|available|bal|balance|card|a/c|ac|acct|account|txn|at|by|to|info|call|if|not|upi|imps|neft|dated|and|thru|through)\\b|\\s+-\\s|\\s+\\d{1,2}[-/]\\d|[;:!\\n(]|[.,](?=\\s|$)|$)';
  for (const prep of ['at', 'merchant', 'by', 'towards', 'in favou?r of', 'to', 'from', 'with']) {
    const re = new RegExp(`\\b${prep}\\s+(.+?)${stop}`, 'gi');
    let mm;
    while ((mm = re.exec(raw))) {
      const c = mm[1].trim();
      if (c.length < 2 || /^(your|you|a\/c|ac\b|acct|account|card|xx|\*|the account|beneficiary|vpa|bank|\d|[$₹€£]|rs\b|inr\b|usd\b)/i.test(c)) continue;
      merchant = c.replace(/@.*$/, '');
      break;
    }
    if (merchant) break;
  }
  if (!merchant && kind === 'income') merchant = /payroll/i.test(raw) ? 'Payroll' : /salary/i.test(raw) ? 'Salary' : 'Deposit';
  if (kind === 'income' && /payroll/i.test(raw) && !/payroll/i.test(merchant)) merchant = 'Payroll';
  const day = bankDate(raw, E);
  return { cents, merchant: merchant || '', kind, day: day === null ? E.today : day };
}
async function onInbox(E) {
  const ctx = E.ctx;
  let text = String(ctx.input.text || '');
  const data = ctx.input.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const kv = Object.keys(data).map((k) => `${k}: ${data[k] && typeof data[k] === 'object' ? JSON.stringify(data[k]) : data[k]}`).join('\n');
    text = text ? `${text}\n${kv}` : kv;
  }
  const p = parseBank(text, E);
  if (p.skip) return say(E, `Not a transaction (${p.skip}), nothing logged.`);
  const { name } = resolveName(p.merchant, p.kind);
  const nowMin = Math.floor(Date.parse(ctx.now()) / 60000);
  const key = `${p.kind === 'refund' ? -p.cents : p.cents}|${normKey(name)}`;
  const dup = E.st.seen.find((x) => x[1] === key && nowMin - x[0] <= 5 && nowMin >= x[0]);
  if (dup) return say(E, `Already logged ${money(p.cents, 1)} ${name} ${nowMin - dup[0] ? `${nowMin - dup[0]} min ago` : 'just now'}, skipped the duplicate.`);
  E.st.seen = E.st.seen.filter((x) => nowMin - x[0] <= 60).concat([[nowMin, key]]).slice(-30);
  E.ds = true;
  const r = await addEntry(E, p, true);
  let line;
  if (p.kind === 'income') line = `Logged income ${money(p.cents, 1)} (${r.name}).`;
  else {
    const b = budgetFor(E, r.cat);
    const [from] = thisMonth(E);
    const extra = b ? ` (${b.name} ${money(sumSpend(E, from, E.today, b.cats))} of ${money(b.lim)}, ${pct(sumSpend(E, from, E.today, b.cats), b.lim)}%)` : '';
    line = `Logged ${p.kind === 'refund' ? 'refund ' : ''}${money(p.cents, 1)} ${r.name} → ${CATS[r.cat]}${r.e[0] !== E.today ? ` on ${fdate(r.e[0])}` : ''}${extra}.${r.rc.unknown && r.name !== 'Misc' ? ` Reply "${r.name.toLowerCase()} is dining" (or any category) to teach me.` : ''}`;
  }
  await say(E, line);
  if (r.alerts.length) await ctx.notify({ title: r.alerts[0].t, body: [...r.alerts.map((a) => a.b), line].join('\n'), link: r.link });
}

function helpText(E) {
  const b = E.budgets.length ? `${E.budgets.length} budget${E.budgets.length === 1 ? '' : 's'}` : 'no budgets yet';
  const bl = E.bills.length ? `${E.bills.length} bill${E.bills.length === 1 ? '' : 's'}` : 'no bills yet';
  return [
    `I keep your money ledger (${E.ledger.length} entr${E.ledger.length === 1 ? 'y' : 'ies'}, ${b}, ${bl}). Tell me:`,
    '• Spending: "spent 42 at costco", "uber 18.50", "$12.99 netflix", "paid 60 for gas yesterday"',
    '• Money in: "got paid 3200", "refund 20 amazon"',
    '• Fixes: "costco is groceries" (I remember), "that was dining", "undo", "delete 3"',
    '• Ask: "how much on food this month", "this week", "last month", "top merchants", "budget", "safe to spend", "bills", "subscriptions", "list", "report"',
    '• Change: "set budget food 450", "add bill netflix 15.49 on 7", "remove bill phone"',
    'Bank texts and Apple Pay purchases sent to my inbox are logged on their own. Each morning at 8: bill reminders and safe-to-spend; Sundays a weekly review; on the 1st last month\'s report.',
  ].join('\n');
}
