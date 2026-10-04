// Name checks: is the suggested product name free as a domain? A DNS lookup
// is a good first signal (no records usually means unregistered) without any
// registrar API. Social handles are given as links to check by hand.

const dns = require('dns').promises;

const TLDS = ['.com', '.io', '.app', '.co', '.ai', '.dev'];

function candidates(name) {
  const base = String(name || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim();
  if (!base) return [];
  const joined = base.replace(/\s+/g, '');
  const dashed = base.replace(/\s+/g, '-');
  const list = [joined];
  if (dashed !== joined) list.push(dashed);
  if (!/app$/.test(joined)) list.push(`${joined}app`);
  list.push(`get${joined}`, `try${joined}`);
  return [...new Set(list)].filter((s) => s.length >= 3 && s.length <= 40).slice(0, 5);
}

async function lookup(host) {
  try {
    const [a, ns] = await Promise.allSettled([dns.resolve4(host), dns.resolveNs(host)]);
    const taken = (a.status === 'fulfilled' && a.value.length > 0) || (ns.status === 'fulfilled' && ns.value.length > 0);
    if (taken) return 'taken';
    const codes = [a, ns].map((r) => r.reason?.code);
    if (codes.includes('ENOTFOUND') || codes.includes('ENODATA')) return 'free';
    return 'unknown';
  } catch { return 'unknown'; }
}

/** Returns { names: [{ name, domains: [{ domain, status }] }], handles: [...] } */
async function checkNames(name) {
  const names = candidates(name);
  const out = [];
  for (const n of names) {
    const domains = await Promise.all(TLDS.map(async (tld) => ({ domain: `${n}${tld}`, status: await lookup(`${n}${tld}`) })));
    out.push({ name: n, domains });
  }
  const handle = names[0] || '';
  const handles = handle ? [
    { site: 'X', url: `https://x.com/${handle}` },
    { site: 'Instagram', url: `https://instagram.com/${handle}` },
    { site: 'GitHub', url: `https://github.com/${handle}` },
    { site: 'Product Hunt', url: `https://www.producthunt.com/search?q=${encodeURIComponent(name)}` },
    { site: 'App Store', url: `https://www.apple.com/us/search/${encodeURIComponent(name)}?src=globalnav` },
  ] : [];
  return { query: name, names: out, handles, note: '"free" means no DNS records were found, which usually means unregistered; confirm with a registrar before you rely on it.' };
}

module.exports = { checkNames, candidates };
