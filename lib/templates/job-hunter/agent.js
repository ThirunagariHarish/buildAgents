// Job Hunter: watches the job boards of the companies you care about, tells you
// about new matching roles in one digest, and keeps your application pipeline.

const DEFAULT_COMPANIES = 'stripe greenhouse\nnetflix lever\nnotion ashby';
const SOURCES = { greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby' };
const STAGES = ['applied', 'interview', 'offer', 'rejected'];
const STAGE_NAME = { applied: 'Applied', interview: 'Interview', offer: 'Offer', rejected: 'Rejected' };
const FOLLOW_UP_DAYS = 7;
const MAX_SEEN = 3000, MAX_MATCHES = 60, MAX_APPS = 300, MAX_BOARDS = 25;

// ---------- dates ----------
const WD = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
function dayNum(date) { const [y, m, d] = date.split('-').map(Number); return Date.UTC(y, m - 1, d) / 864e5; }
function addDays(date, n) { return new Date((dayNum(date) + n) * 864e5).toISOString().slice(0, 10); }
function weekday(date) { return WD[new Date(dayNum(date) * 864e5).getUTCDay()]; }
function nice(date) {
  if (!date) return '';
  const [, m, d] = date.split('-').map(Number);
  const w = weekday(date);
  return `${w[0].toUpperCase()}${w.slice(1)} ${MONTHS[m - 1][0].toUpperCase()}${MONTHS[m - 1].slice(1)} ${d}`;
}
function niceTime(hm) {
  const [h, m] = hm.split(':').map(Number);
  return `${h % 12 || 12}${m ? `:${pad(m)}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}
/** A date in the text, relative to today. Returns { date, match } or null. */
function findDate(text, today) {
  const t = text.toLowerCase();
  let m;
  const ty = Number(today.slice(0, 4));
  const fix = (y, mo, d) => {
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    let date = ymd(y || ty, mo, d);
    if (!y && dayNum(date) < dayNum(today) - 30) date = ymd(ty + 1, mo, d);
    return date;
  };
  if ((m = t.match(/\btoday\b/))) return { date: today, match: m[0] };
  if ((m = t.match(/\b(tomorrow|tmrw|tmr)\b/))) return { date: addDays(today, 1), match: m[0] };
  if ((m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/))) return { date: fix(+m[1], +m[2], +m[3]), match: m[0] };
  if ((m = t.match(new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s*(\\d{4}))?`)))) return { date: fix(m[3] ? +m[3] : 0, MONTHS.indexOf(m[1].slice(0, 3)) + 1, +m[2]), match: m[0] };
  if ((m = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}\\b(?:,?\\s*(\\d{4}))?`)))) return { date: fix(m[3] ? +m[3] : 0, MONTHS.indexOf(m[2].slice(0, 3)) + 1, +m[1]), match: m[0] };
  if ((m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) { const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : 0; return { date: fix(y, +m[1], +m[2]), match: m[0] }; }
  if ((m = t.match(/\b(?:next\s+)?(sun|mon|tue|wed|thu|fri|sat)(?:day|sday|nesday|rsday|urday|s|rs|r)?\b/))) {
    let diff = (WD.indexOf(m[1]) - WD.indexOf(weekday(today)) + 7) % 7;
    if (diff === 0) diff = 7;
    return { date: addDays(today, diff), match: m[0] };
  }
  return null;
}
function findTime(text) {
  const t = text.toLowerCase();
  let m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/);
  if (m) { let h = +m[1] % 12; if (m[3][0] === 'p') h += 12; return { time: `${pad(h)}:${m[2] || '00'}`, match: m[0] }; }
  m = t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (m) return { time: `${pad(+m[1])}:${m[2]}`, match: m[0] };
  if ((m = t.match(/\bnoon\b/))) return { time: '12:00', match: m[0] };
  return null;
}

