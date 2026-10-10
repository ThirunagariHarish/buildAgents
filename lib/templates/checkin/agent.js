async function run(ctx) {
  const today = ctx.local().date;
  const person = String(ctx.settings.person || 'They');
  const last = await ctx.memory.get('lastOk');
  if (ctx.trigger.type === 'manual') {
    if (ctx.input.status === 'Please call me') {
      await ctx.notify({ title: `📞 ${person} asked for a call`, body: `${person} tapped "Please call me" at ${ctx.local().time}. Give them a ring.` });
      return;
    }
    if (last === today) return;
    await ctx.memory.set('lastOk', today);
    await ctx.notify({ title: `💛 ${person} checked in`, body: `${person} is OK today (${ctx.local().time}).` });
    return;
  }
  if (last === today) return;
  await ctx.notify({ title: `${person} hasn't checked in today`, body: `No "I'm OK" from ${person} yet. ${person}: tap Run → I'm OK. Family: a quick call might be good.` });
}
