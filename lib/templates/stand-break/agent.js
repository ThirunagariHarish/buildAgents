const IDEAS = [
  'Stand up, roll your shoulders back ten times.',
  'Walk to get a glass of water.',
  'Look at something 20 feet away for 20 seconds.',
  'Stretch your arms overhead and hold for 15 seconds.',
  'Ten slow squats, then back to it.',
  'Stand and stretch your calves against a wall.',
];

async function run(ctx) {
  const t = ctx.local();
  if (t.weekday === 'sat' || t.weekday === 'sun') return;
  const start = String(ctx.settings.start || '09:00'), end = String(ctx.settings.end || '18:00');
  if (t.time < start || t.time >= end) return;
  const i = ((await ctx.memory.get('i')) || 0) % IDEAS.length;
  await ctx.memory.set('i', i + 1);
  await ctx.notify({ title: 'Time to stand up 🧍', body: IDEAS[i] });
}
