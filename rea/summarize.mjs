// Turns REA's raw evidence (rea/raw/<name>) into small, shareable summaries
// (rea/out/<name>): what the page showed, which services it calls, how its
// front end is built. No third-party code is copied into rea/out.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('rea');
const RAW = path.join(ROOT, 'raw');
const OUT = path.join(ROOT, 'out');
const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

// Walk any JSON and visit every [key, value, parentPath].
function walk(v, fn, p = '') {
  if (Array.isArray(v)) v.forEach((x, i) => walk(x, fn, `${p}[${i}]`));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { fn(k, x, p); walk(x, fn, p ? `${p}.${k}` : k); }
}
// A compact outline of the JSON's structure, for refining this script.
function shape(v, depth = 0, max = 5) {
  if (depth > max) return '…';
  if (Array.isArray(v)) return v.length ? [`${v.length} items`, shape(v[0], depth + 1, max)] : [];
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).slice(0, 40).map(([k, x]) => [k, shape(x, depth + 1, max)]));
  if (typeof v === 'string') return v.length > 60 ? `string(${v.length})` : v;
  return v;
}

const THIRD = [
  [/google-analytics|googletagmanager|gtag/, 'Google Analytics / Tag Manager'], [/doubleclick|googlesyndication|adservice|amazon-adsystem|criteo|taboola|outbrain|pubmatic|rubiconproject|adnxs|openx|33across|mediavine|ezoic/, 'Ads'],
  [/facebook\.net|connect\.facebook/, 'Meta pixel'], [/segment\.(io|com)|cdn\.segment/, 'Segment'], [/mixpanel/, 'Mixpanel'], [/amplitude/, 'Amplitude'], [/hotjar/, 'Hotjar'], [/clarity\.ms/, 'Microsoft Clarity'],
  [/sentry/, 'Sentry'], [/datadog|browser-intake/, 'Datadog'], [/intercom/, 'Intercom'], [/hubspot|hs-scripts|hsforms/, 'HubSpot'], [/stripe/, 'Stripe'], [/cloudflare|cf-assets|cdnjs/, 'Cloudflare'],
  [/imgix/, 'imgix images'], [/cloudinary/, 'Cloudinary images'], [/fastly/, 'Fastly'], [/akamai/, 'Akamai'], [/wp-content|wp-includes|wp-json/, 'WordPress'], [/_next\//, 'Next.js'], [/_nuxt\//, 'Nuxt'],
  [/webflow/, 'Webflow'], [/framer(usercontent)?\.com|framer\.website/, 'Framer'], [/shopify/, 'Shopify'], [/graphql/, 'GraphQL API'], [/algolia/, 'Algolia search'], [/onetrust|cookielaw|cookiebot|consensu/, 'Cookie consent'],
  [/tiktok/, 'TikTok pixel'], [/pinimg|pinterest/, 'Pinterest'], [/twitter|x\.com\/i/, 'X/Twitter'], [/linkedin|licdn/, 'LinkedIn'], [/vimeo|youtube|ytimg/, 'Video embeds'], [/recaptcha|hcaptcha|turnstile/, 'Captcha'],
  [/alicdn|alibaba/, 'Alibaba CDN'], [/launchdarkly|statsig|optimizely|growthbook/, 'Feature flags / A-B tests'], [/braze|onesignal|pushwoosh/, 'Push messaging'],
];

fs.mkdirSync(OUT, { recursive: true });
const index = [];
for (const name of fs.existsSync(RAW) ? fs.readdirSync(RAW) : []) {
  const dir = path.join(RAW, name);
  const out = path.join(OUT, name);
  fs.mkdirSync(out, { recursive: true });
  const cap = read(path.join(dir, 'capture.json')) || {};
  const analysis = read(path.join(dir, 'analysis.json'));
  const s = { name, log: fs.existsSync(path.join(dir, 'log.txt')) ? fs.readFileSync(path.join(dir, 'log.txt'), 'utf8').trim().split('\n') : [] };

  // Network events, wherever they sit in the evidence.
  const events = [];
  walk(cap, (k, v) => { if (k === 'items' && Array.isArray(v) && v.some((e) => e && e.kind && e.url)) events.push(...v); });
  const reqs = events.filter((e) => e.kind === 'request');
  const responses = events.filter((e) => e.kind === 'response');
  const hostCount = {}, typeCount = {}, api = new Set(), services = new Set();
  for (const e of reqs) {
    const u = e.url && e.url.url; if (!u) continue;
    let h = ''; try { h = new URL(u).host; } catch {}
    hostCount[h] = (hostCount[h] || 0) + 1;
    typeCount[e.resource_type] = (typeCount[e.resource_type] || 0) + 1;
    if (/^(xhr|fetch)$/.test(e.resource_type)) { try { const x = new URL(u); api.add(`${e.method} ${x.host}${x.pathname}${e.url.query_parameter_names && e.url.query_parameter_names.length ? ' ?' + e.url.query_parameter_names.join('&') : ''}`); } catch {} }
    for (const [re, label] of THIRD) if (re.test(u)) services.add(label);
  }
  s.network = {
    requests: reqs.length, responses: responses.length,
    failed: events.filter((e) => e.kind === 'request-failed').length,
    byType: typeCount,
    topHosts: Object.entries(hostCount).sort((a, b) => b[1] - a[1]).slice(0, 25),
    apiCalls: [...api].slice(0, 60),
    services: [...services].sort(),
  };
  const consoleLines = events.filter((e) => /console|page-error/.test(e.kind)).map((e) => String(e.text || e.message || '').slice(0, 200)).filter(Boolean);
  s.consoleSample = consoleLines.slice(0, 10);

  // Final URL, accessibility text and screenshot.
  let a11y = '', shot = null, finalUrl = null, title = null;
  walk(cap, (k, v) => {
    if (k === 'final_url' || (k === 'url' && typeof v === 'string' && /^https?:/.test(v) && !finalUrl)) finalUrl = finalUrl || v;
    if (/title/i.test(k) && typeof v === 'string' && !title) title = v.slice(0, 200);
    if (/accessib/i.test(k) && v && typeof v === 'object') {
      const names = [];
      walk(v, (k2, v2) => { if ((k2 === 'name' || k2 === 'text' || k2 === 'value') && typeof v2 === 'string' && v2.trim()) names.push(v2.trim()); });
      if (names.length) a11y = names.join(' | ');
    }
    if (typeof v === 'string' && v.length > 2000 && /^iVBORw0KGgo/.test(v) && !shot) shot = v;
  });
  s.finalUrl = finalUrl; s.title = title;
  if (a11y) fs.writeFileSync(path.join(out, 'page-text.txt'), a11y.slice(0, 12000));
  if (shot) fs.writeFileSync(path.join(out, 'screenshot.png'), Buffer.from(shot, 'base64'));
  s.pageTextChars = a11y.length; s.screenshot = !!shot;

  // REA's JavaScript application graph: frameworks, packages, routes, endpoints.
  if (analysis && analysis.normalized_result) {
    const n = analysis.normalized_result;
    const count = (arr, f) => { const m = {}; for (const x of arr || []) { const k = f(x); m[k] = (m[k] || 0) + 1; } return m; };
    const gnodes = (n.graph && n.graph.nodes) || [];
    const keyOf = (x) => { const k = x.identity && x.identity.key; try { const j = JSON.parse(k); return Array.isArray(j) ? j.filter((y) => typeof y === 'string').join(' ') : String(k); } catch { return String(k || ''); } };
    const sem = (n.semantic_graph && n.semantic_graph.nodes) || [];
    s.javascript = {
      statistics: n.statistics,
      appGraph: count(gnodes, (x) => x.kind),
      endpoints: gnodes.filter((x) => x.kind === 'endpoint').map(keyOf).slice(0, 80),
      storage: gnodes.filter((x) => x.kind === 'storage').map((x) => `${x.identity.namespace}: ${keyOf(x).replace(/^call:/, '')}`).slice(0, 60),
      serviceWorkers: gnodes.filter((x) => x.kind === 'service-worker').map(keyOf).slice(0, 10),
      behaviour: count(sem.filter((x) => !/^(expression|property-slot|binding|parameter|return-site|literal)$/.test(x.kind)), (x) => x.kind),
      labels: Object.entries(count(sem.filter((x) => x.label && x.label !== 'call' && /^(call-site|request|timer|task|boundary|response)$/.test(x.kind)), (x) => x.label)).sort((a, b) => b[1] - a[1]).slice(0, 60),
      
      limitations: (n.limitations || []).slice(0, 6),
    };
    fs.writeFileSync(path.join(out, 'analysis-shape.json'), JSON.stringify(shape(analysis), null, 1).slice(0, 60000));
  }
  fs.writeFileSync(path.join(out, 'capture-shape.json'), JSON.stringify(shape(cap), null, 1).slice(0, 60000));
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(s, null, 2));
  index.push(`- ${name}: ${s.network.requests} requests, ${s.network.services.join(', ') || 'no known services'}; page text ${s.pageTextChars} chars; screenshot ${s.screenshot ? 'yes' : 'no'}${s.javascript ? `; JS: ${s.javascript.statistics ? s.javascript.statistics.parsed_javascript_files : 0} files, ${s.javascript.endpoints.length} endpoints, ${s.javascript.storage.length} storage keys` : ''}`);
}
fs.writeFileSync(path.join(OUT, 'INDEX.md'), `# REA captures\n\n${index.join('\n')}\n`);
console.log(index.join('\n'));
