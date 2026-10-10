async function where(ctx) {
  const here = await ctx.location.current();
  if (here) return here;
  const m = String(ctx.settings.place || '').match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  return m ? { lat: Number(m[1]), lon: Number(m[2]) } : null;
}

async function run(ctx) {
  const at = await where(ctx);
  if (!at) {
    if (!(await ctx.memory.get('askedForPlace'))) {
      await ctx.memory.set('askedForPlace', true);
      await ctx.notify({ title: 'Where are you?', body: 'Allow location when Pocket Box asks, or add your place (lat, lon) in this agent\'s settings.' });
    }
    return;
  }
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${at.lat.toFixed(2)}&longitude=${at.lon.toFixed(2)}&hourly=precipitation_probability&daily=precipitation_probability_max,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`;
  const r = await ctx.http.get(url);
  if (r.status !== 200) { ctx.log(`Forecast unavailable (status ${r.status}).`); return; }
  let f;
  try { f = JSON.parse(r.text); } catch (e) { ctx.log('Forecast was not readable.'); return; }
  const rain = f.daily.precipitation_probability_max[0];
  const hi = Math.round(f.daily.temperature_2m_max[0]), lo = Math.round(f.daily.temperature_2m_min[0]);
  const limit = Number(ctx.settings.rainChance) || 40;
  if (rain >= limit) {
    const probs = f.hourly.precipitation_probability || [];
    const peak = probs.indexOf(Math.max(...probs));
    const when = peak >= 0 && f.hourly.time[peak] ? ` Most likely around ${String(f.hourly.time[peak]).slice(11, 16)}.` : '';
    await ctx.notify({ title: 'Take an umbrella ☔', body: `${rain}% chance of rain today.${when} ${lo}–${hi}°C.` });
  } else if (lo <= 8) {
    await ctx.notify({ title: 'Wear a warm jacket 🧥', body: `Dry, but cold: ${lo}–${hi}°C today.` });
  } else ctx.log(`No umbrella needed: ${rain}% rain, ${lo}–${hi}°C.`);
}
