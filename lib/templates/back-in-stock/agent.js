function visibleText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
function host(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return 'the page'; } }

async function run(ctx) {
  const url = ctx.settings.url;
  const marker = String(ctx.settings.soldOutText || 'out of stock').toLowerCase();
  const r = await ctx.http.get(url);
  if (r.status !== 200) { ctx.log(`Could not read the page (status ${r.status}).`); return; }
  const soldOut = visibleText(r.text).toLowerCase().includes(marker);
  const was = await ctx.memory.get('soldOut');
  await ctx.memory.set('soldOut', soldOut);
  if (!soldOut && was !== false) {
    await ctx.notify({ title: `In stock on ${host(url)}`, body: `It no longer says "${ctx.settings.soldOutText || 'out of stock'}". Go now:\n${url}` });
  }
}
