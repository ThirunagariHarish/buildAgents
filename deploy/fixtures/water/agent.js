async function run(ctx) {
  const hour = Number(ctx.now().slice(11, 13));
  if (hour < 8 || hour >= 22) { ctx.log('night, quiet'); return; }
  const day = ctx.now().slice(0, 10);
  const c = (await ctx.memory.get('count')) || { day, n: 0 };
  const n = c.day === day ? c.n + 1 : 1;
  const goal = Number(ctx.settings.glasses) || 8;
  await ctx.notify({ title: 'Time for water', body: n >= goal ? 'Goal reached today. One more is fine.' : 'Glass ' + n + ' of ' + goal + '.' });
  await ctx.memory.set('count', { day, n });
}
