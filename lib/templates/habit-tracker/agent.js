function prevDay(date) { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }

async function run(ctx) {
  const today = ctx.local().date;
  const habit = String(ctx.settings.habit || 'your habit');
  const s = (await ctx.memory.get('streak')) || { last: null, count: 0, best: 0 };
  if (ctx.trigger.type === 'manual') {
    if (ctx.input.did !== 'Yes') { await ctx.notify({ title: 'Noted. Tomorrow is a new day.', body: `Your best streak for "${habit}" is ${s.best} days.` }); return; }
    if (s.last === today) { await ctx.notify({ title: 'Already logged today ✓', body: `${s.count}-day streak.` }); return; }
    const count = s.last === prevDay(today) ? s.count + 1 : 1;
    const best = Math.max(best0(s), count);
    await ctx.memory.set('streak', { last: today, count, best });
    await ctx.notify({ title: count > 1 ? `🔥 ${count}-day streak` : 'Day 1 logged ✓', body: count === best && count > 1 ? `Your best ever for "${habit}".` : `Keep it going tomorrow.` });
    return;
  }
  if (s.last === today) return;
  await ctx.notify({ title: `Did you ${habit} today?`, body: s.last === prevDay(today) && s.count > 1 ? `Log it to keep your ${s.count}-day streak.` : 'Tap Run to log it.' });
}
function best0(s) { return Number(s.best) || 0; }
