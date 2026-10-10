async function run(ctx) {
  const t = ctx.local();
  if (t.hour < 8 || t.hour >= 21) { ctx.log('Night time: staying quiet.'); return; }
  const goal = Math.min(Math.max(Number(ctx.settings.glasses) || 8, 1), 20);
  const c = (await ctx.memory.get('count')) || { day: t.date, n: 0 };
  const n = c.day === t.date ? c.n + 1 : 1;
  await ctx.memory.set('count', { day: t.date, n });
  if (n > goal) return;
  await ctx.notify({ title: n === goal ? 'Last glass for today 💧' : 'Time for a glass of water 💧', body: n === goal ? `That's ${goal} of ${goal}. Nicely done.` : `Glass ${n} of ${goal}.` });
}
