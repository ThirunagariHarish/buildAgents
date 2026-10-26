// AI renders: a realistic picture of each reinvention, from the inventor's
// photo brief. Claude cannot draw photos, so this calls an image service
// directly over HTTPS (no SDKs):
//   pollinations  free, no key (default)
//   gemini        Google's image model, needs an API key
//   openai        OpenAI's image model, needs an API key
// Keys live in data/secrets.json on the server (owner sets them in Admin)
// and are never sent to the browser.

const fs = require('fs');
const path = require('path');
const store = require('./store');
const { DATA } = require('./config');

const SECRETS = path.join(DATA, 'secrets.json');
const MAX_IMAGE = 10 * 1024 * 1024;
const PROVIDERS = {
  pollinations: { label: 'Free (Pollinations)', needsKey: false, model: 'flux' },
  gemini: { label: 'Google Gemini', needsKey: true, model: 'gemini-2.5-flash-image' },
  openai: { label: 'OpenAI', needsKey: true, model: 'gpt-image-1' },
  off: { label: 'Off', needsKey: false, model: '' },
};

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
function secrets() { return readJson(SECRETS, {}); }
function setSecret(name, value) {
  const s = secrets();
  if (value) s[name] = String(value).trim(); else delete s[name];
  fs.writeFileSync(SECRETS, JSON.stringify(s), { mode: 0o600 });
  try { fs.chmodSync(SECRETS, 0o600); } catch {}
}

/** The current choice, with what the admin page may see (never the keys). */
function config() {
  const s = store.settings().render || {};
  const provider = PROVIDERS[s.provider] ? s.provider : 'pollinations';
  const sec = secrets();
  const keys = Object.fromEntries(['gemini', 'openai'].map((p) => [p, sec[`${p}Key`] ? `ends in ${sec[`${p}Key`].slice(-4)}` : null]));
  return { provider, model: s.model || PROVIDERS[provider].model, providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, ...p })), keys };
}
function setConfig({ provider, model, key }) {
  const cur = store.settings().render || {};
  const next = { ...cur };
  if (provider && PROVIDERS[provider]) { next.provider = provider; if (provider !== cur.provider) next.model = ''; }
  if (typeof model === 'string') next.model = model.trim().slice(0, 80).replace(/[^\w.:/-]/g, '');
  store.setSettings({ render: next });
  const p = next.provider || 'pollinations';
  if (typeof key === 'string' && key.trim() && PROVIDERS[p] && PROVIDERS[p].needsKey) setSecret(`${p}Key`, key.trim().slice(0, 300));
  if (key === null && PROVIDERS[p] && PROVIDERS[p].needsKey) setSecret(`${p}Key`, null);
  return config();
}

/** One look for every render: a clean studio product photograph. */
const STYLE = 'Photorealistic studio product photograph of a new product concept as it would look manufactured and on sale. Three-quarter view, the whole product in frame and centred, soft daylight, warm light-grey seamless background, realistic materials and finishes, crisp focus, natural soft shadow. Exactly one product. No text, no labels, no logos, no watermark, no people.';
function promptFor(inv, productName) {
  const brief = inv.renderPrompt || [
    `${inv.title}: ${inv.tagline || ''}`,
    inv.howItWorks ? `How it works: ${String(inv.howItWorks).slice(0, 400)}` : '',
    inv.materials ? `Materials and finish: ${String(inv.materials).slice(0, 200)}` : '',
    (inv.changes || []).length ? `Visible features: ${inv.changes.slice(0, 4).join('; ')}` : '',
  ].filter(Boolean).join(' ');
  return `${STYLE} The product: a redesigned ${productName || 'everyday product'}. ${brief}`.replace(/\s+/g, ' ').slice(0, 1800);
}

async function fetchWith(url, opts, timeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try { return await fetch(url, { ...opts, signal: ctl.signal }); } finally { clearTimeout(t); }
}
const kindOf = (buf) => require('./media').imageKind(buf);

async function viaPollinations(prompt, model, seed) {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 900))}?width=1200&height=900&model=${encodeURIComponent(model || 'flux')}&nologo=true&private=true&enhance=false&seed=${seed}`;
  const r = await fetchWith(url, { headers: { 'User-Agent': 'Reinvent/1.0', Accept: 'image/*' }, redirect: 'follow' }, 120000);
  if (!r.ok) throw new Error(`Pollinations answered ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
async function viaGemini(prompt, model, key) {
  const r = await fetchWith(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['IMAGE'] } }),
  }, 120000);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Gemini: ${(j.error && j.error.message) || r.status}`.slice(0, 300));
  const part = ((((j.candidates || [])[0] || {}).content || {}).parts || []).find((x) => x.inlineData || x.inline_data);
  if (!part) throw new Error('Gemini returned no image');
  return Buffer.from((part.inlineData || part.inline_data).data, 'base64');
}
async function viaOpenAI(prompt, model, key) {
  const r = await fetchWith('https://api.openai.com/v1/images/generations', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, prompt, size: '1536x1024', quality: 'medium', n: 1 }),
  }, 180000);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`OpenAI: ${(j.error && j.error.message) || r.status}`.slice(0, 300));
  const d = (j.data || [])[0] || {};
  if (d.b64_json) return Buffer.from(d.b64_json, 'base64');
  if (d.url) { const x = await fetchWith(d.url, {}, 60000); return Buffer.from(await x.arrayBuffer()); }
  throw new Error('OpenAI returned no image');
}

/** Render one picture: { file, provider, model } (the file is in data/media). */
async function renderPrompt(prompt, seed = Math.floor(Math.random() * 1e9)) {
  if (process.env.RV_FAKE_RENDER_FILE) { const b = fs.readFileSync(process.env.RV_FAKE_RENDER_FILE); return { file: store.saveMedia(b, kindOf(b)), provider: 'test', model: 'test' }; }
  if (process.env.RV_FAKE_RENDER === '1') return { file: store.saveMedia(Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex'), 'jpg'), provider: 'test', model: 'test' };
  const c = config();
  if (c.provider === 'off') throw new Error('Renders are switched off.');
  const key = PROVIDERS[c.provider].needsKey ? secrets()[`${c.provider}Key`] : null;
  if (PROVIDERS[c.provider].needsKey && !key) throw new Error(`Add an API key for ${PROVIDERS[c.provider].label} in Admin.`);
  const buf = c.provider === 'gemini' ? await viaGemini(prompt, c.model, key) : c.provider === 'openai' ? await viaOpenAI(prompt, c.model, key) : await viaPollinations(prompt, c.model, seed);
  if (!buf || buf.length < 1000 || buf.length > MAX_IMAGE) throw new Error('The image service returned no usable picture.');
  const kind = kindOf(buf);
  if (!kind) throw new Error('The image service returned something that is not a picture.');
  return { file: store.saveMedia(buf, kind), provider: c.provider, model: c.model };
}
const renderInvention = (inv, productName) => renderPrompt(promptFor(inv, productName));

module.exports = { config, setConfig, renderInvention, renderPrompt, promptFor, PROVIDERS };
