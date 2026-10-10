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

function firstPrice(text) {
  const m = text.match(/(?:[$€£₹]|USD|EUR|GBP|INR|Rs\.?)\s?(\d{1,3}(?:[,.]\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/);
  if (!m) return null;
  const raw = m[1];
  const n = Number(/\.\d{3}/.test(raw) && !/\.\d{1,2}$/.test(raw) ? raw.replace(/\./g, '') : raw.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function run(ctx) {
  const url = ctx.settings.url;
  const target = Number(ctx.settings.target);
  const r = await ctx.http.get(url);
  if (r.status !== 200) { ctx.log(`Could not read the page (status ${r.status}).`); return; }
  const price = firstPrice(visibleText(r.text));
  if (price === null) {
    if (!(await ctx.memory.get('warned'))) {
      await ctx.memory.set('warned', true);
      await ctx.notify({ title: `No price found on ${host(url)}`, body: 'I could not find a price on that page. Try the product\'s own page rather than a list or search page.' });
    }
    return;
  }
  const last = await ctx.memory.get('lastPrice');
  await ctx.memory.set('lastPrice', price);
  if (price <= target && (last === null || price < last || last > target)) {
    await ctx.notify({ title: `Price drop: ${price} on ${host(url)}`, body: `It's at or below your target of ${target}${last !== null ? ` (was ${last})` : ''}.\n${url}` });
  }
}
