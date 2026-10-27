// Link previews (title, site, picture) for links people save. The server
// fetches pages people send it, so it only ever talks to public internet
// addresses: every hop is resolved and checked, never localhost or a
// private network.

const dns = require('dns').promises;
const net = require('net');
const http = require('http');
const https = require('https');

const UA = 'Mozilla/5.0 (compatible; JotPreview/1.0; +https://jot.cashflowus.com)';

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224 || (a === 198 && (b === 18 || b === 19));
  }
  const x = ip.toLowerCase();
  if (x.startsWith('::ffff:')) return privateIp(x.slice(7));
  return x === '::' || x === '::1' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80') || x.startsWith('ff');
}
async function publicAddress(host) {
  if (net.isIP(host)) { if (privateIp(host)) throw new Error('private address'); return host; }
  if (/(^|\.)(localhost|local|internal|lan|home|corp)$/i.test(host)) throw new Error('private name');
  const list = await dns.lookup(host, { all: true });
  if (!list.length || list.some((a) => privateIp(a.address))) throw new Error('private address');
  return list[0].address;
}

/** GET a public URL, pinned to the checked address; follows up to 3 redirects. */
async function safeGet(url, { maxBytes = 800000, timeoutMs = 8000, accept = 'text/html,*/*;q=0.5' } = {}, hops = 0) {
  let u;
  try { u = new URL(url); } catch { throw new Error('bad url'); }
  if (!/^https?:$/.test(u.protocol) || (u.port && !['80', '443'].includes(u.port)) || u.username || u.password) throw new Error('unsupported url');
  const address = await publicAddress(u.hostname.replace(/^\[|\]$/g, ''));
  const lib = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request({ host: address, servername: net.isIP(u.hostname) ? undefined : u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: `${u.pathname}${u.search}`, method: 'GET', headers: { Host: u.host, 'User-Agent': UA, Accept: accept, 'Accept-Language': 'en' }, timeout: timeoutMs }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (hops >= 3) return reject(new Error('too many redirects'));
        let next; try { next = new URL(res.headers.location, u).href; } catch { return reject(new Error('bad redirect')); }
        return safeGet(next, { maxBytes, timeoutMs, accept }, hops + 1).then(resolve, reject);
      }
      if (res.statusCode >= 400) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const chunks = []; let size = 0;
      res.on('data', (c) => { size += c.length; if (size > maxBytes) { req.destroy(); resolve({ buf: Buffer.concat(chunks), type: res.headers['content-type'] || '', url: u.href, truncated: true }); } else chunks.push(c); });
      res.on('end', () => resolve({ buf: Buffer.concat(chunks), type: res.headers['content-type'] || '', url: u.href }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/\s+/g, ' ').trim();
function meta(html, names) {
  for (const n of names) {
    const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]*content=["']([^"']*)["']`, 'i');
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${n}["']`, 'i');
    const m = html.match(re1) || html.match(re2);
    if (m && m[1].trim()) return decode(m[1]);
  }
  return '';
}

/** { url, title, site, description, imageUrl } for a page, or a bare entry if it can't be read. */
async function preview(url) {
  const out = { url, title: '', site: '', description: '', imageUrl: '' };
  try { out.site = new URL(url).hostname.replace(/^www\./, ''); } catch { return out; }
  try {
    const r = await safeGet(url);
    if (!/html|xml/i.test(r.type)) return out;
    const html = r.buf.toString('utf8');
    out.title = (meta(html, ['og:title', 'twitter:title']) || decode((html.match(/<title[^>]*>([^<]{1,300})<\/title>/i) || [])[1] || '')).slice(0, 200);
    out.site = (meta(html, ['og:site_name']) || out.site).slice(0, 80);
    out.description = meta(html, ['og:description', 'twitter:description', 'description']).slice(0, 300);
    const img = meta(html, ['og:image:secure_url', 'og:image', 'twitter:image']);
    if (img) { try { out.imageUrl = new URL(img, r.url).href; } catch {} }
  } catch {}
  return out;
}

/** Picture bytes from a public URL (for link previews), or null. */
async function fetchImage(url, maxBytes = 3 * 1024 * 1024) {
  try { const r = await safeGet(url, { maxBytes, accept: 'image/*' }); return r.truncated ? null : r.buf; } catch { return null; }
}

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]]/gi;
const findLinks = (text) => [...new Set((String(text || '').match(URL_RE) || []).slice(0, 5))];

module.exports = { preview, fetchImage, findLinks, safeGet, privateIp, publicAddress };
