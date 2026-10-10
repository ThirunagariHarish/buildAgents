function host(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return 'your site'; } }

async function run(ctx) {
  const url = ctx.settings.url;
  const r = await ctx.http.get(url);
  const up = r.status >= 200 && r.status < 400;
  const state = (await ctx.memory.get('state')) || { up: true, misses: 0, since: null };
  if (up) {
    if (!state.up) await ctx.notify({ title: `${host(url)} is back up`, body: `It answers again (status ${r.status}). It was down since ${state.since}.` });
    await ctx.memory.set('state', { up: true, misses: 0, since: null });
    return;
  }
  const misses = state.misses + 1;
  const since = state.since || ctx.local().time;
  // Two misses in a row before alarming, so one blip doesn't wake you.
  if (state.up && misses === 2) await ctx.notify({ title: `${host(url)} is down`, body: `Two checks in a row failed (status ${r.status || 'no answer'}). I'll tell you when it's back.` });
  await ctx.memory.set('state', { up: state.up && misses < 2, misses, since });
}
