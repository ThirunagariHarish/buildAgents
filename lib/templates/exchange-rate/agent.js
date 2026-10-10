async function run(ctx) {
  const from = String(ctx.settings.from || 'USD').trim().toUpperCase().slice(0, 3);
  const to = String(ctx.settings.to || 'INR').trim().toUpperCase().slice(0, 3);
  const r = await ctx.http.get(`https://open.er-api.com/v6/latest/${from}`);
  if (r.status !== 200) return;
  let rate;
  try { rate = JSON.parse(r.text).rates[to]; } catch (e) { return; }
  if (!Number.isFinite(rate)) { ctx.log(`No rate for ${from}/${to}.`); return; }
  const above = Number(ctx.settings.above), below = Number(ctx.settings.below);
  const st = (await ctx.memory.get('state')) || {};
  const pair = `${from}/${to}`;
  const shown = rate.toFixed(rate < 10 ? 4 : 2);
  if (Number.isFinite(above) && above > 0) {
    if (rate > above && !st.above) await ctx.notify({ title: `${pair} is above ${above}`, body: `Now ${shown}.` });
    st.above = rate > above;
  }
  if (Number.isFinite(below) && below > 0) {
    if (rate < below && !st.below) await ctx.notify({ title: `${pair} is below ${below}`, body: `Now ${shown}.` });
    st.below = rate < below;
  }
  if (!(above > 0) && !(below > 0)) {
    if (st.ref && Math.abs(rate - st.ref) / st.ref >= 0.01) { await ctx.notify({ title: `${pair} moved ${rate > st.ref ? 'up' : 'down'} 1%`, body: `Now ${shown}, was ${st.ref.toFixed(rate < 10 ? 4 : 2)}.` }); st.ref = rate; }
    if (!st.ref) st.ref = rate;
  }
  await ctx.memory.set('state', st);
}
