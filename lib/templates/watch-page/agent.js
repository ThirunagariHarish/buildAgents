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

function digest(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }
function sentences(t) { return t.split(/(?<=[.!?])\s+|\s{2,}/).map((x) => x.trim()).filter((x) => x.length > 12); }

async function run(ctx) {
  const url = ctx.settings.url;
  const r = await ctx.http.get(url);
  if (r.status !== 200) {
    const fails = ((await ctx.memory.get('fails')) || 0) + 1;
    await ctx.memory.set('fails', fails);
    if (fails === 3) await ctx.notify({ title: `Can't read ${host(url)}`, body: `I couldn't open the page three checks in a row (status ${r.status}). I'll keep trying.` });
    return;
  }
  if (await ctx.memory.get('fails')) await ctx.memory.set('fails', 0);
  const text = visibleText(r.text).slice(0, 12000);
  const hash = digest(text);
  const before = await ctx.memory.get('hash');
  if (before === hash) return;
  const old = (await ctx.memory.get('snapshot')) || '';
  await ctx.memory.set('hash', hash);
  await ctx.memory.set('snapshot', text);
  if (before === null) { ctx.log('First look: saved the page to compare against next time.'); return; }
  const look = String(ctx.settings.lookFor || '').trim();
  if (look) {
    const low = look.toLowerCase();
    if (!text.toLowerCase().includes(low) || old.toLowerCase().includes(low)) return;
    const at = text.toLowerCase().indexOf(low);
    await ctx.notify({ title: `"${look}" is on ${host(url)}`, body: `…${text.slice(Math.max(0, at - 80), at + 160)}…\n${url}` });
    return;
  }
  const fresh = sentences(text).filter((x) => !old.includes(x));
  await ctx.notify({ title: `${host(url)} changed`, body: `${fresh.length ? fresh.slice(0, 2).join(' ').slice(0, 300) : 'Something on the page is different.'}\n${url}` });
}
