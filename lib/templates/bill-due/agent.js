function parseBills(text) {
  return String(text || '').split(/[,;\n]+/).map((x) => x.trim()).map((x) => {
    const m = x.match(/^(.*?)\s*(\d{1,2})(?:st|nd|rd|th)?$/i);
    return m && Number(m[2]) >= 1 && Number(m[2]) <= 31 ? { name: m[1].trim() || 'Bill', day: Number(m[2]) } : null;
  }).filter(Boolean);
}
function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

async function run(ctx) {
  const today = ctx.local().date;
  const [y, mo, d] = today.split('-').map(Number);
  const lead = Math.min(Math.max(Number(ctx.settings.lead) || 3, 0), 14);
  const sent = (await ctx.memory.get('sent')) || {};
  const due = [];
  for (const b of parseBills(ctx.settings.bills)) {
    // The next due date: this month if not passed, else next month (clamped to the month's length).
    let yy = y, mm = mo, dd = Math.min(b.day, daysInMonth(y, mo));
    if (dd < d) { mm = mo === 12 ? 1 : mo + 1; yy = mo === 12 ? y + 1 : y; dd = Math.min(b.day, daysInMonth(yy, mm)); }
    const days = Math.round((Date.UTC(yy, mm - 1, dd) - Date.UTC(y, mo - 1, d)) / 864e5);
    const key = `${b.name}:${yy}-${mm}`;
    if (days <= lead && !sent[key]) { due.push({ ...b, days }); sent[key] = today; }
  }
  if (!due.length) return;
  due.sort((a, b) => a.days - b.days);
  await ctx.memory.set('sent', Object.fromEntries(Object.entries(sent).slice(-40)));
  const say = (b) => `${b.name}: ${b.days === 0 ? 'due today' : b.days === 1 ? 'due tomorrow' : `due in ${b.days} days`}`;
  await ctx.notify({ title: due.length === 1 ? `${due[0].name} ${due[0].days === 0 ? 'is due today' : `is due in ${due[0].days} day${due[0].days === 1 ? '' : 's'}`}` : `${due.length} bills due soon`, body: due.map(say).join('\n') });
}
