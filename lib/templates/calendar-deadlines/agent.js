function unfold(text) { return String(text).replace(/\r?\n[ \t]/g, ''); }
function events(text) {
  const out = [];
  const re = /BEGIN:(VEVENT|VTODO)([\s\S]*?)END:\1/g;
  let m;
  while ((m = re.exec(unfold(text))) && out.length < 2000) {
    const body = m[2];
    const when = (body.match(/\n(?:DTSTART|DUE)[^:\n]*:(\d{8})(T(\d{2})(\d{2}))?/) || []);
    const title = ((body.match(/\nSUMMARY[^:\n]*:(.*)/) || [])[1] || 'Untitled').replace(/\\,/g, ',').replace(/\\n/g, ' ').trim();
    if (when[1]) out.push({ date: `${when[1].slice(0, 4)}-${when[1].slice(4, 6)}-${when[1].slice(6, 8)}`, time: when[3] ? `${when[3]}:${when[4]}` : '', title, task: m[1] === 'VTODO' });
  }
  return out;
}
function addDays(date, n) { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

async function run(ctx) {
  const today = ctx.local().date;
  const days = Math.min(Math.max(Number(ctx.settings.days) || 2, 1), 14);
  const last = addDays(today, days - 1);
  const r = await ctx.http.get(ctx.settings.icsUrl);
  if (r.status !== 200) { await ctx.notify({ title: 'Calendar link not working', body: `I couldn't read your calendar (status ${r.status}). Check the link in this agent's settings.` }); return; }
  const soon = events(r.text).filter((e) => e.date >= today && e.date <= last).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  if (!soon.length) return;
  const label = (e) => `${e.date === today ? 'Today' : e.date === addDays(today, 1) ? 'Tomorrow' : e.date.slice(5)}${e.time ? ` ${e.time}` : ''}: ${e.task ? 'Due: ' : ''}${e.title}`;
  await ctx.notify({ title: soon.length === 1 ? soon[0].title : `${soon.length} things in the next ${days} days`, body: soon.slice(0, 8).map(label).join('\n') + (soon.length > 8 ? `\n…and ${soon.length - 8} more` : '') });
}
