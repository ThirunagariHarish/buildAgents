async function where(ctx) {
  const here = await ctx.location.current();
  if (here) return here;
  const m = String(ctx.settings.place || '').match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  return m ? { lat: Number(m[1]), lon: Number(m[2]) } : null;
}

async function run(ctx) {
  const at = await where(ctx);
  if (!at) { ctx.log('No location and no place set.'); return; }
  const r = await ctx.http.get(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${at.lat.toFixed(2)}&longitude=${at.lon.toFixed(2)}&current=us_aqi,pm2_5`);
  if (r.status !== 200) return;
  let aqi;
  try { aqi = Math.round(JSON.parse(r.text).current.us_aqi); } catch (e) { return; }
  if (!Number.isFinite(aqi)) return;
  const limit = Number(ctx.settings.limit) || 100;
  const wasBad = !!(await ctx.memory.get('bad'));
  const bad = aqi > limit;
  await ctx.memory.set('bad', bad);
  if (bad && !wasBad) await ctx.notify({ title: `Unhealthy air: AQI ${aqi}`, body: 'Keep windows closed, skip outdoor exercise, and consider a mask outside.' });
  if (!bad && wasBad) await ctx.notify({ title: `Air is clearer: AQI ${aqi}`, body: 'Back under your limit. Fine to open up and head out.' });
}