// ---------- boards ----------
function parseCompanies(text) {
  const out = [];
  for (const raw of String(text || '').split(/\n|;/)) {
    const line = raw.trim().toLowerCase();
    if (!line) continue;
    let m = line.match(/(greenhouse|lever|ashbyhq)\.(?:io|co|com)\/([a-z0-9._-]+)/);
    if (m) { out.push({ b: m[2], s: m[1] === 'ashbyhq' ? 'ashby' : m[1] }); continue; }
    m = line.match(/^([a-z0-9][a-z0-9._-]*)[\s,:(]+(greenhouse|lever|ashby)\b/) || line.match(/^(greenhouse|lever|ashby)[\s,:]+([a-z0-9][a-z0-9._-]*)/);
    if (!m) continue;
    const c = SOURCES[m[1]] ? { b: m[2], s: m[1] } : { b: m[1], s: m[2] };
    if (!out.some((x) => x.b === c.b)) out.push(c);
  }
  return out;
}
const companyName = (b) => b.split(/[-_.]/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
function boardUrl(c) {
  if (c.s === 'greenhouse') return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(c.b)}/jobs`;
  if (c.s === 'lever') return `https://api.lever.co/v0/postings/${encodeURIComponent(c.b)}?mode=json`;
  return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(c.b)}`;
}
/** Jobs on a board as { k, t, l, u, d, r }, or null when the answer is not what the board API sends. */
function parseBoard(c, text) {
  let j;
  try { j = JSON.parse(text); } catch (e) { return null; }
  const day = (v) => (typeof v === 'number' ? new Date(v).toISOString().slice(0, 10) : String(v || '').slice(0, 10));
  const out = [];
  if (c.s === 'greenhouse') {
    if (!j || !Array.isArray(j.jobs)) return null;
    for (const x of j.jobs) {
      if (!x || !x.title) continue;
      const loc = String((x.location && x.location.name) || '');
      out.push({ k: `g:${c.b}:${x.id}`, t: String(x.title), l: loc, u: String(x.absolute_url || ''), d: day(x.updated_at), r: /remote/i.test(loc) });
    }
  } else if (c.s === 'lever') {
    if (!Array.isArray(j)) return null;
    for (const x of j) {
      if (!x || !x.text) continue;
      const loc = String((x.categories && x.categories.location) || '');
      out.push({ k: `l:${c.b}:${x.id}`, t: String(x.text), l: loc, u: String(x.hostedUrl || ''), d: day(x.createdAt), r: x.workplaceType === 'remote' || /remote/i.test(loc) });
    }
  } else {
    if (!j || !Array.isArray(j.jobs)) return null;
    for (const x of j.jobs) {
      if (!x || !x.title || x.isListed === false) continue;
      const loc = String(x.location || '');
      out.push({ k: `a:${c.b}:${x.id}`, t: String(x.title), l: loc, u: String(x.jobUrl || ''), d: day(x.publishedAt), r: !!x.isRemote || /remote/i.test(loc) });
    }
  }
  return out;
}
const list = (s) => String(s || '').toLowerCase().split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasWord = (hay, w) => new RegExp(`(^|[^a-z0-9])${esc(w)}`).test(hay);
/** 0 = no match, otherwise how many keywords the title hits. */
function score(job, f) {
  const title = job.t.toLowerCase();
  const hits = f.kw.filter((k) => hasWord(title, k)).length;
  if (f.kw.length && !hits) return 0;
  if (f.ex.some((e) => hasWord(title, e))) return 0;
  if (f.loc.length && !f.loc.some((l) => (l === 'remote' ? job.r : job.l.toLowerCase().includes(l)))) return 0;
  return hits || 1;
}
const line = (j) => `${j.t} — ${j.c}${j.l ? ` (${j.l})` : ''}`;

async function effectiveCompanies(ctx) {
  const extra = (await ctx.memory.get('co')) || { add: [], rm: [] };
  const base = parseCompanies(ctx.settings.companies === undefined ? DEFAULT_COMPANIES : ctx.settings.companies);
  const all = [...base];
  for (const c of extra.add) if (!all.some((x) => x.b === c.b)) all.push(c);
  return { extra, list: all.filter((c) => !extra.rm.includes(c.b)).slice(0, MAX_BOARDS) };
}
async function filters(ctx) {
  const kw = await ctx.memory.get('kw');
  return {
    kw: kw || list(ctx.settings.keywords === undefined ? 'engineer' : ctx.settings.keywords),
    ex: list(ctx.settings.exclude === undefined ? 'intern' : ctx.settings.exclude),
    loc: list(ctx.settings.locations),
  };
}

// ---------- pipeline ----------
function followUpLink(a, from) {
  const subject = `Following up on my ${a.t} application`;
  const body = `Hi,\n\nI applied for the ${a.t} role at ${a.c} on ${nice(a.ad)} and wanted to follow up. I'm still very interested and happy to share anything else that would help.\n\nThank you,\n${from || ''}`;
  return { url: `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, label: `Email ${a.c}` };
}
const dueFollowUps = (apps, today) => apps.filter((a) => a.st === 'applied' && dayNum(today) - dayNum(a.up || a.ad) > FOLLOW_UP_DAYS)
  .sort((x, y) => dayNum(x.up || x.ad) - dayNum(y.up || y.ad));
function findApp(apps, q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const byCo = apps.filter((a) => a.c.toLowerCase().replace(/\s+/g, '') .startsWith(words[0]) || words[0].startsWith(a.c.toLowerCase().split(' ')[0]));
  if (!byCo.length) return null;
  const rest = words.slice(1).join(' ');
  const pool = (rest && byCo.filter((a) => a.t.toLowerCase().includes(rest)).length) ? byCo.filter((a) => a.t.toLowerCase().includes(rest)) : byCo;
  const open = pool.filter((a) => a.st !== 'rejected');
  return (open.length ? open : pool).sort((x, y) => dayNum(y.up || y.ad) - dayNum(x.up || x.ad))[0];
}
function trimApps(apps) {
  while (apps.length > MAX_APPS) {
    const i = apps.findIndex((a) => a.st === 'rejected');
    apps.splice(i >= 0 ? i : 0, 1);
  }
  return apps;
}
const titleCase = (s) => s.split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
function pipelineText(apps, today) {
  if (!apps.length) return 'Your pipeline is empty. Say "jobs" to see matches, then "applied 1".';
  const parts = [`Your pipeline (${apps.length}): ${STAGES.map((s) => `${apps.filter((a) => a.st === s).length} ${STAGE_NAME[s].toLowerCase()}`).join(' · ')}`];
  for (const s of STAGES) {
    const xs = apps.filter((a) => a.st === s);
    if (!xs.length) continue;
    const shown = xs.slice(-8).reverse().map((a) => {
      if (s === 'interview' && a.iv) return `• ${a.t} — ${a.c} · ${nice(a.iv.slice(0, 10))} ${niceTime(a.iv.slice(11))}`;
      return `• ${a.t} — ${a.c} (${s === 'applied' ? `applied ${nice(a.ad)}, ${dayNum(today) - dayNum(a.ad)}d ago` : nice(a.up || a.ad)})`;
    });
    parts.push(`${STAGE_NAME[s]} (${xs.length}):\n${shown.join('\n')}`);
  }
  return parts.join('\n\n');
}

const HELP = `I watch your companies' job boards every 6 hours and keep your application pipeline. Say:
• "jobs" — the latest matches, numbered
• "applied 2" or "applied stripe backend engineer"
• "interview stripe fri 2pm" — I'll remind you the day before
• "offer stripe" / "rejected stripe"
• "pipeline" — everything by stage
• "follow ups" — applications quiet for 7+ days, with an email ready
• "followed up stripe"
• "add company figma greenhouse" / "remove company figma" / "companies"
• "keywords: backend, platform"
Every Monday at 9 I send your week: pipeline and follow-ups due.`;

// ---------- runs ----------
async function checkBoards(ctx) {
  const today = ctx.local().date;
  const { list: companies } = await effectiveCompanies(ctx);
  const f = await filters(ctx);
  const seen = (await ctx.memory.get('seen')) || [];
  const seenSet = new Set(seen);
  const down = (await ctx.memory.get('down')) || {};
  let matches = (await ctx.memory.get('matches')) || [];
  const fresh = [], newlyDown = [];
  let downChanged = false;
  for (const c of companies) {
    let r;
    try { r = await ctx.http.get(boardUrl(c)); } catch (e) { r = { status: 0, text: '' }; }
    const jobs = r.status === 200 ? parseBoard(c, r.text) : null;
    if (!jobs) {
      const why = r.status === 200 ? 'unreadable answer' : r.status ? `status ${r.status}` : 'no connection';
      if (!down[c.b]) { newlyDown.push(`${companyName(c.b)} (${SOURCES[c.s]}, ${why})`); down[c.b] = why; downChanged = true; }
      continue;
    }
    if (down[c.b]) { delete down[c.b]; downChanged = true; }
    for (const j of jobs) {
      if (seenSet.has(j.k)) continue;
      const s = score(j, f);
      if (!s) continue;
      seenSet.add(j.k);
      fresh.push({ k: j.k, t: j.t, c: companyName(c.b), l: j.l, u: j.u, d: j.d, f: today, s });
    }
  }
  fresh.sort((a, b) => b.s - a.s || String(b.d).localeCompare(String(a.d)));
  if (fresh.length) {
    matches = [...fresh, ...matches.filter((m) => !fresh.some((x) => x.k === m.k))].slice(0, MAX_MATCHES);
    await ctx.memory.set('matches', matches);
    await ctx.memory.set('seen', [...fresh.map((j) => j.k), ...seen].slice(0, MAX_SEEN));
  }
  if (downChanged) await ctx.memory.set('down', down);
  return { fresh, newlyDown, companies };
}

async function intervalRun(ctx) {
  const { fresh, newlyDown } = await checkBoards(ctx);
  const skipped = newlyDown.length ? `\nSkipped (couldn't read): ${newlyDown.join(', ')}. Check the board name; I won't mention it again.` : '';
  if (fresh.length) {
    const top = fresh.slice(0, 5).map((j, i) => `${i + 1}. ${line(j)}`).join('\n');
    const more = fresh.length > 5 ? `\n+${fresh.length - 5} more. Say "jobs" to see them all.` : '';
    await ctx.notify({
      title: `🧑‍💼 ${fresh.length} new job${fresh.length === 1 ? '' : 's'} for you`,
      body: `${top}${more}${skipped}`,
      link: fresh[0].u ? { url: fresh[0].u, label: 'Open best match' } : undefined,
    });
  } else if (newlyDown.length) {
    const one = newlyDown.length === 1;
    await ctx.notify({ title: `Couldn't read ${one ? 'a job board' : `${newlyDown.length} job boards`}`, body: `${newlyDown.join(', ')}. I'll skip ${one ? 'it' : 'them'} for now and won't mention ${one ? 'it' : 'them'} again; check the board name in Settings or say "remove company …".` });
  }
  // Interview reminders, the day before (or the same day if set late).
  const apps = (await ctx.memory.get('apps')) || [];
  const loc = ctx.local();
  const nowKey = `${loc.date}T${loc.time}`;
  let changed = false;
  for (const a of apps) {
    if (a.st !== 'interview' || !a.iv || a.ivr || a.iv < nowKey) continue;
    const d = a.iv.slice(0, 10);
    if (d !== addDays(loc.date, 1) && d !== loc.date) continue;
    a.ivr = 1; changed = true;
    await ctx.notify({ title: `Interview ${d === loc.date ? 'today' : 'tomorrow'}: ${a.c}`, body: `${a.t} at ${a.c}, ${nice(d)} at ${niceTime(a.iv.slice(11))}. Re-read the job post and prepare two questions for them.`, link: a.u ? { url: a.u, label: 'Job post' } : undefined });
  }
  if (changed) await ctx.memory.set('apps', apps);
}

async function weeklyRun(ctx) {
  const today = ctx.local().date;
  if ((await ctx.memory.get('lastWeekly')) === today) return;
  await ctx.memory.set('lastWeekly', today);
  const apps = (await ctx.memory.get('apps')) || [];
  const matches = (await ctx.memory.get('matches')) || [];
  const recent = matches.filter((m) => m.f && dayNum(today) - dayNum(m.f) <= 7);
  if (!apps.length && !recent.length) { ctx.log('Nothing to report this week.'); return; }
  const due = dueFollowUps(apps, today);
  const ivs = apps.filter((a) => a.st === 'interview' && a.iv && a.iv.slice(0, 10) >= today).sort((x, y) => x.iv.localeCompare(y.iv));
  const parts = [`${recent.length} new match${recent.length === 1 ? '' : 'es'} in the last 7 days.`];
  parts.push(`Pipeline: ${STAGES.map((s) => `${apps.filter((a) => a.st === s).length} ${STAGE_NAME[s].toLowerCase()}`).join(' · ')}`);
  if (ivs.length) parts.push(`Interviews: ${ivs.slice(0, 3).map((a) => `${a.c} ${nice(a.iv.slice(0, 10))} ${niceTime(a.iv.slice(11))}`).join('; ')}`);
  if (due.length) parts.push(`Follow-ups due (${due.length}): ${due.slice(0, 3).map((a) => `${a.t} — ${a.c} (applied ${dayNum(today) - dayNum(a.ad)} days ago)`).join('; ')}`);
  else parts.push('No follow-ups due.');
  const link = due.length ? followUpLink(due[0], '') : recent[0] && recent[0].u ? { url: recent[0].u, label: 'Open newest match' } : undefined;
  await ctx.notify({ title: 'Your job hunt this week', body: parts.join('\n'), link });
}

async function messageRun(ctx) {
  const raw = String(ctx.input.text || '').trim();
  const t = raw.toLowerCase().replace(/\s+/g, ' ');
  const today = ctx.local().date;
  const from = String(ctx.input.from || '').trim();
  let m;

  if (!t || /^(help|\?|what can you do|commands|hi|hello)\b/.test(t)) return ctx.reply(HELP);

  if (/^(jobs|new|new jobs|matches|latest|show jobs|show matches|any new jobs)\b/.test(t)) {
    const matches = (await ctx.memory.get('matches')) || [];
    if (!matches.length) return ctx.reply("No matches yet. I check your companies' boards every 6 hours; say \"companies\" to see which, or \"keywords: backend, platform\" to widen the search.");
    const shown = matches.slice(0, 10);
    return ctx.reply(`Latest matches:\n${shown.map((j, i) => `${i + 1}. ${line(j)}${j.d ? ` · ${j.d}` : ''}`).join('\n')}\n\nSay "applied 2" when you apply.`, { link: shown[0].u ? { url: shown[0].u, label: 'Open #1' } : undefined });
  }

  if ((m = t.match(/^(?:i\s+)?applied\s+(?:to\s+|for\s+|at\s+)?(.+)$/))) {
    const apps = (await ctx.memory.get('apps')) || [];
    const matches = (await ctx.memory.get('matches')) || [];
    let job;
    const n = m[1].match(/^#?(\d{1,2})$/);
    if (n) {
      job = matches[Number(n[1]) - 1];
      if (!job) return ctx.reply(`There's no match #${n[1]}. Say "jobs" to see the numbered list${matches.length ? ` (1-${Math.min(matches.length, 10)})` : ''}.`);
      job = { c: job.c, t: job.t, u: job.u };
    } else {
      const words = m[1].split(' ');
      const co = words[0];
      const rest = words.slice(1).join(' ');
      const hit = matches.find((j) => j.c.toLowerCase().replace(/\s+/g, '').startsWith(co) && (!rest || j.t.toLowerCase().includes(rest)));
      job = hit ? { c: hit.c, t: hit.t, u: hit.u } : { c: companyName(co), t: rest ? titleCase(rest) : 'Role', u: '' };
    }
    const existing = apps.find((a) => a.c === job.c && a.t.toLowerCase() === job.t.toLowerCase());
    if (existing && existing.st !== 'rejected') return ctx.reply(`Already tracking ${job.t} at ${job.c} (${STAGE_NAME[existing.st].toLowerCase()} since ${nice(existing.up || existing.ad)}).`);
    const id = apps.reduce((x, a) => Math.max(x, a.id || 0), 0) + 1;
    apps.push({ id, c: job.c, t: job.t, u: job.u, st: 'applied', ad: today, up: today });
    await ctx.memory.set('apps', trimApps(apps));
    const open = apps.filter((a) => a.st === 'applied' || a.st === 'interview').length;
    return ctx.reply(`Logged: applied to ${job.t} at ${job.c} on ${nice(today)}. If nothing changes, I'll suggest a follow-up after ${nice(addDays(today, FOLLOW_UP_DAYS + 1))}. ${open} application${open === 1 ? '' : 's'} open.`);
  }

  if ((m = t.match(/^followed[- ]up(?:\s+(?:with|on))?\s+(.+)$/))) {
    const apps = (await ctx.memory.get('apps')) || [];
    const a = findApp(apps, m[1]);
    if (!a) return ctx.reply(`I don't have an application at "${m[1]}". Say "pipeline" to see them.`);
    a.up = today;
    await ctx.memory.set('apps', apps);
    return ctx.reply(`Noted: followed up on ${a.t} at ${a.c} today. I'll check again after ${nice(addDays(today, FOLLOW_UP_DAYS + 1))}.`);
  }

  if ((m = t.match(/^(?:i have an |got an |an )?interview(?:ing)?\s+(?:with\s+|at\s+)?(.+)$/))) {
    const apps = (await ctx.memory.get('apps')) || [];
    let rest = m[1];
    const d = findDate(rest, today);
    if (d) rest = rest.replace(d.match, ' ');
    const tm = findTime(rest);
    if (tm) rest = rest.replace(tm.match, ' ');
    rest = rest.replace(/\b(on|at|next|this)\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (!rest) return ctx.reply('Which company? For example: "interview stripe fri 2pm".');
    let a = findApp(apps, rest);
    if (!a) {
      const words = rest.split(' ');
      a = { id: apps.reduce((x, y) => Math.max(x, y.id || 0), 0) + 1, c: companyName(words[0]), t: words.length > 1 ? titleCase(words.slice(1).join(' ')) : 'Role', u: '', st: 'interview', ad: today, up: today };
      apps.push(a);
    }
    a.st = 'interview'; a.up = today;
    if (d && d.date) { a.iv = `${d.date}T${tm ? tm.time : '09:00'}`; delete a.ivr; }
    await ctx.memory.set('apps', trimApps(apps));
    if (!a.iv) return ctx.reply(`Moved ${a.t} at ${a.c} to interview. When is it? Say "interview ${a.c.toLowerCase()} fri 2pm" and I'll remind you the day before.`);
    const day = a.iv.slice(0, 10);
    const remind = day <= addDays(today, 1) ? 'I will remind you before it.' : `I'll remind you on ${nice(addDays(day, -1))}.`;
    return ctx.reply(`Interview with ${a.c} (${a.t}): ${nice(day)} at ${niceTime(a.iv.slice(11))}${tm ? '' : ' (time not given, I used 9 AM)'}. ${remind}`);
  }

  if ((m = t.match(/^(?:got an? |got |an? )?(offer|rejected|rejection|reject|declined)\s+(?:from\s+|by\s+|at\s+)?(.+)$/))) {
    const st = m[1] === 'offer' ? 'offer' : 'rejected';
    const apps = (await ctx.memory.get('apps')) || [];
    const a = findApp(apps, m[2]);
    if (!a) return ctx.reply(`I don't have an application at "${m[2]}". Log it first with "applied ${m[2].split(' ')[0]} <role>", or say "pipeline".`);
    a.st = st; a.up = today;
    await ctx.memory.set('apps', apps);
    const counts = STAGES.map((s) => `${apps.filter((x) => x.st === s).length} ${STAGE_NAME[s].toLowerCase()}`).join(' · ');
    return ctx.reply(st === 'offer'
      ? `🎉 Offer from ${a.c} for ${a.t}! Logged. Ask for the offer in writing and take a day before you answer. Pipeline: ${counts}.`
      : `Sorry about ${a.c} (${a.t}). Logged as rejected; on to the next one. Pipeline: ${counts}.`);
  }

  if (/^(pipeline|status|my applications|applications|where am i)\b/.test(t)) {
    const apps = (await ctx.memory.get('apps')) || [];
    return ctx.reply(pipelineText(apps, today));
  }

  if (/^follow[- ]?ups?\b|^who should i follow up/.test(t)) {
    const apps = (await ctx.memory.get('apps')) || [];
    const due = dueFollowUps(apps, today);
    if (!due.length) return ctx.reply(`No follow-ups due: nothing has been waiting more than ${FOLLOW_UP_DAYS} days since you applied. ${apps.filter((a) => a.st === 'applied').length} application(s) waiting.`);
    await ctx.reply(`${due.length} follow-up${due.length === 1 ? '' : 's'} due (applied over ${FOLLOW_UP_DAYS} days ago, no update). Each email below is ready to send; add the recruiter's address. Then say "followed up <company>".`);
    for (const a of due.slice(0, 3)) await ctx.reply(`${a.t} — ${a.c}: applied ${nice(a.ad)} (${dayNum(today) - dayNum(a.ad)} days ago).`, { link: followUpLink(a, from) });
    return true;
  }

  if ((m = t.match(/^(?:add|watch|track) (?:company )?(\S+)(?:\s+(?:on\s+)?(\S+))?$/)) && (t.includes('company') || (m[2] && SOURCES[m[2]]))) {
    const b = m[1].replace(/[^a-z0-9._-]/g, '');
    const s = m[2] && m[2].replace(/[^a-z]/g, '');
    if (!s || !SOURCES[s]) return ctx.reply(`Where does ${companyName(b)} post jobs? Say "add company ${b} greenhouse", "... lever" or "... ashby" (look at their careers page address: boards.greenhouse.io, jobs.lever.co or jobs.ashbyhq.com).`);
    const { extra } = await effectiveCompanies(ctx);
    extra.add = extra.add.filter((c) => c.b !== b).concat([{ b, s }]);
    extra.rm = extra.rm.filter((x) => x !== b);
    await ctx.memory.set('co', extra);
    return ctx.reply(`Added ${companyName(b)} (${SOURCES[s]}). I'll check its board on the next run, every 6 hours.`);
  }

  if ((m = t.match(/^(?:remove|delete|drop|stop watching|unwatch) (?:company )?(\S+)$/))) {
    const b = m[1].replace(/[^a-z0-9._-]/g, '');
    const { extra, list: cur } = await effectiveCompanies(ctx);
    if (!cur.some((c) => c.b === b)) return ctx.reply(`I'm not watching "${b}". I watch: ${cur.map((c) => companyName(c.b)).join(', ') || 'nothing yet'}.`);
    extra.add = extra.add.filter((c) => c.b !== b);
    if (!extra.rm.includes(b)) extra.rm.push(b);
    await ctx.memory.set('co', extra);
    return ctx.reply(`Removed ${companyName(b)}. Still watching ${cur.length - 1}: ${cur.filter((c) => c.b !== b).map((c) => companyName(c.b)).join(', ') || 'none'}.`);
  }

  if (/^(companies|boards|who do you watch)\b/.test(t)) {
    const { list: cur } = await effectiveCompanies(ctx);
    const f = await filters(ctx);
    return ctx.reply(`Watching ${cur.length}: ${cur.map((c) => `${companyName(c.b)} (${SOURCES[c.s]})`).join(', ') || 'none'}.\nKeywords: ${f.kw.join(', ') || 'any title'}. Skip: ${f.ex.join(', ') || 'nothing'}. Locations: ${f.loc.join(', ') || 'anywhere'}.`);
  }

  if ((m = t.match(/^keywords?\s*[:=]?\s*(.*)$/))) {
    const kw = list(m[1]);
    if (!kw.length) { const f = await filters(ctx); return ctx.reply(`Keywords now: ${f.kw.join(', ') || 'any title'}. Change them with "keywords: backend, platform".`); }
    await ctx.memory.set('kw', kw);
    return ctx.reply(`Keywords set: ${kw.join(', ')}. A title must contain one of them. Applies from the next check.`);
  }

  return ctx.reply(`I didn't catch that ("${raw.slice(0, 60)}"). I track job matches and your applications. Try "jobs", "applied 2", "interview stripe fri 2pm", "pipeline", "follow ups" or "help".`);
}

async function run(ctx) {
  const type = ctx.trigger.type;
  if (type === 'message') return messageRun(ctx);
  if (type === 'schedule') return weeklyRun(ctx);
  return intervalRun(ctx);
}
