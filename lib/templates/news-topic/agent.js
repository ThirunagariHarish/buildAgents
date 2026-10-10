function items(xml) {
  const out = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) && out.length < 40) {
    const t = (m[1].match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
    const l = (m[1].match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '';
    const title = t.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
    if (title) out.push({ title, link: l.trim() });
  }
  return out;
}

async function run(ctx) {
  const topic = String(ctx.settings.topic || '').trim();
  if (!topic) return;
  const r = await ctx.http.get(`https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en-US&gl=US&ceid=US:en`);
  if (r.status !== 200) return;
  const all = items(r.text);
  const seen = (await ctx.memory.get('seen')) || [];
  const fresh = all.filter((x) => !seen.includes(x.title.slice(0, 80)));
  await ctx.memory.set('seen', [...fresh.map((x) => x.title.slice(0, 80)), ...seen].slice(0, 120));
  if (!seen.length) {
    if (all.length) await ctx.notify({ title: `Watching news about "${topic}"`, body: `Latest: ${all[0].title}\nI'll send new headlines as they appear.` });
    return;
  }
  if (!fresh.length) return;
  const top = fresh.slice(0, 3);
  await ctx.notify({ title: fresh.length === 1 ? top[0].title : `${fresh.length} new on "${topic}"`, body: top.map((x) => `• ${x.title}`).join('\n') });
}
