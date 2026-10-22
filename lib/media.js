// Pictures: a real photo of the existing product (Wikimedia Commons first,
// then the preview image of a product page the Scout found), and the
// agents' concept sketches (SVG), cleaned before they are stored.

const store = require('./store');

const UA = 'Reinvent/1.0 (product research; contact via reinvent.cashflowus.com)';
const MAX_IMAGE = 4 * 1024 * 1024;

async function get(url, { as = 'json', timeoutMs = 15000, accept } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { 'User-Agent': UA, ...(accept ? { Accept: accept } : {}) } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    if (as === 'json') return await r.json();
    if (as === 'text') return (await r.text()).slice(0, 600000);
    const len = Number(r.headers.get('content-length') || 0);
    if (len > MAX_IMAGE) throw new Error('image too large');
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_IMAGE) throw new Error('image too large');
    return { buf, type: r.headers.get('content-type') || '' };
  } finally { clearTimeout(t); }
}

/** jpg / png / webp by their first bytes, or null. */
function imageKind(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

/** A photo from Wikimedia Commons for a short search term: { file, credit, source } or null. */
async function commonsPhoto(query) {
  const q = String(query || '').trim().slice(0, 80);
  if (!q) return null;
  const api = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=8&gsrsearch=${encodeURIComponent(`filetype:bitmap ${q}`)}&prop=imageinfo&iiprop=url|extmetadata|size&iiurlwidth=900`;
  const j = await get(api);
  const pages = Object.values((j.query && j.query.pages) || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  for (const pg of pages) {
    const ii = (pg.imageinfo || [])[0];
    if (!ii || !ii.thumburl || (ii.width || 0) < 300) continue;
    try {
      const { buf } = await get(ii.thumburl, { as: 'buffer' });
      const kind = imageKind(buf);
      if (!kind) continue;
      const meta = ii.extmetadata || {};
      const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
      return { file: store.saveMedia(buf, kind), credit: `${strip(meta.Artist && meta.Artist.value) || 'Wikimedia Commons'}${meta.LicenseShortName ? `, ${strip(meta.LicenseShortName.value)}` : ''}`, source: ii.descriptionurl || 'https://commons.wikimedia.org' };
    } catch {}
  }
  return null;
}

/** The og:image (or twitter:image) of a page: { file, credit, source } or null. */
async function pagePhoto(pageUrl) {
  if (!/^https:\/\/[^\s"<>]+$/.test(String(pageUrl || ''))) return null;
  const html = await get(pageUrl, { as: 'text', accept: 'text/html' });
  const m = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]*content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/i);
  if (!m) return null;
  let src;
  try { src = new URL(m[1].replace(/&amp;/g, '&'), pageUrl).href; } catch { return null; }
  if (!/^https:/.test(src)) return null;
  const { buf } = await get(src, { as: 'buffer' });
  const kind = imageKind(buf);
  if (!kind) return null;
  return { file: store.saveMedia(buf, kind), credit: new URL(pageUrl).hostname.replace(/^www\./, ''), source: pageUrl };
}

/** The first photo that works, trying Commons then each page. */
async function productPhoto({ imageQuery, imagePages = [], name }) {
  if (process.env.RV_NO_PHOTOS === '1') return null; // tests
  for (const q of [imageQuery, name].filter(Boolean)) { try { const r = await commonsPhoto(q); if (r) return r; } catch {} }
  for (const u of (imagePages || []).slice(0, 4)) { try { const r = await pagePhoto(u); if (r) return r; } catch {} }
  return null;
}

// ---- SVG concept sketches -----------------------------------------------------------------
const SVG_TAGS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'lineargradient', 'radialgradient', 'stop', 'marker', 'title', 'desc', 'clippath', 'mask', 'pattern', 'use', 'symbol']);
/**
 * Keep only drawing elements and plain attributes: no scripts, event
 * handlers, external references, embedded images or foreign content.
 * Returns the cleaned SVG text, or null if nothing usable is left.
 */
function cleanSvg(raw) {
  let s = String(raw || '').trim();
  const a = s.search(/<svg[\s>]/i), b = s.toLowerCase().lastIndexOf('</svg>');
  if (a < 0 || b < a) return null;
  s = s.slice(a, b + 6);
  if (s.length > 80000) return null;
  s = s.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '').replace(/<!(DOCTYPE|ENTITY)[^>]*>/gi, '');
  // Drop whole forbidden elements with their content, then any other unknown tag.
  s = s.replace(/<(script|style|foreignObject|image|iframe|object|embed|a|animate\w*|set)\b[\s\S]*?(<\/\1\s*>|\/>)/gi, '');
  s = s.replace(/<\/?([a-zA-Z][\w:-]*)([^>]*)>/g, (tag, name, attrs) => {
    if (!SVG_TAGS.has(name.toLowerCase())) return '';
    if (tag.startsWith('</')) return `</${name}>`;
    const kept = [];
    attrs.replace(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g, (_, k, __, v1, v2) => {
      const key = k.toLowerCase(), v = v1 !== undefined ? v1 : v2;
      if (/^on/.test(key)) return '';
      if ((key === 'href' || key === 'xlink:href') && !/^#[\w-]+$/.test(v)) return '';
      if (/javascript:|data:|@import|expression\(/i.test(v)) return '';
      // url(...) may only point inside the drawing (a gradient or marker id).
      if ((v.match(/url\([^)]*\)/gi) || []).some((u) => !/^url\(\s*['"]?#[\w-]+['"]?\s*\)$/i.test(u))) return '';
      kept.push(`${k}="${v.replace(/"/g, '&quot;')}"`);
      return '';
    });
    const selfClose = /\/\s*$/.test(attrs) ? '/' : '';
    return `<${name}${kept.length ? ` ${kept.join(' ')}` : ''}${selfClose}>`;
  });
  if (!/^<svg\b/.test(s)) return null;
  if (!/xmlns=/.test(s.slice(0, 300))) s = s.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  if (!/viewBox=/i.test(s.slice(0, 300))) s = s.replace(/^<svg/, '<svg viewBox="0 0 600 450"');
  if (!/<(path|rect|circle|ellipse|line|polyline|polygon|text)\b/.test(s)) return null;
  return s;
}
function saveSvg(raw) {
  const s = cleanSvg(raw);
  return s ? store.saveMedia(Buffer.from(s), 'svg') : null;
}

module.exports = { productPhoto, commonsPhoto, pagePhoto, cleanSvg, saveSvg, imageKind };
