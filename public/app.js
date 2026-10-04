// Box frontend — vanilla JS, no build step. Modeled on the Claude mobile app.
'use strict';

const $ = (id) => document.getElementById(id);
const desktop = window.matchMedia('(min-width: 900px)');
const finePointer = window.matchMedia('(pointer: fine)');

// ---------- icons ----------
const PATHS = {
  menu: '<path d="M4 7h11M4 12h16M4 17h8"/>',
  more: '<circle cx="5.5" cy="12" r="1.8" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.8" fill="currentColor" stroke="none"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  mic: '<rect x="9" y="3" width="6" height="11.5" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>',
  arrowUp: '<path d="M12 19V5M5.5 11.5L12 5l6.5 6.5"/>',
  arrowDown: '<path d="M12 5v14M5.5 12.5L12 19l6.5-6.5"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/>',
  stopSmall: '<rect x="7.5" y="7.5" width="9" height="9" rx="1.5" fill="currentColor" stroke="none"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5"/><path d="M15.5 8.5V6.5a2.5 2.5 0 0 0-2.5-2.5H6.5A2.5 2.5 0 0 0 4 6.5V13a2.5 2.5 0 0 0 2.5 2.5h2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  share: '<path d="M12 15V3.5M7.5 8L12 3.5 16.5 8"/><path d="M5 12v6.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V12"/>',
  pencil: '<path d="M15.5 4.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/><path d="M13.5 6.5l3 3"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  chevR: '<path d="M9.5 6l6 6-6 6"/>',
  chevL: '<path d="M14.5 6l-6 6 6 6"/>',
  camera: '<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.5-2h4.4l1.5 2h1.8A2.5 2.5 0 0 1 20 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.5"/>',
  image: '<rect x="3.5" y="4" width="17" height="16" rx="2.5"/><circle cx="9" cy="9.5" r="1.8"/><path d="M20.5 15.5l-5-5L5 20"/>',
  fileUp: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 18v-6M9.5 14.5L12 12l2.5 2.5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M21.5 20a6.5 6.5 0 0 0-4-6"/>',
  chat: '<path d="M20 11.5a8 8 0 0 1-11.7 7.1L4 19.5l1-4.1A8 8 0 1 1 20 11.5z"/>',
  stack: '<path d="M6 4h12M4.5 8h15"/><rect x="3.5" y="12" width="17" height="8.5" rx="2"/>',
  pause: '<rect x="6.5" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none"/>',
  play: '<path d="M7.5 5.2v13.6a.8.8 0 0 0 1.2.7l11-6.8a.8.8 0 0 0 0-1.4l-11-6.8a.8.8 0 0 0-1.2.7z" fill="currentColor" stroke="none"/>',
  refresh: '<path d="M20 11.5a8 8 0 1 0-2.4 5.7"/><path d="M20 4.5v7h-7"/>',
  rounds: '<path d="M4.5 12a7.5 7.5 0 0 1 13.2-4.9M19.5 12a7.5 7.5 0 0 1-13.2 4.9"/><path d="M18.5 3.5v4h-4M5.5 20.5v-4h4"/>',
  alert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5.5M12 16.5v.01"/>',
  bulb: '<path d="M9.5 18h5M10.5 21h3"/><path d="M12 3a6 6 0 0 0-3.7 10.7c.6.5 1 1.2 1 2V16h5.4v-.3c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
  cube: '<path d="M20.5 7.5L12 3 3.5 7.5v9L12 21l8.5-4.5z"/><path d="M3.5 7.5L12 12l8.5-4.5M12 12v9"/>',
  rocket: '<path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2c.9-.9.9-2.2 0-3s-2.1-.9-3 0z"/><path d="M12 15l-3-3a19 19 0 0 1 9-8c1.3-.5 2.6.8 2.1 2.1A19 19 0 0 1 12 15z"/><path d="M9 12H5l2-3.5h4.5M12 15v4l3.5-2v-4.5"/>',
  inbox: '<path d="M3.5 13.5h5l1.5 2.5h4l1.5-2.5h5"/><path d="M5.5 5h13l2 8.5V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-4.5z"/>',
  list: '<path d="M8 6.5h12M8 12h12M8 17.5h12"/><path d="M4 6.5h.01M4 12h.01M4 17.5h.01"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  fork: '<circle cx="6" cy="5" r="2.2"/><circle cx="18" cy="5" r="2.2"/><circle cx="12" cy="19" r="2.2"/><path d="M6 7.2v2.3a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7.2M12 12.5v4.3"/>',
  flame: '<path d="M12 3c1 3 4 4.5 4 8.5a4 4 0 0 1-8 0c0-1.5.6-2.5 1.2-3.2.3 1 .9 1.7 1.8 2 .2-2.5-.5-4.8 1-7.3z"/>',
  tag: '<path d="M3.5 12.5V5a1.5 1.5 0 0 1 1.5-1.5h7.5l8 8-8.5 8.5z"/><path d="M8 8h.01"/>',
  archive: '<path d="M3.5 5.5h17v4h-17zM5 9.5v9a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-9M10 13.5h4"/>',
  folder: '<path d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h4.5l2 2.5h7.5a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M4.5 19.5h15"/>',
  question: '<circle cx="12" cy="12" r="8.5"/><path d="M9.5 9.5a2.5 2.5 0 0 1 5 0c0 1.8-2.5 2-2.5 4M12 17h.01"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.7 5.4 3.7 8.5s-1.2 5.9-3.7 8.5c-2.5-2.6-3.7-5.4-3.7-8.5S9.5 6.1 12 3.5z"/>',
  spark: '<path d="M12 2.5C12.8 8 16 11.2 21.5 12 16 12.8 12.8 16 12 21.5 11.2 16 8 12.8 2.5 12 8 11.2 11.2 8 12 2.5Z" fill="currentColor" stroke="none"/>',
};
function ic(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ''}</svg>`;
}
function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => { if (!el.firstElementChild) el.innerHTML = ic(el.dataset.icon); });
}

// ---------- tiny markdown ----------
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function mdInline(s) {
  return s
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\[(fact|estimate|guess)\]/gi, (_, t) => `<span class="conf ${t.toLowerCase()}" title="${{ fact: 'Verified with a source', estimate: 'Reasoned from evidence', guess: 'Intuition' }[t.toLowerCase()]}">${t.toLowerCase()}</span>`);
}
function md(src) {
  const lines = esc(src).split('\n');
  let html = '', inCode = false, list = null, para = [], table = [];
  const flushPara = () => { if (para.length) { html += `<p>${mdInline(para.join(' '))}</p>`; para = []; } };
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  const flushTable = () => {
    if (!table.length) return;
    const rows = table.filter((r) => !/^\|?\s*:?-{2,}/.test(r));
    html += '<table>' + rows.map((r, i) => '<tr>' + r.replace(/^\||\|$/g, '').split('|')
      .map((c) => `<${i ? 'td' : 'th'}>${mdInline(c.trim())}</${i ? 'td' : 'th'}>`).join('') + '</tr>').join('') + '</table>';
    table = [];
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (line.trim().startsWith('```')) { flushPara(); closeList(); flushTable(); html += inCode ? '</code></pre>' : '<pre><code>'; inCode = !inCode; continue; }
    if (inCode) { html += line + '\n'; continue; }
    if (/^\s*\|.*\|\s*$/.test(line)) { flushPara(); closeList(); table.push(line.trim()); continue; }
    flushTable();
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) { flushPara(); closeList(); const n = Math.min(h[1].length, 3); html += `<h${n}>${mdInline(h[2])}</h${n}>`; continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flushPara(); closeList(); html += '<hr>'; continue; }
    const ul = line.match(/^\s*[-*+]\s+(.*)/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
    if (ul || ol) {
      flushPara();
      const want = ul ? 'ul' : 'ol';
      if (list !== want) { closeList(); html += `<${want}>`; list = want; }
      html += `<li>${mdInline((ul || ol)[1])}</li>`;
      continue;
    }
    const bq = line.match(/^\s*&gt;\s?(.*)/);
    if (bq) { flushPara(); closeList(); html += `<blockquote>${mdInline(bq[1])}</blockquote>`; continue; }
    if (!line.trim()) { flushPara(); closeList(); continue; }
    closeList();
    para.push(line.trim());
  }
  if (inCode) html += '</code></pre>';
  flushPara(); closeList(); flushTable();
  return html;
}

// ---------- state ----------
let AGENTS = [];          // ordered: orchestrator first, then the debate order
let AGENT_MAP = {};
let ideas = [];
let current = null;       // the open idea (full object)
let route = { view: 'new' };
let thinking = null;      // { agentId, since }
let pending = [];         // composer attachments
let busy = false;
const expanded = new Set();

const settings = (() => {
  const d = { name: '', theme: 'system', rounds: 2 };
  try { return { ...d, ...JSON.parse(localStorage.getItem('box-settings') || '{}') }; } catch { return d; }
})();
function saveSettings() {
  try { localStorage.setItem('box-settings', JSON.stringify(settings)); } catch {}
}

const KIND_LABEL = { kickoff: 'Kickoff', research: 'Web research', synthesis: 'Synthesis', brief: 'Final brief', doc: 'Document', approved: 'Approved', answer: 'Answer', scorecard: 'Room score' };
let TEMPLATES = [];
let ME = null;             // the signed-in user { id, firstName, lastName, email, role, weakPassword }
const isAdminUser = () => ME?.role === 'admin';
let quickMode = null;      // null | { agentId: string|null, name: string } — next message is a quick question
let sidebarQuery = '';
let showArchived = false;
let lastActivity = null;   // latest build-crew activity line for the open project
const STATUS_LABEL = { running: 'Debating', paused: 'Paused', done: 'Concluded', error: 'Stopped', idle: 'Not started' };
const ROUND_LABEL = { 1: 'Quick pass', 2: 'Standard', 3: 'Deep', 4: 'Exhaustive' };
const SUGGESTIONS = [
  'An app that matches dog owners with neighbors for midday walks',
  'A browser extension that turns long YouTube videos into ready-to-post shorts',
  'A subscription box for home cooks built around local farms',
];

// ---------- api ----------
// Reads retry quietly through a short outage (the server restarting after a
// deploy, a dropped mobile connection) instead of failing on the first try.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(path, opts) {
  const init = opts ? { headers: { 'Content-Type': 'application/json' }, ...opts } : undefined;
  const read = !opts || !opts.method || opts.method === 'GET';
  const delays = read ? [700, 1500, 3000] : [];
  for (let attempt = 0; ; attempt++) {
    let r;
    try { r = await fetch(path, init); } catch (e) {
      if (attempt < delays.length) { await sleep(delays[attempt]); continue; }
      throw Object.assign(new Error('Box is not reachable right now.'), { status: 0, transient: true });
    }
    const data = await r.json().catch(() => ({}));
    const outage = r.status === 502 || r.status === 503 || r.status === 504;
    if (outage && attempt < delays.length) { await sleep(delays[attempt]); continue; }
    if (r.status === 401 && data.login) showLogin();
    if (!r.ok) throw Object.assign(new Error(data.error || `Request failed (${r.status})`), { status: r.status, transient: outage });
    return data;
  }
}

// ---------- helpers ----------
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), 3200);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  const ok = document.execCommand('copy'); ta.remove();
  return ok;
}
function timeOf(ts) { return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
function agentOf(id, fallbackName) {
  if (id === 'user') return { name: 'You', emoji: '🧑', color: 'var(--accent)' };
  return AGENT_MAP[id] || { name: fallbackName || id, emoji: '🤖', color: 'var(--line-strong)' };
}
function briefTitle(brief) {
  const h = (brief || '').match(/^#\s+(.+)$/m);
  return h ? h[1].replace(/[*_`]/g, '').trim() : 'Idea Brief';
}
function fileLabel(a) {
  if (a.kind === 'pdf') return 'PDF';
  const ext = (a.name.split('.').pop() || '').toUpperCase();
  return a.kind === 'image' ? 'Image' : (ext.length <= 5 ? ext : 'File');
}
function attachmentsHtml(list) {
  if (!list || !list.length) return '';
  return `<div class="att-row">${list.map((a) => a.kind === 'image'
    ? `<img class="att-img" src="/api/uploads/${a.id}" alt="${esc(a.name)}" loading="lazy" data-zoom="${a.id}">`
    : `<a class="att-file" href="/api/uploads/${a.id}" target="_blank" rel="noopener">
         <span class="att-ico">${ic('doc')}</span>
         <span style="min-width:0"><div class="att-name">${esc(a.name)}</div><div class="att-meta">${fileLabel(a)}</div></span>
       </a>`).join('')}</div>`;
}

// ---------- theme & greeting ----------
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const theme = settings.theme === 'system' ? (darkQuery.matches ? 'dark' : 'light') : settings.theme;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').setAttribute('content', theme === 'light' ? '#faf9f5' : '#151515');
}
darkQuery.addEventListener?.('change', applyTheme);
function greeting() {
  const h = new Date().getHours();
  const part = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const name = settings.name || ME?.firstName || '';
  return name ? `${part}, ${name}` : part;
}
function renderAvatar() {
  $('avatar-btn').textContent = ((settings.name || ME?.firstName || 'B').trim()[0] || 'B').toUpperCase();
}

// ---------- drawer ----------
function openDrawer() { if (!desktop.matches) document.body.classList.add('drawer-open'); }
function closeDrawer() { document.body.classList.remove('drawer-open'); }
$('menu-btn').onclick = openDrawer;
$('scrim').onclick = closeDrawer;
(() => {
  let sx = null, sy = 0;
  const main = $('main');
  main.addEventListener('touchstart', (e) => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; }, { passive: true });
  main.addEventListener('touchend', (e) => {
    if (sx === null || desktop.matches || $('layer').children.length) { sx = null; return; }
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 45) {
      if (dx > 0 && !document.body.classList.contains('drawer-open')) openDrawer();
      else if (dx < 0) closeDrawer();
    }
    sx = null;
  }, { passive: true });
})();

// App height. In a home-screen web app with the translucent status bar,
// iOS reports the viewport shorter than the screen by the status bar
// height, so size to the screen there. While the keyboard is up, size to
// the visible area so the composer stays above it.
const standalone = navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
function screenHeight() {
  const landscape = window.matchMedia('(orientation: landscape)').matches;
  const a = screen.width, b = screen.height;
  return landscape ? Math.min(a, b) : Math.max(a, b);
}
let tallestView = 0;
function fitApp() {
  const root = document.documentElement.style;
  const main = $('main');
  const vv = window.visualViewport;
  if (vv) tallestView = Math.max(tallestView, vv.height);
  const keyboardUp = vv && !desktop.matches && tallestView - vv.height > 120;
  if (keyboardUp) {
    main.style.height = `${vv.height}px`;
    main.style.top = `${vv.offsetTop}px`;
    main.style.bottom = 'auto';
    return;
  }
  main.style.height = main.style.top = main.style.bottom = '';
  if (standalone && !desktop.matches) {
    // Size to what iOS actually shows. Some iOS versions give a home-screen
    // app a view that is shorter than the screen (a black band stays under
    // it); then the home indicator sits in that band, so no bottom inset.
    const h = window.innerHeight;
    const band = screenHeight() - h;
    root.setProperty('--app-h', `${h}px`);
    root.setProperty('--sab', band >= 40 ? '0px' : 'env(safe-area-inset-bottom, 0px)');
  } else {
    root.removeProperty('--app-h');
    root.removeProperty('--sab');
  }
}
window.addEventListener('resize', fitApp);
window.addEventListener('orientationchange', () => { tallestView = 0; setTimeout(fitApp, 300); });
window.visualViewport?.addEventListener('resize', fitApp);
window.visualViewport?.addEventListener('scroll', fitApp);
fitApp();

// Layout and version report so problems on a real phone can be diagnosed
// from the deploy log: which copy of the app it runs and what screen it shows.
setTimeout(async () => {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;bottom:0;box-sizing:content-box;height:env(safe-area-inset-bottom);padding-top:env(safe-area-inset-top)';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  let cacheNames = null;
  try { cacheNames = await caches.keys(); } catch {}
  const loginEl = $('login');
  const report = {
    version: APP_VERSION, href: location.href.slice(0, 120),
    screenShown: loginEl ? ($('lg-email') ? 'sign-in with email' : 'legacy password-only sign-in') : (ME ? 'app' : 'nothing'),
    sw: !!(navigator.serviceWorker && navigator.serviceWorker.controller), caches: cacheNames,
    ua: navigator.userAgent, standalone,
    innerHeight: window.innerHeight, outerHeight: window.outerHeight,
    clientHeight: document.documentElement.clientHeight,
    screen: [screen.width, screen.height], vv: window.visualViewport && [window.visualViewport.height, window.visualViewport.offsetTop],
    safeTop: cs.paddingTop, safeBottom: cs.height,
    mainBottom: Math.round($('main').getBoundingClientRect().bottom),
    composerBottom: Math.round($('composer').getBoundingClientRect().bottom),
    appH: document.documentElement.style.getPropertyValue('--app-h') || null,
  };
  probe.remove();
  fetch('/api/diag', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) }).catch(() => {});
}, 2500);

// ---------- layers: sheets, popovers, dialogs ----------
function closeTopLayer() {
  const top = $('layer').lastElementChild;
  if (top) top._close ? top._close() : top.remove();
}
function closeAllLayers() {
  while ($('layer').lastElementChild) closeTopLayer();
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTopLayer(); });

function openSheet({ title = '', tall = false, render, onClose }) {
  const bd = document.createElement('div');
  bd.className = 'backdrop';
  bd.innerHTML = `<div class="sheet${tall ? ' tall' : ''}">
      <div class="sheet-handle"></div>
      <div class="sheet-head">
        <button class="circle-btn sheet-left" aria-label="Close">${ic('x')}</button>
        <div class="sheet-title"></div>
        <div class="head-spacer"></div>
      </div>
      <div class="sheet-body"></div>
    </div>`;
  const sheet = bd.firstElementChild;
  const body = sheet.querySelector('.sheet-body');
  const leftBtn = sheet.querySelector('.sheet-left');
  const ctl = {
    body,
    setTitle(t) { sheet.querySelector('.sheet-title').textContent = t; },
    setBack(fn) {
      leftBtn.innerHTML = fn ? ic('chevL') : ic('x');
      leftBtn.onclick = fn || ctl.close;
      leftBtn.setAttribute('aria-label', fn ? 'Back' : 'Close');
    },
    close() { bd.remove(); onClose?.(); },
  };
  bd._close = ctl.close;
  ctl.setTitle(title);
  ctl.setBack(null);
  bd.addEventListener('click', (e) => { if (e.target === bd) ctl.close(); });
  $('layer').appendChild(bd);
  render(ctl);
  return ctl;
}

function openPopover(anchor, items) {
  const bd = document.createElement('div');
  bd.className = 'backdrop clear';
  const pop = document.createElement('div');
  pop.className = 'popover';
  pop.innerHTML = items.map((it, i) => it === '-' ? '<div class="pop-sep"></div>'
    : `<button class="pop-item${it.danger ? ' danger' : ''}" data-i="${i}"><span data-icon="${it.icon}"></span>${esc(it.label)}</button>`).join('');
  hydrateIcons(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.top = `${r.bottom + 8}px`;
  pop.style.right = `${Math.max(12, window.innerWidth - r.right)}px`;
  bd.appendChild(pop);
  bd._close = () => bd.remove();
  bd.addEventListener('click', (e) => {
    const b = e.target.closest('.pop-item');
    bd.remove();
    if (b) items[Number(b.dataset.i)].run();
  });
  $('layer').appendChild(bd);
}

function dialog({ title, text = '', input = null, confirm = 'OK', danger = false }) {
  return new Promise((resolve) => {
    const bd = document.createElement('div');
    bd.className = 'backdrop dialog-wrap';
    bd.innerHTML = `<div class="dialog">
        <h3>${esc(title)}</h3>
        ${text ? `<p>${esc(text)}</p>` : ''}
        ${input !== null ? `<input type="text" maxlength="120" value="${esc(input)}">` : ''}
        <div class="dialog-actions">
          <button class="d-cancel">Cancel</button>
          <button class="d-ok ${danger ? 'danger' : 'primary'}">${esc(confirm)}</button>
        </div>
      </div>`;
    const field = bd.querySelector('input');
    const done = (val) => { bd.remove(); resolve(val); };
    bd._close = () => done(input !== null ? null : false);
    bd.querySelector('.d-cancel').onclick = () => bd._close();
    bd.querySelector('.d-ok').onclick = () => done(input !== null ? field.value.trim() : true);
    bd.addEventListener('click', (e) => { if (e.target === bd) bd._close(); });
    field?.addEventListener('keydown', (e) => { if (e.key === 'Enter') bd.querySelector('.d-ok').click(); });
    $('layer').appendChild(bd);
    if (field) setTimeout(() => { field.focus(); field.select(); }, 50);
  });
}

function openLightbox(id) {
  const bd = document.createElement('div');
  bd.className = 'lightbox';
  bd.innerHTML = `<img src="/api/uploads/${id}" alt="">`;
  bd._close = () => bd.remove();
  bd.onclick = () => bd.remove();
  $('layer').appendChild(bd);
}

// ---------- sidebar ----------
async function refreshIdeas() {
  try { ideas = await api('/api/ideas'); } catch { return; }
  ideas.sort((a, b) => b.lastActivity - a.lastActivity);
  renderSidebar();
  renderTop();
  syncBadge();
}

// ---------- notifications & home-screen badge ----------
const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
let swReg = null;
async function registerSW() {
  if (!('serviceWorker' in navigator)) return null;
  try { swReg = await navigator.serviceWorker.register('/sw.js'); } catch { swReg = null; }
  return swReg;
}
function syncBadge() {
  const n = ideas.filter((i) => placeOf(i).group === 'needs').length + (pendingUsers || 0);
  try {
    if ('setAppBadge' in navigator) (n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
    swReg?.active?.postMessage({ type: 'badge', count: n });
  } catch {}
}
function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}
/** 'unsupported' | 'homescreen' (iOS needs Add to Home Screen) | 'denied' | 'on' | 'off' */
async function pushState() {
  if (!pushSupported()) return iOS && !standalone ? 'homescreen' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = swReg || await registerSW();
  if (!reg) return 'unsupported';
  const sub = await reg.pushManager.getSubscription().catch(() => null);
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}
function keyBytes(b64u) {
  const s = (b64u + '='.repeat((4 - (b64u.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(s);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
async function enablePush() {
  if (!pushSupported()) { toast(iOS ? 'Add Box to your Home Screen first, then turn this on from the app icon.' : 'This browser can’t receive notifications.'); return false; }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast('Notifications were not allowed.'); return false; }
  const reg = swReg || await registerSW();
  if (!reg) { toast('Could not start the notification service.'); return false; }
  await navigator.serviceWorker.ready;
  try {
    const { publicKey } = await api('/api/push/key');
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
    await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON() }) });
    api('/api/push/test', { method: 'POST', body: '{}' }).catch(() => {});
    toast('Notifications on');
    return true;
  } catch (e) {
    toast(`Could not turn on notifications: ${e.message}`);
    return false;
  }
}
async function disablePush() {
  const reg = swReg || await registerSW();
  const sub = reg && await reg.pushManager.getSubscription().catch(() => null);
  if (sub) {
    api('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  toast('Notifications off');
}
function notifyBannerHtml() {
  if (!standalone || localStorage.getItem('box-notify-dismissed')) return '';
  return `<div class="notify-banner" id="notify-banner">
      <span class="next-ico">${ic('alert')}</span>
      <div><strong>Get told when something needs you</strong>Briefs, plans to approve and finished sites, as iPhone notifications with a badge on the icon.</div>
      <div class="nb-actions"><button class="wide-btn soft" data-nb="later">Later</button><button class="wide-btn accent" data-nb="on">Turn on</button></div>
    </div>`;
}
async function maybeShowNotifyBanner() {
  const slot = $('notify-slot');
  if (!slot) return;
  const state = await pushState();
  slot.innerHTML = state === 'off' ? notifyBannerHtml() : '';
  slot.onclick = async (e) => {
    const b = e.target.closest('[data-nb]');
    if (!b) return;
    if (b.dataset.nb === 'on' && await enablePush()) slot.innerHTML = '';
    if (b.dataset.nb === 'later') { try { localStorage.setItem('box-notify-dismissed', '1'); } catch {} slot.innerHTML = ''; }
  };
}
function refreshIdeasSoon() {
  clearTimeout(refreshIdeasSoon.t);
  refreshIdeasSoon.t = setTimeout(refreshIdeas, 300);
}
const STAGES = [
  ['planning', 'Plan'], ['design', 'Design'], ['building', 'Build'], ['testing', 'Test'],
  ['deploying', 'Deploy'], ['review', 'Review'], ['live', 'Live'],
];
const STAGE_LABEL = {
  planning: 'Planning', design: 'Designing', plan_review: 'Plan ready — approve it', building: 'Building', testing: 'Testing',
  deploy_setup: 'Built — deploy needs setup', deploying: 'Deploying', review: 'Site ready — review it', live: 'Live', maintenance: 'Live · maintenance',
};
// Where a stage sits on the progress bar.
const STAGE_POS = { planning: 0, design: 1, plan_review: 1, building: 2, testing: 3, deploy_setup: 4, deploying: 4, review: 5, live: 6, maintenance: 7 };
const NEEDS_YOU = new Set(['plan_review', 'deploy_setup', 'review']);
/** Where an idea sits in the sidebar, and how it's labelled. */
function placeOf(i) {
  if ((i.phase || 'idea') === 'project') {
    if (i.status === 'running') return { group: 'projects', label: `${STAGE_LABEL[i.stage] || 'Working'}…`, icon: 'cube', cls: 'project running' };
    if (NEEDS_YOU.has(i.stage)) return { group: 'needs', label: STAGE_LABEL[i.stage], icon: 'cube', cls: 'project needs' };
    if (i.status === 'error') return { group: 'projects', label: 'Stopped', icon: 'alert', cls: 'error' };
    if (i.status === 'paused') return { group: 'projects', label: `${STAGE_LABEL[i.stage] || 'Project'} · paused`, icon: 'cube', cls: 'project' };
    return { group: 'projects', label: STAGE_LABEL[i.stage] || 'Project', icon: 'cube', cls: 'project' };
  }
  if (i.status === 'running') return { group: 'ideas', label: 'Debating', icon: 'spark', cls: 'running' };
  if (i.status === 'done' && i.hasBrief) return { group: 'needs', label: 'Brief ready — review it', icon: 'bulb', cls: 'needs' };
  if (i.status === 'error') return { group: 'ideas', label: 'Stopped', icon: 'alert', cls: 'error' };
  if (i.status === 'paused') return { group: 'ideas', label: 'Paused', icon: 'bulb', cls: '' };
  return { group: 'ideas', label: 'Not started', icon: 'bulb', cls: '' };
}
function renderSidebar() {
  const list = $('idea-list');
  const q = sidebarQuery.trim().toLowerCase();
  const visible = ideas.filter((i) => (!i.archived || showArchived || (current && current.id === i.id)) && (!q || i.title.toLowerCase().includes(q) || (i.tags || []).some((t) => t.toLowerCase().includes(q))));
  const groups = { needs: [], ideas: [], projects: [], archived: [] };
  for (const i of visible) groups[i.archived ? 'archived' : placeOf(i).group].push(i);
  const item = (i) => {
    const pl = placeOf(i);
    const tags = (i.tags || []).length ? `<span class="sb-tags">${i.tags.map((t) => `<span class="sb-tag">${esc(t)}</span>`).join('')}</span>` : '';
    const dot = i.uptime && i.url ? `<i class="up-dot ${i.uptime.up === false ? 'down' : 'up'}" title="${i.uptime.up === false ? 'down' : 'up'}"></i>` : '';
    return `<button class="sb-item${current && current.id === i.id ? ' active' : ''}" data-id="${i.id}">
        <span class="sb-ico ${pl.cls}">${ic(pl.icon)}</span>
        <span class="sb-item-text"><span class="sb-item-title">${esc(i.title)}</span><span class="sb-item-sub ${pl.cls}">${dot}${esc(pl.label)}${i.score ? ` · ${i.score}/10` : ''}</span>${tags}</span>
      </button>`;
  };
  const section = (title, arr, empty) => (arr.length || empty)
    ? `<div class="sb-label">${title}${arr.length ? ` <span class="sb-count">${arr.length}</span>` : ''}</div>${arr.length ? arr.map(item).join('') : `<div class="sb-empty">${empty}</div>`}`
    : '';
  const archivedCount = ideas.filter((i) => i.archived).length;
  list.innerHTML = section('Needs you', groups.needs, '')
    + section('Ideas', groups.ideas, groups.needs.length || groups.projects.length || q ? '' : 'Your ideas will show up here.')
    + section('Projects', groups.projects, q ? '' : 'Promote an idea with a finished brief to start a project.')
    + (q && !visible.length ? `<div class="sb-empty">No titles match. <button class="sb-inline" data-search="1">Search inside ideas</button></div>` : '')
    + (archivedCount ? `<button class="sb-toggle" data-archived="1">${ic('archive')}${showArchived ? 'Hide' : 'Show'} ${archivedCount} archived</button>` : '')
    + (showArchived ? section('Archived', groups.archived, '') : '');
}
$('idea-list').addEventListener('click', (e) => {
  const b = e.target.closest('.sb-item');
  if (b) { closeDrawer(); location.hash = `#/idea/${b.dataset.id}`; return; }
  if (e.target.closest('[data-archived]')) { showArchived = !showArchived; renderSidebar(); }
  if (e.target.closest('[data-search]')) { closeDrawer(); openSearchSheet(sidebarQuery); }
});
$('sb-search').addEventListener('input', (e) => { sidebarQuery = e.target.value; renderSidebar(); });
$('sb-search').addEventListener('keydown', (e) => { if (e.key === 'Enter' && sidebarQuery.trim().length >= 2) { closeDrawer(); openSearchSheet(sidebarQuery.trim()); } });
$('nav-board').onclick = () => { closeDrawer(); openBoardSheet(); };
$('nav-people').onclick = () => { closeDrawer(); openPeopleSheet(); };

function openSearchSheet(q) {
  openSheet({
    title: 'Search',
    tall: true,
    render(s) {
      s.body.innerHTML = `<label class="field"><span>Across ideas, briefs, documents and debates</span><input id="search-q" type="search" value="${esc(q)}" placeholder="Search…"></label><div id="search-results"><p class="sheet-intro">Searching…</p></div>`;
      const run = async () => {
        const v = $('search-q').value.trim();
        if (v.length < 2) { $('search-results').innerHTML = '<p class="sheet-intro">Type at least two characters.</p>'; return; }
        let hits = [];
        try { hits = await api(`/api/search?q=${encodeURIComponent(v)}`); } catch { hits = []; }
        $('search-results').innerHTML = hits.length ? hits.map((h) => `<button class="row" data-id="${h.ideaId}" data-doc="${esc(h.docKey || '')}">${ic(h.where === 'brief' ? 'doc' : h.docKey ? 'stack' : 'chat')}<span class="row-label">${esc(h.ideaTitle)}<span class="row-sub"><b>${esc(h.where)}</b> · …${esc(h.snippet || '')}…</span></span><span class="row-chev">${ic('chevR')}</span></button>`).join('') : '<p class="sheet-intro">Nothing found.</p>';
      };
      run();
      let t;
      $('search-q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 300); });
      s.body.onclick = async (e) => {
        const b = e.target.closest('[data-id]');
        if (!b) return;
        s.close();
        location.hash = `#/idea/${b.dataset.id}`;
        await openIdea(b.dataset.id);
        if (b.dataset.doc) openDocViewer(b.dataset.doc);
      };
    },
  });
}

/** All projects by stage, like a kanban board. */
function openBoardSheet() {
  openSheet({
    title: 'Projects board',
    tall: true,
    render(s) {
      const cols = [
        ['Planning', (i) => ['planning', 'design'].includes(i.stage)], ['Needs you', (i) => NEEDS_YOU.has(i.stage)],
        ['Building & testing', (i) => ['building', 'testing', 'deploying'].includes(i.stage)], ['Live', (i) => ['live', 'maintenance'].includes(i.stage)],
      ];
      const projects = ideas.filter((i) => i.phase === 'project' && !i.archived);
      s.body.innerHTML = projects.length ? `<div class="board">${cols.map(([title, f]) => {
        const items = projects.filter(f);
        return `<div class="board-col"><div class="board-head">${title} <span class="sb-count">${items.length}</span></div>${items.map((i) => `<button class="board-card" data-id="${i.id}">
            <span class="board-title">${esc(i.title)}</span>
            <span class="board-sub">${esc(STAGE_LABEL[i.stage] || i.stage)}${i.tasks ? ` · ${i.tasks.done}/${i.tasks.total} tasks` : ''}${i.status === 'running' ? ' · working…' : ''}</span>
            ${i.tasks?.total ? `<span class="tb-bar"><i style="width:${Math.round((i.tasks.done / i.tasks.total) * 100)}%"></i></span>` : ''}
          </button>`).join('') || '<div class="sb-empty">—</div>'}</div>`;
      }).join('')}</div>` : '<p class="sheet-intro">No projects yet. Promote an idea with a finished brief.</p>';
      s.body.onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) { s.close(); location.hash = `#/idea/${b.dataset.id}`; } };
    },
  });
}

/** Every link the researchers cited, across ideas. */
function openSourcesSheet() {
  openSheet({
    title: 'Source library',
    tall: true,
    render(s) {
      s.body.innerHTML = '<p class="sheet-intro">Loading…</p>';
      api('/api/sources').then((list) => {
        if (!list.length) { s.body.innerHTML = '<p class="sheet-intro">No sources yet. The researchers cite links in every debate that includes web research.</p>'; return; }
        const byIdea = {};
        for (const x of list) (byIdea[x.ideaId] = byIdea[x.ideaId] || { title: x.ideaTitle, items: [] }).items.push(x);
        s.body.innerHTML = `<label class="field"><span>${list.length} sources</span><input id="src-q" type="search" placeholder="Filter by title or site"></label><div id="src-list"></div>`;
        const draw = () => {
          const q = ($('src-q').value || '').toLowerCase();
          $('src-list').innerHTML = Object.entries(byIdea).map(([id, g]) => {
            const items = g.items.filter((x) => !q || x.title.toLowerCase().includes(q) || x.host.includes(q));
            return items.length ? `<div class="sb-label" style="padding:12px 6px 6px">${esc(g.title)}</div>${items.map((x) => `<a class="row" href="${esc(x.url)}" target="_blank" rel="noopener">${ic('link')}<span class="row-label">${esc(x.title)}<span class="row-sub">${esc(x.host)} · ${esc(agentOf(x.agentId).name)}</span></span></a>`).join('')}` : '';
          }).join('') || '<p class="sheet-intro">No matches.</p>';
        };
        draw();
        $('src-q').addEventListener('input', draw);
      }).catch((e) => { s.body.innerHTML = `<p class="sheet-intro">${esc(e.message)}</p>`; });
    },
  });
}
function goNew() { closeDrawer(); if (location.hash === '#/' || !location.hash) showNew(); else location.hash = '#/'; }
$('nav-new').onclick = goNew;
$('sb-new').onclick = goNew;
$('nav-agents').onclick = () => { closeDrawer(); openAgentsSheet(); };
$('nav-briefs').onclick = () => { closeDrawer(); openBriefsSheet(); };
$('avatar-btn').onclick = () => { closeDrawer(); openSettingsSheet(); };

// ---------- top bar ----------
function renderTop() {
  const others = ideas.some((i) => i.status === 'running' && (!current || i.id !== current.id));
  $('menu-dot').classList.toggle('hidden', !others);
  if (route.view === 'new' || !current) {
    document.body.classList.remove('mode-project');
    renderStageBar();
    $('title-text').textContent = 'New idea';
    $('subtitle-text').textContent = `${Math.max(AGENTS.length - 1, 0)} specialists on call · ${settings.rounds} ${settings.rounds === 1 ? 'round' : 'rounds'}`;
    return;
  }
  $('title-text').textContent = current.title;
  document.body.classList.toggle('mode-project', isProject());
  renderStageBar();
  if (isProject()) {
    $('subtitle-text').textContent = current.status === 'running' && thinking?.label
      ? `${thinking.label}…`
      : `Project · ${STAGE_LABEL[current.project.stage] || ''}`;
    document.title = `${current.title} · Box`;
    return;
  }
  let sub = `Round ${Math.max(current.round, 1)}${current.round <= current.maxRounds ? ` of ${current.maxRounds}` : ''}`;
  if (current.status === 'running' && thinking) sub = thinking.label ? `${thinking.label}…` : `${agentOf(thinking.agentId).name} is thinking…`;
  else sub += ` · ${STATUS_LABEL[current.status] || current.status}`;
  $('subtitle-text').textContent = sub;
  document.title = `${current.title} · Box`;
}
function isProject() { return !!(current && current.phase === 'project' && current.project); }
function canPromote() { return !!(current && !isProject() && current.status === 'done' && current.brief); }
function canApprove() { return !!(isProject() && current.project.stage === 'plan_review' && current.status !== 'running'); }
function canComplete() { return !!(isProject() && current.project.stage === 'review' && current.status !== 'running'); }
function canDeploy() { return !!(isProject() && current.project.stage === 'deploy_setup' && current.status !== 'running'); }
function canResumeBuild() {
  return !!(isProject() && (current.status === 'paused' || current.status === 'error') && ['building', 'testing', 'deploying'].includes(current.project.stage));
}
function projectDocs() { return isProject() ? Object.values(current.project.docs || {}) : []; }
function renderStageBar() {
  const bar = $('stage-bar');
  if (!isProject()) { bar.classList.add('hidden'); return; }
  const at = STAGE_POS[current.project.stage] ?? 0;
  bar.classList.remove('hidden');
  bar.innerHTML = STAGES.map(([, label], n) =>
    `<span class="stage ${n < at ? 'done' : n === at ? 'now' : ''}">${n < at ? ic('check') : '<i></i>'}${label}</span>`).join('<span class="stage-sep"></span>');
}
async function promoteCurrent() {
  if (!canPromote()) return;
  const ok = await dialog({
    title: 'Promote to project?',
    text: 'The brief becomes the project spec. The build crew will plan, design, build, test and deploy it, and you’ll review the plan and the finished site. The debate stays in the project’s history.',
    confirm: 'Promote',
  });
  if (!ok) return;
  try {
    await api(`/api/ideas/${current.id}/promote`, { method: 'POST', body: '{}' });
    await openIdea(current.id, { silent: true });
    refreshIdeasSoon();
    toast('Promoted — the planning crew is on it');
  } catch (e) { toast(e.message); }
}
async function approveCurrent() {
  if (!canApprove()) return;
  const ok = await dialog({
    title: 'Approve the plan?',
    text: 'The requirements, architecture, data model and design direction become the spec. The build crew takes it from here. To change anything first, reply below instead.',
    confirm: 'Approve',
  });
  if (!ok) return;
  try {
    await api(`/api/ideas/${current.id}/approve`, { method: 'POST', body: '{}' });
    await openIdea(current.id, { silent: true });
    refreshIdeasSoon();
    toast('Plan approved — the build crew is on it');
  } catch (e) { toast(e.message); }
}
async function completeCurrent() {
  if (!canComplete()) return;
  const ok = await dialog({
    title: 'Mark complete?',
    text: 'The project moves to maintenance. It stays live; anything you write here later becomes a fix or a feature the crew builds, tests and redeploys.',
    confirm: 'Mark complete',
  });
  if (!ok) return;
  try {
    await api(`/api/ideas/${current.id}/complete`, { method: 'POST', body: '{}' });
    await openIdea(current.id, { silent: true });
    refreshIdeasSoon();
    toast('Marked complete');
  } catch (e) { toast(e.message); }
}
function openSite() {
  if (current?.project?.url) window.open(current.project.url, '_blank', 'noopener');
}
$('top-title').onclick = () => (route.view === 'idea' && current ? openRoomSheet() : openAgentsSheet());
$('more-btn').onclick = () => {
  if (route.view !== 'idea' || !current) {
    openPopover($('more-btn'), [
      { icon: 'users', label: 'Agents', run: openAgentsSheet },
      { icon: 'stack', label: 'Idea Briefs', run: openBriefsSheet },
      '-',
      { icon: 'pencil', label: 'Settings', run: openSettingsSheet },
    ]);
    return;
  }
  const s = current.status;
  const items = [
    { icon: 'share', label: 'Share', run: shareIdea },
    { icon: 'pencil', label: 'Rename', run: renameCurrent },
    { icon: 'users', label: 'Room & agents', run: openRoomSheet },
  ];
  if (canPromote()) items.unshift({ icon: 'rocket', label: 'Promote to project', run: promoteCurrent });
  if (current.brief) items.push({ icon: 'doc', label: 'Idea Brief', run: openBriefViewer });
  items.push({ icon: 'tag', label: 'Tags', run: editTags });
  items.push({ icon: 'archive', label: current.archived ? 'Unarchive' : 'Archive', run: toggleArchive });
  if (isProject()) {
    if (current.project.slug && current.project.tasks?.length) items.push({ icon: 'folder', label: 'Browse the code', run: openFilesSheet });
    if (current.project.deploy) items.push({ icon: 'list', label: 'Environment variables', run: openEnvSheet });
    if (current.project.url) {
      items.push({ icon: 'doc', label: 'Logs', run: openLogsSheet });
      items.push({ icon: current.project.offline ? 'play' : 'pause', label: current.project.offline ? 'Bring the site back online' : 'Take the site offline', run: toggleOffline });
    }
    items.push({ icon: 'globe', label: current.project.customDomain ? `Custom domain: ${current.project.customDomain}` : 'Custom domain…', run: setCustomDomain });
    if (canApprove()) items.unshift({ icon: 'check', label: 'Approve plan', run: approveCurrent });
    if (canComplete()) items.unshift({ icon: 'check', label: 'Mark complete', run: completeCurrent });
    if (current.project.url) items.unshift({ icon: 'globe', label: 'Open the site', run: openSite });
    if (projectDocs().length) items.push({ icon: 'stack', label: 'Project documents', run: openDocsSheet });
    if (current.project.prototype) items.push({ icon: 'image', label: 'Prototype', run: openPrototype });
    if (current.project.tasks?.length) items.push({ icon: 'list', label: 'Task board', run: openTasksSheet });
    if (s === 'running') items.push({ icon: 'pause', label: 'Pause the crew', run: pauseCurrent });
    else if ((s === 'paused' || s === 'error') && ['planning', 'design'].includes(current.project.stage)) items.push({ icon: 'play', label: 'Resume planning', run: runCurrent });
    else if (canResumeBuild()) items.push({ icon: 'play', label: 'Resume the crew', run: runCurrent });
    else if (canDeploy()) items.push({ icon: 'rocket', label: 'Deploy', run: runCurrent });
    items.push('-', { icon: 'trash', label: 'Delete', danger: true, run: deleteCurrent });
    openPopover($('more-btn'), items);
    return;
  }
  const started = current.messages.some((m) => m.kind === 'kickoff');
  if (s === 'running') items.push({ icon: 'pause', label: 'Pause debate', run: pauseCurrent });
  else if (s === 'done') items.push({ icon: 'refresh', label: 'Run another round', run: runCurrent });
  else items.push({ icon: 'play', label: s === 'idle' ? 'Start debate' : 'Resume debate', run: runCurrent });
  if (started && s !== 'running') {
    items.push({ icon: 'question', label: 'Ask a quick question', run: () => startQuick(null) });
    items.push({ icon: 'flame', label: 'Devil’s advocate round', run: devilRound });
    items.push({ icon: 'fork', label: 'Fork this idea', run: forkCurrent });
    items.push({ icon: 'rounds', label: 'Replay the debate', run: openReplaySheet });
    if (ideas.filter((i) => i.id !== current.id && !i.archived).length) {
      items.push({ icon: 'stack', label: 'Compare with another idea', run: () => pickIdeaSheet('compare') });
      items.push({ icon: 'plus', label: 'Merge with another idea', run: () => pickIdeaSheet('merge') });
    }
    if (current.brief) items.push({ icon: 'search', label: current.watch ? 'Stop weekly trend watch' : 'Watch trends weekly', run: toggleWatch });
  }
  items.push('-', { icon: 'trash', label: 'Delete', danger: true, run: deleteCurrent });
  openPopover($('more-btn'), items);
};

async function toggleWatch() {
  if (!current) return;
  const on = !current.watch;
  try {
    await api(`/api/ideas/${current.id}`, { method: 'PATCH', body: JSON.stringify({ watch: on }) });
    current.watch = on;
    if (on) {
      const now = await dialog({ title: 'Trend watch is on', text: 'Every Monday the Market Researcher searches for news that matters to this idea and posts it here. Run the first check now?', confirm: 'Check now' });
      if (now) { await api(`/api/ideas/${current.id}/watch`, { method: 'POST', body: '{}' }); current.status = 'running'; renderTop(); renderThread(true); renderDock(); }
    } else toast('Trend watch off');
  } catch (e) { toast(e.message); }
}
function pickIdeaSheet(mode) {
  openSheet({
    title: mode === 'compare' ? 'Compare with…' : 'Merge with…',
    tall: true,
    render(s) {
      const others = ideas.filter((i) => i.id !== current.id && !i.archived);
      s.body.innerHTML = `<p class="sheet-intro">${mode === 'compare' ? 'The Orchestrator writes a side-by-side verdict, saved on both ideas.' : 'A new idea is created from both and the room debates the combination. The originals stay as they are.'}</p>` +
        others.map((i) => `<button class="row" data-id="${i.id}">${ic(i.phase === 'project' ? 'cube' : 'bulb')}<span class="row-label">${esc(i.title)}<span class="row-sub">${esc(placeOf(i).label)}${i.score ? ` · ${i.score}/10` : ''}</span></span><span class="row-chev">${ic('chevR')}</span></button>`).join('');
      s.body.onclick = async (e) => {
        const b = e.target.closest('[data-id]');
        if (!b) return;
        b.querySelector('.row-chev').textContent = '…';
        try {
          if (mode === 'compare') {
            await api('/api/compare', { method: 'POST', body: JSON.stringify({ a: current.id, b: b.dataset.id }) });
            s.close(); await openIdea(current.id, { silent: true }); openExtraViewer(`compare_${b.dataset.id}`);
          } else {
            const idea = await api('/api/merge', { method: 'POST', body: JSON.stringify({ a: current.id, b: b.dataset.id }) });
            s.close(); toast('Merged — the room is debating it'); location.hash = `#/idea/${idea.id}`;
          }
        } catch (err) { toast(err.message); }
      };
    },
  });
}
/** Step through the debate one message at a time. */
function openReplaySheet() {
  if (!current) return;
  const msgs = current.messages.filter((m) => !['promoted', 'approved', 'doc', 'task', 'system', 'deployed', 'completed', 'scorecard'].includes(m.kind));
  if (!msgs.length) return;
  let n = 1;
  openSheet({
    title: 'Replay',
    tall: true,
    render(s) {
      const draw = () => {
        const m = msgs[n - 1];
        const a = agentOf(m.agentId, m.agentName);
        s.body.innerHTML = `
          <div class="replay-bar"><input type="range" min="1" max="${msgs.length}" value="${n}" id="replay-range"><span>${n} / ${msgs.length}</span></div>
          <div class="btn-pair" style="margin:4px 0 14px"><button class="wide-btn soft" data-step="-1" ${n === 1 ? 'disabled' : ''}>Previous</button><button class="wide-btn soft" data-step="1" ${n === msgs.length ? 'disabled' : ''}>Next</button></div>
          <div class="a-msg" style="--agent-color:${esc(a.color)}"><div class="a-head"><span class="a-avatar">${a.emoji}</span><span class="a-name">${esc(a.name)}</span><span class="a-kind">${esc(KIND_LABEL[m.kind] || `Round ${m.round}`)}</span></div>
            <div class="a-body md">${md(m.content)}</div></div>`;
        $('replay-range').addEventListener('input', (e) => { n = Number(e.target.value); draw(); });
      };
      draw();
      s.body.onclick = (e) => { const b = e.target.closest('[data-step]'); if (b) { n = Math.max(1, Math.min(msgs.length, n + Number(b.dataset.step))); draw(); } };
    },
  });
}
async function devilRound() {
  if (!current) return;
  const ok = await dialog({ title: 'Devil’s advocate round?', text: 'Every agent in the room argues against the idea for one round, then the Orchestrator ranks the attacks and rewrites the brief with what survived. The room re-scores it afterwards.', confirm: 'Run it' });
  if (!ok) return;
  try {
    await api(`/api/ideas/${current.id}/devil`, { method: 'POST', body: '{}' });
    current.status = 'running';
    renderTop(); renderThread(true); renderDock();
  } catch (e) { toast(e.message); }
}
async function forkCurrent(messageId = null) {
  if (!current) return;
  const title = await dialog({ title: 'Fork this idea', text: 'A copy with the debate so far, so you can take it in a different direction. The original stays as it is.', input: `${current.title} (fork)`, confirm: 'Fork' });
  if (!title) return;
  try {
    const fork = await api(`/api/ideas/${current.id}/fork`, { method: 'POST', body: JSON.stringify({ title, messageId }) });
    toast('Forked');
    location.hash = `#/idea/${fork.id}`;
  } catch (e) { toast(e.message); }
}
async function editTags() {
  if (!current) return;
  const v = await dialog({ title: 'Tags', text: 'Comma-separated. Tags show in the sidebar and can be searched.', input: (current.tags || []).join(', '), confirm: 'Save' });
  if (v === null) return;
  const tags = v.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 8);
  try {
    await api(`/api/ideas/${current.id}`, { method: 'PATCH', body: JSON.stringify({ tags }) });
    current.tags = tags;
    refreshIdeasSoon();
  } catch (e) { toast(e.message); }
}
async function toggleArchive() {
  if (!current) return;
  try {
    const r = await api(`/api/ideas/${current.id}`, { method: 'PATCH', body: JSON.stringify({ archived: !current.archived }) });
    current.archived = r.archived;
    toast(r.archived ? 'Archived' : 'Restored');
    refreshIdeasSoon();
  } catch (e) { toast(e.message); }
}

// ---------- routing ----------
function parseHash() {
  const m = location.hash.match(/^#\/idea\/([a-f0-9]+)/);
  if (m) return { view: 'idea', id: m[1] };
  if (/^#\/people/.test(location.hash)) return { view: 'people' };
  return { view: 'new' };
}
async function onRoute() {
  closeAllLayers();
  closeDrawer();
  route = parseHash();
  if (route.view === 'idea') await openIdea(route.id);
  else if (route.view === 'people') { showNew(); if (isAdminUser()) openPeopleSheet(); }
  else showNew();
}
window.addEventListener('hashchange', onRoute);

function showNew() {
  route = { view: 'new' };
  current = null;
  thinking = null;
  document.title = 'Box';
  $('greeting').textContent = greeting();
  $('welcome').classList.remove('hidden');
  $('messages').innerHTML = '';
  $('suggestions').innerHTML = SUGGESTIONS.map((s) => `<button class="suggestion">${esc(s)}</button>`).join('');
  renderTemplates();
  renderHomeStrip();
  renderTop();
  renderSidebar();
  renderDock();
  maybeShowNotifyBanner();
}
let pickedTemplate = null;
function renderTemplates() {
  const el = $('templates');
  if (!TEMPLATES.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="tpl-label">What kind of idea?</div><div class="tpl-row">${TEMPLATES.map((t) => `<button class="tpl${pickedTemplate === t.id ? ' on' : ''}" data-tpl="${t.id}" title="${esc(t.hint)}">${t.emoji} ${esc(t.name)}</button>`).join('')}</div>`;
}
$('templates').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tpl]');
  if (!b) return;
  pickedTemplate = pickedTemplate === b.dataset.tpl ? null : b.dataset.tpl;
  renderTemplates();
});
function renderHomeStrip() {
  const needs = ideas.filter((i) => !i.archived && placeOf(i).group === 'needs').length;
  const running = ideas.filter((i) => i.status === 'running').length;
  const live = ideas.filter((i) => i.url).length;
  const el = $('home-strip');
  const pend = pendingUsers;
  const admin = isAdminUser();
  if (!needs && !running && !live && !pend && !admin) { el.innerHTML = ''; return; }
  // Administrators always see the People control panel here, even when nothing is waiting.
  el.innerHTML = `<div class="strip">
      ${pend ? `<button class="strip-item needs" data-strip="people"><b>${pend}</b>${pend === 1 ? 'access request' : 'access requests'}</button>`
        : admin ? `<button class="strip-item" data-strip="people"><b>${memberCount || 1}</b>${(memberCount || 1) === 1 ? 'person · manage access' : 'people · manage access'}</button>` : ''}
      ${needs ? `<button class="strip-item needs" data-strip="needs"><b>${needs}</b>${needs === 1 ? 'needs you' : 'need you'}</button>` : ''}
      ${running ? `<button class="strip-item" data-strip="running"><b>${running}</b>working</button>` : ''}
      ${live ? `<button class="strip-item live" data-strip="live"><b>${live}</b>live</button>` : ''}
    </div>`;
}
$('home-strip').addEventListener('click', (e) => {
  const b = e.target.closest('[data-strip]');
  if (!b) return;
  if (b.dataset.strip === 'live') return openBoardSheet();
  if (b.dataset.strip === 'people') return openPeopleSheet();
  openDrawer();
});
let pendingUsers = 0;
let memberCount = 0;
async function refreshPending() {
  if (!isAdminUser()) return;
  // The People control panel is an administrator's: show it in the sidebar.
  $('nav-people').classList.remove('hidden');
  try {
    const o = await api('/api/overview');
    pendingUsers = o.pendingUsers || 0; memberCount = o.members || 0;
    const c = $('nav-people-count'); c.textContent = pendingUsers || ''; c.classList.toggle('hidden', !pendingUsers);
    if (route.view === 'new') renderHomeStrip();
    syncBadge();
  } catch {}
}
$('suggestions').addEventListener('click', (e) => {
  const b = e.target.closest('.suggestion');
  if (!b) return;
  $('input').value = b.textContent;
  autosize();
  updateSendState();
  $('input').focus();
});

async function openIdea(id, { silent = false } = {}) {
  // Switch to the idea at once from what the sidebar already knows, so the
  // tap feels instant; the full thread fills in when it arrives.
  const known = ideas.find((i) => i.id === id);
  if (known && (!current || current.id !== id)) {
    $('welcome').classList.add('hidden');
    $('title-text').textContent = known.title || 'Idea';
    $('subtitle-text').textContent = 'Opening…';
    $('messages').innerHTML = '';
    document.querySelectorAll('.sb-item').forEach((el) => el.classList.toggle('active', el.dataset.id === id));
  }
  let idea;
  try { idea = await api(`/api/ideas/${id}`); } catch (e) {
    // Only a missing idea sends you home. A blip in the connection keeps you
    // where you are and tries again shortly.
    if (e.status === 404 || e.status === 403) {
      if (!silent) toast('That idea no longer exists.');
      location.hash = '#/';
      return;
    }
    if (!silent) toast(e.transient || e.status === 0 ? 'Reconnecting to Box…' : e.message);
    if (parseHash().id === id) setTimeout(() => { if (parseHash().id === id && (!current || current.id !== id)) openIdea(id, { silent: true }); }, 4000);
    return;
  }
  const switching = !current || current.id !== idea.id;
  current = idea;
  if (switching) expanded.clear();
  thinking = idea.speaker ? { agentId: idea.speaker.agentId, label: idea.speaker.label, since: Date.now() - idea.speaker.elapsedMs } : null;
  $('welcome').classList.add('hidden');
  renderTop();
  renderSidebar();
  renderThread(switching);
  renderDock();
}

// ---------- thread ----------
function nearBottom() {
  const t = $('thread');
  return t.scrollHeight - t.scrollTop - t.clientHeight < 140;
}
function scrollToBottom(smooth) {
  const t = $('thread');
  t.scrollTo({ top: t.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}
$('thread').addEventListener('scroll', () => {
  const t = $('thread');
  $('jump-btn').classList.toggle('hidden', t.scrollHeight - t.scrollTop - t.clientHeight < 400);
}, { passive: true });
$('jump-btn').onclick = () => scrollToBottom(true);

function agentMsgHtml(m) {
  const a = agentOf(m.agentId, m.agentName);
  const open = expanded.has(m.id);
  const label = m.kind === 'doc' ? (m.docTitle || 'Document') : m.kind === 'task' ? `${m.taskId}` : (KIND_LABEL[m.kind] || '');
  const meta = [timeOf(m.ts), m.durationMs ? `${Math.round(m.durationMs / 1000)}s` : '', m.commit ? `commit ${m.commit}` : ''].filter(Boolean).join(' · ');
  const compact = m.kind === 'brief' || m.kind === 'doc';
  const moreLabel = m.kind === 'task' ? 'report' : 'argument';
  let extra = '';
  if (m.kind === 'task') {
    extra = `<div class="task-line ${esc(m.taskStatus || 'done')}">${ic(m.taskStatus === 'blocked' ? 'alert' : 'check')}<span>${esc(m.taskTitle || '')}</span><em>${m.taskStatus === 'blocked' ? 'blocked' : 'done'}</em></div>`;
  }
  if (m.kind === 'doc' && m.verdict) {
    extra = `<div class="task-line ${m.verdict === 'pass' ? 'done' : 'blocked'}">${ic(m.verdict === 'pass' ? 'check' : 'alert')}<span>Verdict</span><em>${m.verdict === 'pass' ? 'pass' : 'needs fixes'}</em></div>`;
  }
  if (m.kind === 'doc') {
    const d = current?.project?.docs?.[m.docKey];
    extra += `<button class="brief-card doc-card" data-doc="${esc(m.docKey)}">
        <span class="brief-ico">${ic('doc')}</span>
        <span style="min-width:0"><div class="brief-title">${esc(m.docTitle)}</div><div class="brief-sub">${d && d.version > 1 ? `Version ${d.version} · ` : ''}Tap to read</div></span>
      </button>`;
    for (const proto of (m.attachments || []).filter((x) => x.kind === 'html')) {
      extra += `<button class="brief-card proto-card" data-proto="${esc(proto.id)}">
        <span class="brief-ico">${ic('image')}</span>
        <span style="min-width:0"><div class="brief-title">Clickable prototype${proto.direction ? ` ${esc(proto.direction)}` : ''}</div><div class="brief-sub">Tap to try it on your phone</div></span>
      </button>`;
    }
    const shots = (m.attachments || []).filter((x) => x.kind === 'image');
    if (shots.length) extra += `<div class="shots">${shots.map((x) => `<img class="shot" src="/api/uploads/${x.id}" alt="${esc(x.name)}" loading="lazy" data-zoom="${x.id}">`).join('')}</div>`;
  }
  return `<div class="a-msg" style="--agent-color:${esc(a.color)}" data-mid="${m.id}" data-kind="${esc(m.kind)}">
      <div class="a-head">
        <span class="a-avatar" data-agent="${esc(m.agentId)}">${a.emoji}</span>
        <span class="a-name" data-agent="${esc(m.agentId)}">${esc(a.name)}</span>
        ${label ? `<span class="a-kind">${esc(label)}</span>` : ''}
      </div>
      <div class="a-body">${mdInline(esc(m.summary))}</div>
      ${extra}
      ${compact ? '' : `
        <button class="a-more${open ? ' open' : ''}" data-toggle="${m.id}">${open ? 'Hide' : 'Full'} ${moreLabel} <span data-icon="chevR">${ic('chevR')}</span></button>
        ${open ? `<div class="a-full a-body md">${md(m.content)}</div>` : ''}`}
      <div class="a-actions">
        <button class="icon-btn" data-copy="${m.id}" aria-label="Copy">${ic('copy')}</button>
        <span class="a-meta">${esc(meta)}</span>
      </div>
    </div>`;
}

function debateHtml(messages) {
  let html = `<div class="u-msg">${attachmentsHtml(current.attachments)}<div class="u-bubble">${esc(current.text)}</div></div>`;
  let lastRound = null;
  if (current.forkedFrom) html += `<div class="system-mark">${ic('fork')}Forked from “${esc(current.forkedFrom.title)}”</div>`;
  for (const m of messages) {
    if (m.kind === 'user') {
      html += `<div class="u-msg"><div class="u-label">You · ${m.quick ? (m.toAgent ? `quick question for ${esc(agentOf(m.toAgent).name)}` : 'quick question') : 'to the room'}</div>${attachmentsHtml(m.attachments)}<div class="u-bubble">${esc(m.content)}</div></div>`;
      continue;
    }
    if (m.kind === 'scorecard') {
      const sc = m.scorecard || {};
      html += `<div class="score-card">
          <div class="score-big"><span class="score-num">${esc(String(sc.avg ?? ''))}</span><span class="score-of">/ 10</span><span class="score-label">Room score · round ${m.round}</span></div>
          ${(sc.votes || []).map((v) => { const a = agentOf(v.agentId); return `<div class="score-row" title="${esc(v.why)}"><span class="score-who">${a.emoji} ${esc(a.name)}</span><span class="score-bar"><i style="width:${v.score * 10}%;background:${esc(a.color)}"></i></span><span class="score-val">${v.score}</span></div>`; }).join('')}
          <button class="a-more${expanded.has(m.id) ? ' open' : ''}" data-toggle="${m.id}">${expanded.has(m.id) ? 'Hide' : 'Show'} reasons ${ic('chevR')}</button>
          ${expanded.has(m.id) ? `<div class="a-full a-body md">${md(m.content)}</div>` : ''}
        </div>`;
      continue;
    }
    if (m.round !== lastRound && m.kind !== 'answer') {
      lastRound = m.round;
      html += `<div class="round-mark">Round ${m.round}</div>`;
    }
    html += agentMsgHtml(m);
    if (m.kind === 'kickoff' && current.roster?.length) {
      html += `<div class="roster-card"><span class="roster-label">${ic('users')}In the room</span>${current.roster.map((id) => {
        const a = agentOf(id);
        return `<button class="roster-chip" data-agent="${esc(id)}" style="--agent-color:${esc(a.color)}">${a.emoji} ${esc(a.name)}</button>`;
      }).join('')}</div>`;
    }
    if (m.kind === 'brief') {
      html += `<button class="brief-card" data-brief="1">
          <span class="brief-ico">${ic('doc')}</span>
          <span style="min-width:0"><div class="brief-title">${esc(briefTitle(m.content))}</div><div class="brief-sub">Idea Brief · Tap to open</div></span>
        </button>`;
    }
  }
  return html;
}

function projectHtml() {
  const p = current.project;
  const cut = current.messages.findIndex((m) => m.kind === 'promoted');
  const debate = cut < 0 ? current.messages : current.messages.slice(0, cut);
  const after = cut < 0 ? [] : current.messages.slice(cut + 1);
  const open = expanded.has('debate');
  const when = new Date(p.promotedAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  let html = `<div class="proj-card">
      <div class="proj-top"><span class="proj-badge">${ic('cube')}Project</span><span class="proj-stage">${esc(STAGE_LABEL[p.stage] || p.stage)}</span></div>
      <div class="proj-title">${esc(current.brief ? briefTitle(current.brief) : current.title)}</div>
      <div class="proj-meta">Promoted ${esc(when)} · ${p.url ? 'live at' : 'will go live at'} <strong>${esc(p.slug)}.cashflowus.com</strong></div>
      ${current.brief ? `<button class="proj-link" data-brief="1">${ic('doc')}Open the brief</button>` : ''}
    </div>
    <button class="debate-toggle${open ? ' open' : ''}" data-toggle="debate">${ic('bulb')}<span>Idea debate · ${debate.filter((m) => m.kind !== 'user').length} messages</span>${ic('chevR')}</button>
    ${open ? `<div class="debate-box">${debateHtml(debate)}</div>` : ''}`;
  const docs = projectDocs();
  if (docs.length) {
    html += `<div class="doc-grid">${docs.map((d) => {
      const a = agentOf(d.agentId, d.agentName);
      return `<button class="doc-tile" data-doc="${esc(d.key)}" style="--agent-color:${esc(a.color)}">
          <span class="doc-tile-emoji">${a.emoji}</span>
          <span class="doc-tile-title">${esc(d.title)}</span>
          <span class="doc-tile-sub">${esc(a.name)}${d.version > 1 ? ` · v${d.version}` : ''}</span>
        </button>`;
    }).join('')}${(p.prototypes && p.prototypes.length > 1 ? p.prototypes : p.prototype ? [{ ...p.prototype, direction: p.designChoice || 'A' }] : []).map((pr) => `<button class="doc-tile proto${p.designChoice === pr.direction ? ' chosen' : ''}" data-proto="${esc(pr.id)}">
          <span class="doc-tile-emoji">${ic('image')}</span>
          <span class="doc-tile-title">Prototype${p.prototypes && p.prototypes.length > 1 ? ` ${esc(pr.direction)}` : ''}</span>
          <span class="doc-tile-sub">${p.designChoice === pr.direction ? 'Chosen · tap to try' : p.prototypes && p.prototypes.length > 1 ? 'Tap to try, then choose' : 'Clickable · tap to try'}</span>
        </button>`).join('')}</div>`;
    if (p.prototypes && p.prototypes.length > 1 && !p.designChoice && current.status !== 'running') {
      html += `<div class="review-card"><span class="next-ico">${ic('image')}</span><div><strong>Two design directions</strong>Try both prototypes, then pick the one the developers should build.
        <div class="btn-pair" style="margin-top:10px">${p.prototypes.map((pr) => `<button class="wide-btn soft" data-choose="${esc(pr.direction)}" style="height:40px;font-size:14.5px">Build ${esc(pr.direction)}</button>`).join('')}</div></div></div>`;
    }
    if (p.screenshots?.length) html += `<div class="shots">${p.screenshots.map((s) => `<img class="shot" src="/api/uploads/${s.id}" alt="${esc(s.name)}" loading="lazy" data-zoom="${s.id}">`).join('')}</div>`;
  }
  if (!docs.length && current.status !== 'running') {
    html += `<div class="next-card">
      <span class="next-ico">${ic('users')}</span>
      <div><strong>The planning crew is up next</strong>
      The Project Manager, Lead Architect, Database Architect and UX Designer turn the brief into a plan, a design direction and a prototype for you to approve.</div>
    </div>`;
  }
  if (p.tasks?.length) html += taskBoardHtml(p);
  if (p.url) {
    const up = p.uptime;
    const status = p.offline ? 'Offline (by you)' : up?.up === false ? 'Down' : up?.up ? `Up · ${up.ms} ms` : (p.stage === 'maintenance' ? 'Live · in maintenance' : 'Live · tap to open');
    const cert = up?.certDaysLeft != null ? ` · cert ${up.certDaysLeft} d` : '';
    html += `<a class="site-card${p.offline || up?.up === false ? ' down' : ''}" href="${esc(p.url)}" target="_blank" rel="noopener">
        <span class="brief-ico">${ic('globe')}</span>
        <span style="min-width:0"><div class="brief-title">${esc(p.url.replace(/^https?:\/\//, ''))}${p.customDomain ? ` · ${esc(p.customDomain)}` : ''}</div><div class="brief-sub">${esc(status)}${cert}${p.repoUrl ? ' · code on GitHub' : ''}</div></span>
      </a>`;
  }
  for (const m of after) {
    if (m.kind === 'user') html += `<div class="u-msg"><div class="u-label">You · to the crew</div>${attachmentsHtml(m.attachments)}<div class="u-bubble">${esc(m.content)}</div></div>`;
    else if (m.kind === 'approved' || m.kind === 'completed') html += `<div class="system-mark">${ic('check')}${esc(m.summary)}</div>`;
    else if (m.kind === 'system') html += `<div class="system-note"><strong>${esc(m.summary)}</strong>${m.content && m.content !== m.summary ? `<div class="md">${md(m.content)}</div>` : ''}</div>`;
    else if (m.kind === 'deployed') html += `<div class="system-note live"><strong>${ic('globe')}${esc(m.summary)}</strong><div class="md">${md(m.content)}</div></div>`;
    else html += agentMsgHtml(m);
  }
  if (current.status === 'error' && current.error) {
    html += `<div class="error-card"><strong>The crew stopped</strong>${esc(current.error)}</div>`;
  }
  if (canApprove()) {
    html += `<div class="review-card">
        <span class="next-ico">${ic('inbox')}</span>
        <div><strong>Your approval</strong>
        Read the four documents and try the prototype. If anything is off, reply below and the crew revises the affected documents. When it’s right, approve the plan.</div>
      </div>`;
  } else if (canDeploy()) {
    html += `<div class="review-card">
        <span class="next-ico">${ic('inbox')}</span>
        <div><strong>Deployment needs setup</strong>
        The build passed QA. ${current.deployReady?.github && current.deployReady?.kube ? 'Box now has its credentials — tap Deploy.' : `Box still needs ${!current.deployReady?.github ? 'a GitHub token (BOX_GITHUB_TOKEN)' : ''}${!current.deployReady?.github && !current.deployReady?.kube ? ' and ' : ''}${!current.deployReady?.kube ? 'the cluster kubeconfig (BOX_KUBECONFIG)' : ''} as repository secrets, then a redeploy of Box. After that, tap Deploy.`}</div>
      </div>`;
  } else if (canComplete()) {
    html += `<div class="review-card">
        <span class="next-ico">${ic('inbox')}</span>
        <div><strong>Your review</strong>
        Open the site and try it on your phone. Anything wrong or missing: reply below and the crew fixes, tests and redeploys. Happy with it? Mark it complete.</div>
      </div>`;
  } else if (p.stage === 'maintenance' && current.status !== 'running') {
    html += `<div class="next-card">
        <span class="next-ico">${ic('cube')}</span>
        <div><strong>In maintenance</strong>
        Write a fix or a feature below. The Tech Lead turns it into tasks; the crew builds, tests and redeploys.</div>
      </div>`;
  }
  return html;
}

function taskBoardHtml(p) {
  const tasks = p.tasks || [];
  const done = tasks.filter((t) => t.status === 'done').length;
  const doing = tasks.find((t) => t.status === 'doing');
  const blocked = tasks.filter((t) => t.status === 'blocked').length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  return `<button class="task-board" data-tasks="1">
      <div class="tb-head"><span class="tb-title">${ic('list')}Task board</span><span class="tb-count">${done} / ${tasks.length} done${blocked ? ` · ${blocked} blocked` : ''}</span></div>
      <div class="tb-bar"><i style="width:${pct}%"></i></div>
      ${doing ? `<div class="tb-now"><span class="shimmer">${esc(doing.id)} · ${esc(doing.title)}</span></div>` : ''}
    </button>`;
}

function fmtDuration(ms) {
  const m = Math.round((ms || 0) / 60000);
  if (m < 1) return 'under a minute';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

function openTasksSheet() {
  if (!current?.project?.tasks?.length) return;
  let taskSheet;
  openSheet({
    title: 'Task board',
    tall: true,
    render(s) {
      taskSheet = s;
      const draw = () => {
        const p = current.project;
        const tasks = p.tasks || [];
        const icon = { done: 'check', doing: 'spark', blocked: 'alert', todo: 'chevR', reverted: 'archive' };
        const running = current.status === 'running';
        const crewMs = p.crewMs || tasks.reduce((sum, t) => sum + (t.durationMs || 0), 0);
        s.body.innerHTML = `<p class="sheet-intro">${tasks.filter((t) => t.status === 'done').length} of ${tasks.length} done · ${fmtDuration(crewMs)} of crew time. Tap a task for actions.${running ? ' The crew is working; waiting tasks can still be edited.' : ''}</p>
          ${tasks.map((t) => {
            const a = agentOf(t.agentId || (t.role === 'frontend' ? 'frontend' : 'backend'));
            const src = { qa: 'fix from QA', review: 'fix from code review', owner: 'from you' }[t.source] || '';
            return `<button class="task-row ${esc(t.status)}" data-task="${esc(t.id)}">
              <span class="task-ico">${ic(icon[t.status] || 'chevR')}</span>
              <span class="task-main">
                <span class="task-title">${esc(t.id)} · ${esc(t.title)}${t.holdBefore ? ' <em class="task-hold">pause before</em>' : ''}</span>
                <span class="task-sub">${a.emoji} ${esc(a.name)} · ${esc(t.size || 'M')}${src ? ` · ${src}` : ''}${t.durationMs ? ` · ${fmtDuration(t.durationMs)}` : ''}${t.attempts > 1 ? ` · attempt ${t.attempts}` : ''}${t.commit ? ` · ${esc(t.commit)}` : ''}</span>
                ${t.report ? `<span class="task-report">${esc(t.report)}</span>` : ''}
              </span>
            </button>`;
          }).join('')}
          <button class="wide-btn soft" data-add-task="1" style="margin-top:10px">Add a task</button>`;
      };
      draw();
      s.body.closest('.backdrop')._redraw = draw;
      s.body.onclick = async (e) => {
        if (e.target.closest('[data-add-task]')) {
          const title = await dialog({ title: 'New task', text: 'One sentence of what to build or change. The crew gets it after the current task.', input: '', confirm: 'Add' });
          if (!title) return;
          try { await api(`/api/ideas/${current.id}/tasks`, { method: 'POST', body: JSON.stringify({ action: 'add', title, description: title }) }); toast('Task added'); } catch (err) { toast(err.message); }
          return;
        }
        const row = e.target.closest('[data-task]');
        if (!row) return;
        const t = current.project.tasks.find((x) => x.id === row.dataset.task);
        if (!t) return;
        const i = current.project.tasks.indexOf(t);
        const call = async (body, okText) => {
          try { await api(`/api/ideas/${current.id}/tasks`, { method: 'POST', body: JSON.stringify({ taskId: t.id, ...body }) }); if (okText) toast(okText); } catch (err) { toast(err.message); }
        };
        const items = [{ icon: 'doc', label: 'Read the task', run: () => dialog({ title: `${t.id} · ${t.title}`, text: t.description || '', confirm: 'Close' }) }];
        if (t.status === 'todo') {
          items.push({ icon: 'pencil', label: 'Edit title', run: async () => { const v = await dialog({ title: 'Edit task', input: t.title, confirm: 'Save' }); if (v) call({ action: 'edit', title: v }); } });
          items.push({ icon: 'pencil', label: 'Edit instructions', run: async () => { const v = await dialog({ title: 'Instructions for the developer', input: t.description || '', confirm: 'Save' }); if (v) call({ action: 'edit', description: v }); } });
          if (i > 0 && current.project.tasks[i - 1].status === 'todo') items.push({ icon: 'arrowUp', label: 'Move up', run: () => call({ action: 'move', dir: 'up' }) });
          if (i < current.project.tasks.length - 1 && current.project.tasks[i + 1].status === 'todo') items.push({ icon: 'arrowDown', label: 'Move down', run: () => call({ action: 'move', dir: 'down' }) });
          items.push({ icon: 'pause', label: t.holdBefore ? 'Don’t pause before it' : 'Pause before this task', run: () => call({ action: 'hold', holdBefore: !t.holdBefore }, t.holdBefore ? 'Hold removed' : 'The crew will pause before it') });
          items.push('-', { icon: 'trash', label: 'Delete task', danger: true, run: () => call({ action: 'delete' }, 'Task deleted') });
        }
        if (t.status === 'done' || t.status === 'blocked') {
          items.push({ icon: 'refresh', label: 'Redo with a note', run: async () => { const v = await dialog({ title: `Redo ${t.id}`, text: 'What should be different this time?', input: '', confirm: 'Redo' }); if (v) call({ action: 'redo', note: v }, 'Queued for a redo'); } });
        }
        if (t.status === 'done' && t.commit && current.status !== 'running') {
          items.push({ icon: 'archive', label: 'Roll back this task', danger: true, run: async () => { const ok = await dialog({ title: `Roll back ${t.id}?`, text: `Reverts commit ${t.commit} ("${t.title}") in the repository. The task is marked reverted; QA runs again before the next deploy.`, confirm: 'Roll back', danger: true }); if (ok) call({ action: 'revert' }, 'Rolled back'); } });
        }
        openPopover(row, items);
      };
    },
  });
}

function openDocViewer(key) {
  const d = current?.project?.docs?.[key];
  if (!d) return;
  const a = agentOf(d.agentId, d.agentName);
  openSheet({
    title: d.title,
    tall: true,
    render(s) {
      let showDiff = false;
      const draw = () => {
        s.body.innerHTML = `
        <div class="doc-by" style="--agent-color:${esc(a.color)}"><span class="a-avatar">${a.emoji}</span><span>${esc(a.name)}${d.version > 1 ? ` · version ${d.version}` : ''} · ${new Date(d.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span></div>
        <div class="btn-pair" style="margin-bottom:16px">
          <button class="wide-btn soft" data-act="copy">Copy</button>
          <button class="wide-btn soft" data-act="share">Share</button>
          ${d.previous ? `<button class="wide-btn ${showDiff ? 'accent' : 'soft'}" data-act="diff">${showDiff ? 'Hide changes' : 'What changed'}</button>` : ''}
          ${key === 'ux_direction' && current.project.tokens ? `<a class="wide-btn soft" style="display:inline-flex;align-items:center;justify-content:center;text-decoration:none" href="data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(current.project.tokens, null, 2))}" download="${esc(current.project.slug)}-tokens.json">Tokens</a>` : ''}
        </div>
        ${showDiff ? diffHtml(d.previous, d.content) : `<div class="md a-body">${md(d.content)}</div>`}`;
      };
      draw();
      s.body.onclick = async (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'diff') { showDiff = !showDiff; draw(); return; }
        if (act === 'copy' && await copyText(d.content)) toast('Document copied');
        if (act === 'share') {
          if (navigator.share) { try { await navigator.share({ title: `${current.title} — ${d.title}`, text: d.content }); } catch {} }
          else if (await copyText(d.content)) toast('Document copied');
        }
      };
    },
  });
}

/** Line diff (LCS) rendered as added/removed/unchanged lines. */
function diffHtml(oldText, newText) {
  const a = String(oldText || '').split('\n'), b = String(newText || '').split('\n');
  const n = a.length, m = b.length;
  if (n * m > 4e6) return `<div class="md a-body">${md(newText)}</div>`;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push(['=', a[i]]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push(['-', a[i]]); i++; }
    else { out.push(['+', b[j]]); j++; }
  }
  while (i < n) out.push(['-', a[i++]]);
  while (j < m) out.push(['+', b[j++]]);
  const changed = out.filter((x) => x[0] !== '=').length;
  // Collapse long unchanged runs.
  const rows = [];
  let run = [];
  const flush = () => { if (run.length > 6) { rows.push(...run.slice(0, 2), ['…', `${run.length - 4} unchanged lines`], ...run.slice(-2)); } else rows.push(...run); run = []; };
  for (const x of out) { if (x[0] === '=') run.push(x); else { flush(); rows.push(x); } }
  flush();
  return `<p class="sheet-intro">${changed} ${changed === 1 ? 'line' : 'lines'} changed from the previous version.</p><div class="diff">${rows.map(([k, line]) => `<div class="diff-line ${k === '+' ? 'add' : k === '-' ? 'del' : k === '…' ? 'skip' : ''}">${esc(line)}</div>`).join('')}</div>`;
}

function openDocsSheet() {
  const docs = projectDocs();
  openSheet({
    title: 'Project documents',
    render(s) {
      s.body.innerHTML = docs.map((d) => {
        const a = agentOf(d.agentId, d.agentName);
        return `<button class="row" data-doc="${esc(d.key)}">${ic('doc')}<span class="row-label">${esc(d.title)}<span class="row-sub">${a.emoji} ${esc(a.name)}${d.version > 1 ? ` · v${d.version}` : ''}</span></span><span class="row-chev">${ic('chevR')}</span></button>`;
      }).join('') + (current.project.prototype ? `<button class="row" data-proto="${esc(current.project.prototype.id)}">${ic('image')}<span class="row-label">Prototype<span class="row-sub">Clickable, by the UX Designer</span></span><span class="row-chev">${ic('chevR')}</span></button>` : '');
      s.body.onclick = (e) => {
        const d = e.target.closest('[data-doc]');
        const pr = e.target.closest('[data-proto]');
        if (d) { s.close(); openDocViewer(d.dataset.doc); }
        if (pr) { s.close(); openPrototype(); }
      };
    },
  });
}

function openPrototype(id) {
  const p = current?.project;
  const list = p?.prototypes?.length ? p.prototypes : p?.prototype ? [{ ...p.prototype, direction: 'A' }] : [];
  const proto = (id && list.find((x) => x.id === id)) || p?.prototype || list[0];
  if (!proto) return;
  const src = `/api/uploads/${proto.id}`;
  const two = list.length > 1;
  openSheet({
    title: two ? `Prototype ${proto.direction}` : 'Prototype',
    tall: true,
    render(s) {
      s.body.classList.add('proto-body');
      s.body.innerHTML = `
        <div class="proto-bar"><span>By the UX Designer · sample content, nothing is saved</span><a class="proto-open" href="${src}" target="_blank" rel="noopener">Full screen ${ic('chevR')}</a></div>
        <iframe class="proto-frame" src="${src}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" title="Prototype"></iframe>
        <div class="btn-pair" style="margin-top:10px">
          ${two && !p.designChoice && current.status !== 'running' ? `<button class="wide-btn accent" data-act="choose">Build direction ${esc(proto.direction)}</button>` : ''}
          ${two ? `<button class="wide-btn soft" data-act="other">See ${esc(list.find((x) => x.id !== proto.id)?.direction || '')}</button>` : ''}
          <button class="wide-btn soft" data-act="feedback">Comment</button>
        </div>`;
      s.body.onclick = async (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'other') { s.close(); openPrototype(list.find((x) => x.id !== proto.id)?.id); return; }
        if (act === 'choose') {
          try { await api(`/api/ideas/${current.id}/design`, { method: 'POST', body: JSON.stringify({ choice: proto.direction }) }); s.close(); await openIdea(current.id, { silent: true }); toast(`Direction ${proto.direction} chosen`); } catch (err) { toast(err.message); }
          return;
        }
        if (act !== 'feedback') return;
        const v = await dialog({ title: 'Prototype feedback', text: 'Say which screen or element and what should change. During plan review this revises the design; later it becomes a task for the developers.', input: '', confirm: 'Send' });
        if (!v) return;
        s.close();
        $('input').value = `Prototype feedback: ${v}`;
        autosize(); updateSendState();
        await send();
      };
    },
  });
}

/** Browse the project's repository. */
function openFilesSheet() {
  if (!current?.project?.slug) return;
  openSheet({
    title: 'Code',
    tall: true,
    render(s) {
      let dir = '';
      const load = async (rel) => {
        s.body.innerHTML = '<p class="sheet-intro">Loading…</p>';
        let r;
        try { r = await api(`/api/ideas/${current.id}/files?path=${encodeURIComponent(rel)}`); } catch (e) { s.body.innerHTML = `<p class="sheet-intro">${esc(e.message)}</p>`; return; }
        s.setTitle(r.path ? r.path.split('/').pop() : 'Code');
        s.setBack(r.path ? () => load(r.path.split('/').slice(0, -1).join('/')) : null);
        if (r.dir) {
          dir = r.path;
          const gh = current.project.repoUrl;
          s.body.innerHTML = `<p class="sheet-intro">${r.path ? `/${esc(r.path)}` : current.project.slug}${gh ? ` · <a href="${esc(gh)}" target="_blank" rel="noopener">GitHub</a> · <a href="https://github.com/codespaces/new?repo=${esc(gh.replace('https://github.com/', ''))}" target="_blank" rel="noopener">Codespaces</a>` : ''}</p>` +
            (r.items.map((it) => `<button class="row" data-path="${esc(r.path ? `${r.path}/${it.name}` : it.name)}">${ic(it.dir ? 'folder' : 'doc')}<span class="row-label">${esc(it.name)}</span><span class="row-value">${it.dir ? '' : fmtBytes(it.size)}</span><span class="row-chev">${ic('chevR')}</span></button>`).join('') || '<p class="sheet-intro">Empty.</p>');
        } else {
          s.body.innerHTML = `<p class="sheet-intro">/${esc(r.path)} · ${fmtBytes(r.size)}</p>` + (r.tooBig ? '<p class="sheet-intro">Too large to show here.</p>' : r.binary ? '<p class="sheet-intro">Binary file.</p>' : `<button class="wide-btn soft" data-explain="${esc(r.path)}" style="margin-bottom:10px">Explain this file</button><div id="explain-slot"></div><pre class="code">${esc(r.content)}</pre>`);
        }
      };
      load('');
      s.body.onclick = async (e) => {
        const ex = e.target.closest('[data-explain]');
        if (ex) {
          ex.disabled = true; ex.textContent = 'Reading…';
          try { const r = await api(`/api/ideas/${current.id}/files?path=${encodeURIComponent(ex.dataset.explain)}&explain=1`); $('explain-slot').innerHTML = `<div class="system-note"><div class="md">${md(r.explanation || '')}</div></div>`; ex.remove(); } catch (err) { toast(err.message); ex.disabled = false; ex.textContent = 'Explain this file'; }
          return;
        }
        const b = e.target.closest('[data-path]'); if (b) load(b.dataset.path);
      };
    },
  });
}
function fmtBytes(n) { return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`; }

async function setCustomDomain() {
  if (!current?.project) return;
  const v = await dialog({ title: 'Custom domain', text: 'Point the domain’s DNS (an A record) at 2.25.157.104 at your registrar. DevOps adds it to the site on the next deploy, with its own certificate. Leave empty to remove.', input: current.project.customDomain || '', confirm: 'Save' });
  if (v === null) return;
  try {
    const r = await api(`/api/ideas/${current.id}`, { method: 'PATCH', body: JSON.stringify({ customDomain: v }) });
    current.project.customDomain = r.customDomain;
    toast(r.customDomain ? `Custom domain set: ${r.customDomain}` : 'Custom domain removed');
  } catch (e) { toast(e.message); }
}
async function toggleOffline() {
  if (!current?.project) return;
  const off = !current.project.offline;
  const ok = await dialog({ title: off ? 'Take the site offline?' : 'Bring the site back?', text: off ? 'Visitors get an error page until you bring it back. Data is kept.' : 'The site starts again within a minute.', confirm: off ? 'Take offline' : 'Bring back', danger: off });
  if (!ok) return;
  try {
    await api(`/api/ideas/${current.id}/offline`, { method: 'POST', body: JSON.stringify({ offline: off }) });
    current.project.offline = off;
    toast(off ? 'Site is going offline' : 'Site is coming back');
    renderThread();
  } catch (e) { toast(e.message); }
}
function openEnvSheet() {
  const d = current?.project?.deploy;
  if (!d) return;
  openSheet({
    title: 'Environment variables',
    tall: true,
    render(s) {
      const draw = () => {
        const names = Object.keys(d.envJson || {}).filter((k) => !k.startsWith('__'));
        const set = new Set(Object.keys(d.env || {}));
        const missing = new Set(d.missing || []);
        s.body.innerHTML = `<p class="sheet-intro">What the app reads at runtime. Values are stored in the cluster secret, never shown here. ${current.project.url ? 'Changing one restarts the site.' : 'They are applied on the first deploy.'}</p>
          ${names.map((k) => `<button class="row" data-env="${esc(k)}">${ic(missing.has(k) ? 'alert' : 'check')}<span class="row-label">${esc(k)}<span class="row-sub">${missing.has(k) ? 'Needed — tap to set' : set.has(k) ? 'Set' : 'Generated by Box'}</span></span><span class="row-chev">${ic('chevR')}</span></button>`).join('')}
          <button class="wide-btn soft" data-env="" style="margin-top:10px">Add a variable</button>`;
      };
      draw();
      s.body.onclick = async (e) => {
        const b = e.target.closest('[data-env]');
        if (!b) return;
        let name = b.dataset.env;
        if (!name) { name = await dialog({ title: 'Variable name', input: '', confirm: 'Next' }); if (!name) return; name = name.trim().toUpperCase(); }
        const value = await dialog({ title: name, text: 'Paste the value. It goes straight to the server and is not kept in this app.', input: '', confirm: 'Save' });
        if (value === null) return;
        try {
          const r = await api(`/api/ideas/${current.id}/env`, { method: 'POST', body: JSON.stringify({ name, value }) });
          d.missing = r.missing; d.env = Object.fromEntries(r.names.map((n) => [n, true])); d.envJson = { ...(d.envJson || {}), [name]: d.envJson?.[name] ?? null };
          toast(r.applied ? 'Saved and applied' : 'Saved');
          draw();
        } catch (err) { toast(err.message); }
      };
    },
  });
}
function openLogsSheet() {
  if (!current?.project?.url) return;
  openSheet({
    title: 'Logs',
    tall: true,
    render(s) {
      const load = async () => {
        s.body.innerHTML = '<p class="sheet-intro">Loading…</p>';
        try {
          const r = await api(`/api/ideas/${current.id}/logs?lines=200`);
          s.body.innerHTML = `<div class="btn-pair" style="margin-bottom:10px"><button class="wide-btn soft" data-act="reload">Refresh</button></div><pre class="code">${esc(r.logs || '(no output)')}</pre>`;
        } catch (e) { s.body.innerHTML = `<p class="sheet-intro">${esc(e.message)}</p>`; }
      };
      load();
      s.body.onclick = (e) => { if (e.target.closest('[data-act="reload"]')) load(); };
    },
  });
}

function renderThread(forceBottom = false) {
  if (!current) return;
  const stick = forceBottom || nearBottom();
  let html = isProject() ? projectHtml() : debateHtml(current.messages);
  if (!isProject() && current.status === 'error' && current.error) {
    html += `<div class="error-card"><strong>The debate stopped</strong>${esc(current.error)}</div>`;
  }
  if (!isProject() && canPromote()) {
    html += `<div class="review-card">
        <span class="next-ico">${ic('inbox')}</span>
        <div><strong>Your review</strong>
        Read the brief. If something’s off, reply below with feedback and the room runs another round. When you’re happy, promote it to a project.</div>
      </div>`;
  }
  if (current.status === 'running') {
    const who = thinking ? agentOf(thinking.agentId) : null;
    const acts = isProject() ? (current.project.activity || []).slice(-8) : [];
    const open = expanded.has('activity');
    html += `<div class="brewing">
        <span class="brew-mark">${ic('spark')}</span>
        <span class="shimmer">${thinking?.label ? esc(thinking.label) : who ? `${who.emoji} ${esc(who.name)} is thinking` : 'Gathering the room'}</span>
        <span class="brew-time" id="brew-time"></span>
      </div>`;
    if (lastActivity || acts.length) {
      const last = lastActivity || acts[acts.length - 1];
      html += `<div class="activity${open ? ' open' : ''}">
          <button class="act-line" data-toggle="activity"><span class="act-tool ${esc(last.tool)}">${esc(ACT_LABEL[last.tool] || last.tool)}</span><span class="act-text">${esc(last.text)}</span>${ic('chevR')}</button>
          ${open ? `<div class="act-list">${acts.slice().reverse().map((x) => `<div class="act-row"><span class="act-tool ${esc(x.tool)}">${esc(ACT_LABEL[x.tool] || x.tool)}</span><span class="act-text">${esc(x.text)}</span></div>`).join('')}</div>` : ''}
        </div>`;
    }
  }
  $('messages').innerHTML = html;
  tickBrew();
  if (stick) requestAnimationFrame(() => scrollToBottom(false));
}

const ACT_LABEL = { run: 'ran', read: 'read', write: 'wrote', edit: 'edited', search: 'searched', fetch: 'opened', say: 'said' };
function tickBrew() {
  const el = $('brew-time');
  if (el && thinking) el.textContent = `${Math.floor((Date.now() - thinking.since) / 1000)}s`;
}
setInterval(tickBrew, 1000);

$('messages').addEventListener('click', async (e) => {
  const t = e.target.closest('[data-toggle],[data-copy],[data-brief],[data-zoom],[data-agent],[data-doc],[data-proto],[data-tasks],[data-choose]');
  if (!t) return;
  if (t.dataset.choose) {
    try {
      await api(`/api/ideas/${current.id}/design`, { method: 'POST', body: JSON.stringify({ choice: t.dataset.choose }) });
      await openIdea(current.id, { silent: true });
      toast(`Direction ${t.dataset.choose} chosen`);
    } catch (err) { toast(err.message); }
  } else if (t.dataset.doc) {
    openDocViewer(t.dataset.doc);
  } else if (t.dataset.tasks) {
    openTasksSheet();
  } else if (t.dataset.proto) {
    openPrototype(t.dataset.proto);
  } else if (t.dataset.toggle) {
    const id = t.dataset.toggle;
    expanded.has(id) ? expanded.delete(id) : expanded.add(id);
    renderThread();
  } else if (t.dataset.copy) {
    const m = current.messages.find((x) => x.id === t.dataset.copy);
    if (m && await copyText(m.content)) {
      t.innerHTML = ic('check');
      setTimeout(() => { t.innerHTML = ic('copy'); }, 1500);
    }
  } else if (t.dataset.brief) {
    openBriefViewer();
  } else if (t.dataset.zoom) {
    openLightbox(t.dataset.zoom);
  } else if (t.dataset.agent && AGENT_MAP[t.dataset.agent]) {
    openAgentDetail(t.dataset.agent);
  }
});

// ---------- dock / composer ----------
function autosize() {
  const i = $('input');
  i.style.height = 'auto';
  i.style.height = `${Math.min(i.scrollHeight, 190)}px`;
}
function hasContent() {
  return $('input').value.trim().length > 0 || pending.some((p) => p.status === 'ready');
}
function updateSendState() {
  const running = route.view === 'idea' && current && current.status === 'running';
  const content = hasContent();
  $('send-btn').classList.toggle('hidden', !content);
  $('stop-btn').classList.toggle('hidden', content || !running);
}
function renderDock() {
  const input = $('input');
  if (route.view === 'new' || !current) {
    input.placeholder = 'Describe your idea…';
    $('rounds-chip').classList.remove('hidden');
    $('rounds-chip').innerHTML = `${ic('rounds')}${settings.rounds} ${settings.rounds === 1 ? 'round' : 'rounds'}`;
    $('state-actions').innerHTML = '';
  } else {
    $('rounds-chip').classList.add('hidden');
    const s = current.status;
    const stage = isProject() ? current.project.stage : '';
    input.placeholder = isProject()
      ? (canApprove() ? 'Ask the crew for changes…'
        : canComplete() ? 'What should change on the site?…'
        : stage === 'maintenance' ? 'A fix or a feature for the crew…'
        : s === 'running' ? 'Note for the crew (read on their next turn)…' : 'Note for the crew…')
      : s === 'running' ? 'Steer the room…'
      : canPromote() ? 'Feedback to refine the idea…' : 'Reply to the room…';
    const pills = [];
    if (isProject()) {
      if (canApprove()) pills.push(['primary', 'check', 'Approve plan', 'approve']);
      if (canComplete()) pills.push(['primary', 'check', 'Mark complete', 'complete']);
      if (current.project.url && s !== 'running') pills.push(['', 'globe', 'Open the site', 'site']);
      if (canDeploy()) pills.push(['primary', 'rocket', 'Deploy', 'run']);
      if (canResumeBuild()) pills.push(['primary', 'play', 'Resume the crew', 'run']);
      if (current.project.prototype && s !== 'running' && !current.project.url) pills.push(['', 'image', 'Prototype', 'proto']);
      if ((s === 'paused' || s === 'error') && ['planning', 'design'].includes(current.project.stage)) pills.push(['primary', 'play', 'Resume planning', 'run']);
      $('state-actions').innerHTML = pills.map(([cls, icon, label, act]) =>
        `<button class="state-pill ${cls}" data-act="${act}">${ic(icon)}${label}</button>`).join('');
      updateSendState();
      return;
    }
    if (quickMode) {
      input.placeholder = `Quick question for ${quickMode.name}…`;
      $('state-actions').innerHTML = `<button class="state-pill" data-act="cancel-quick">${ic('x')}Quick question for ${esc(quickMode.name)} · cancel</button>`;
      updateSendState();
      return;
    }
    if (s === 'paused' || s === 'error') pills.push(['primary', 'play', 'Resume debate', 'run']);
    if (s === 'idle') pills.push(['primary', 'play', 'Start debate', 'run']);
    if (s === 'done' && current.brief) {
      pills.push(['primary', 'rocket', 'Promote to project', 'promote']);
      pills.push(['', 'doc', 'Idea Brief', 'brief']);
    }
    $('state-actions').innerHTML = pills.map(([cls, icon, label, act]) =>
      `<button class="state-pill ${cls}" data-act="${act}">${ic(icon)}${label}</button>`).join('');
  }
  updateSendState();
}
$('state-actions').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'run') runCurrent();
  if (b.dataset.act === 'brief') openBriefViewer();
  if (b.dataset.act === 'promote') promoteCurrent();
  if (b.dataset.act === 'approve') approveCurrent();
  if (b.dataset.act === 'complete') completeCurrent();
  if (b.dataset.act === 'site') openSite();
  if (b.dataset.act === 'proto') openPrototype();
  if (b.dataset.act === 'cancel-quick') cancelQuick();
});
$('input').addEventListener('input', () => { autosize(); updateSendState(); });
$('input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && finePointer.matches) { e.preventDefault(); send(); }
});
$('send-btn').onclick = send;
$('stop-btn').onclick = pauseCurrent;
$('rounds-chip').onclick = openRoundsSheet;
$('plus-btn').onclick = openAddSheet;

async function send() {
  if (busy) return;
  if (pending.some((p) => p.status === 'uploading')) return toast('Waiting for uploads to finish…');
  const text = $('input').value.trim();
  const attachments = pending.filter((p) => p.status === 'ready').map((p) => p.uploadId);
  if (!text && !attachments.length) return;
  busy = true;
  try {
    if (route.view === 'new' || !current) {
      const idea = await api('/api/ideas', { method: 'POST', body: JSON.stringify({ text, attachments, maxRounds: settings.rounds, template: pickedTemplate }) });
      pickedTemplate = null;
      clearComposer();
      location.hash = `#/idea/${idea.id}`;
    } else if (quickMode && !isProject()) {
      const id = current.id;
      const q = quickMode;
      const r = await api(`/api/ideas/${id}/quick`, { method: 'POST', body: JSON.stringify({ text, agentId: q.agentId }) });
      quickMode = null;
      clearComposer();
      if (current && current.id === id && r.message && !current.messages.some((m) => m.id === r.message.id)) {
        current.messages.push(r.message);
        current.status = 'running';
        renderThread(true); renderTop(); renderDock();
      }
    } else {
      const id = current.id;
      const msg = await api(`/api/ideas/${id}/message`, { method: 'POST', body: JSON.stringify({ text, attachments }) });
      clearComposer();
      if (current && current.id === id && !current.messages.some((m) => m.id === msg.id)) {
        current.messages.push(msg);
        renderThread(true);
      }
      if (current && !isProject() && current.status !== 'running') await runCurrent();
    }
  } catch (e) {
    toast(e.message);
  } finally {
    busy = false;
  }
}
function clearComposer() {
  $('input').value = '';
  for (const p of pending) if (p.preview) URL.revokeObjectURL(p.preview);
  pending = [];
  renderPending();
  autosize();
  updateSendState();
}

// ---------- attachments ----------
const MAX_PENDING = 8;
function guessType(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return { pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown', csv: 'text/csv', json: 'application/json', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }[ext] || 'application/octet-stream';
}
function downscale(file, max = 1600) {
  return new Promise((resolve) => {
    if (file.type === 'image/gif') return resolve(file);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => resolve(b || file), 'image/jpeg', 0.86);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}
async function addFiles(fileList) {
  const files = [...fileList].slice(0, Math.max(0, MAX_PENDING - pending.length));
  if (fileList.length > files.length) toast(`Up to ${MAX_PENDING} files per message.`);
  for (const f of files) {
    const type = f.type || guessType(f.name);
    const kind = type.startsWith('image/') ? 'image' : type === 'application/pdf' ? 'pdf' : 'text';
    const p = { local: Math.random().toString(36).slice(2), name: f.name || 'photo.jpg', kind, status: 'uploading' };
    pending.push(p);
    let blob = f;
    if (kind === 'image') {
      blob = await downscale(f);
      if (blob !== f) p.name = p.name.replace(/\.[^.]+$/, '') + '.jpg';
      p.preview = URL.createObjectURL(blob);
    }
    renderPending();
    updateSendState();
    try {
      const r = await fetch(`/api/uploads?name=${encodeURIComponent(p.name)}`, {
        method: 'POST', headers: { 'Content-Type': blob.type || type }, body: blob,
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Upload failed');
      p.uploadId = data.id;
      p.status = 'ready';
    } catch (e) {
      pending = pending.filter((x) => x !== p);
      toast(`${p.name}: ${e.message}`);
    }
    renderPending();
    updateSendState();
  }
}
function renderPending() {
  const strip = $('attach-strip');
  strip.classList.toggle('hidden', !pending.length);
  strip.innerHTML = pending.map((p) => `<div class="pending ${p.status === 'uploading' ? 'uploading' : ''}">
      ${p.preview
        ? `<img class="att-img" src="${p.preview}" alt="">`
        : `<div class="att-file"><span class="att-ico">${ic('doc')}</span><span style="min-width:0"><div class="att-name">${esc(p.name)}</div><div class="att-meta">${fileLabel(p)}</div></span></div>`}
      <button class="pending-x" data-remove="${p.local}" aria-label="Remove">${ic('x')}</button>
    </div>`).join('');
}
$('attach-strip').addEventListener('click', (e) => {
  const b = e.target.closest('[data-remove]');
  if (!b) return;
  pending = pending.filter((p) => p.local !== b.dataset.remove);
  renderPending();
  updateSendState();
});
for (const id of ['file-camera', 'file-photos', 'file-any']) {
  $(id).addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
}

// ---------- dictation ----------
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
let recording = false;
let recBase = '';
let energy = 0;
let waveBars = [];
let waveTimer = null;

function startDictation() {
  if (!SpeechRec) return toast('Dictation isn’t available in this browser. Use the mic on your keyboard instead.');
  try {
    rec = new SpeechRec();
  } catch {
    return toast('Dictation couldn’t start in this browser.');
  }
  rec.lang = navigator.language || 'en-US';
  rec.continuous = true;
  rec.interimResults = true;
  recBase = $('input').value ? $('input').value.replace(/\s*$/, ' ') : '';
  rec.onresult = (e) => {
    let finals = '', interim = '';
    for (const r of e.results) (r.isFinal ? (finals += r[0].transcript) : (interim += r[0].transcript));
    $('input').value = recBase + finals + interim;
    autosize();
    energy = 1;
  };
  rec.onsoundstart = rec.onspeechstart = () => { energy = Math.max(energy, 0.7); };
  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Microphone access is blocked. Allow it in your browser settings to dictate.');
    else if (e.error !== 'aborted' && e.error !== 'no-speech') toast(`Dictation stopped (${e.error}).`);
    stopDictation(true);
  };
  rec.onend = () => { if (recording) stopDictation(true); };
  try { rec.start(); } catch { return toast('Dictation couldn’t start.'); }
  recording = true;
  $('composer-row').classList.add('hidden');
  $('record-row').classList.remove('hidden');
  startWave();
}
function stopDictation(keep) {
  if (!recording) return;
  recording = false;
  try { rec?.stop(); } catch {}
  rec = null;
  if (!keep) $('input').value = recBase.trimEnd();
  $('record-row').classList.add('hidden');
  $('composer-row').classList.remove('hidden');
  stopWave();
  autosize();
  updateSendState();
  dictated = keep && $('input').value.trim().length > 60;
  renderPolishChip();
}
let dictated = false;
function renderPolishChip() {
  let chip = $('polish-chip');
  if (!dictated || !$('input').value.trim()) { chip?.remove(); return; }
  if (!chip) {
    chip = document.createElement('button');
    chip.id = 'polish-chip';
    chip.className = 'chip-btn';
    chip.innerHTML = `${ic('spark')}Clean up dictation`;
    chip.onclick = async () => {
      chip.disabled = true; chip.textContent = 'Cleaning…';
      try {
        const r = await api('/api/polish', { method: 'POST', body: JSON.stringify({ text: $('input').value }) });
        $('input').value = r.text; autosize(); updateSendState();
        toast('Cleaned up');
      } catch (e) { toast(e.message); }
      dictated = false; renderPolishChip();
    };
    $('rounds-chip').insertAdjacentElement('afterend', chip);
  }
}
$('input').addEventListener('input', () => { if (dictated && !$('input').value.trim()) { dictated = false; renderPolishChip(); } });
function startWave() {
  const c = $('wave');
  const dpr = window.devicePixelRatio || 1;
  c.width = c.clientWidth * dpr;
  c.height = 36 * dpr;
  const slots = Math.floor(c.clientWidth / 7);
  waveBars = new Array(slots).fill(0);
  energy = 0.3;
  const color = getComputedStyle(document.documentElement).getPropertyValue('--text').trim();
  const dim = getComputedStyle(document.documentElement).getPropertyValue('--text-3').trim();
  const ctx = c.getContext('2d');
  waveTimer = setInterval(() => {
    waveBars.shift();
    waveBars.push(energy > 0.12 ? (0.25 + Math.random() * 0.75) * energy : 0);
    energy *= 0.9;
    ctx.clearRect(0, 0, c.width, c.height);
    const mid = c.height / 2;
    waveBars.forEach((v, i) => {
      const x = (i * 7 + 3) * dpr;
      if (v < 0.06) {
        ctx.fillStyle = dim;
        ctx.beginPath(); ctx.arc(x, mid, 1.6 * dpr, 0, Math.PI * 2); ctx.fill();
      } else {
        const h = Math.max(6 * dpr, v * c.height * 0.95);
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.roundRect(x - 1.6 * dpr, mid - h / 2, 3.2 * dpr, h, 1.6 * dpr); ctx.fill();
      }
    });
  }, 70);
}
function stopWave() { clearInterval(waveTimer); waveTimer = null; }
$('mic-btn').onclick = startDictation;
$('rec-cancel').onclick = () => stopDictation(false);
$('rec-stop').onclick = () => stopDictation(true);
$('rec-send').onclick = () => { stopDictation(true); send(); };

// ---------- idea actions ----------
async function runCurrent() {
  if (!current) return;
  try {
    await api(`/api/ideas/${current.id}/run`, { method: 'POST', body: '{}' });
    current.status = 'running';
    current.error = null;
    renderTop(); renderThread(true); renderDock();
  } catch (e) { toast(e.message); }
}
async function pauseCurrent() {
  if (!current) return;
  try {
    await api(`/api/ideas/${current.id}/pause`, { method: 'POST', body: '{}' });
    toast('Pausing after the current speaker finishes…');
  } catch (e) { toast(e.message); }
}
async function renameCurrent() {
  if (!current) return;
  const title = await dialog({ title: 'Rename idea', input: current.title, confirm: 'Save' });
  if (!title || title === current.title) return;
  try {
    await api(`/api/ideas/${current.id}`, { method: 'PATCH', body: JSON.stringify({ title }) });
    current.title = title;
    const i = ideas.find((x) => x.id === current.id);
    if (i) i.title = title;
    renderTop(); renderSidebar();
  } catch (e) { toast(e.message); }
}
async function deleteCurrent() {
  if (!current) return;
  const ok = await dialog({ title: 'Delete idea?', text: `“${current.title}” and its whole debate will be permanently deleted.`, confirm: 'Delete', danger: true });
  if (!ok) return;
  try {
    await api(`/api/ideas/${current.id}`, { method: 'DELETE' });
    ideas = ideas.filter((i) => i.id !== current.id);
    location.hash = '#/';
  } catch (e) { toast(e.message); }
}
async function shareIdea() {
  if (!current) return;
  const url = location.href;
  if (navigator.share) {
    try { await navigator.share({ title: current.title, text: current.brief ? briefTitle(current.brief) : current.title, url }); } catch {}
    return;
  }
  if (await copyText(url)) toast('Link copied');
}

// ---------- sheets ----------
function openAddSheet() {
  openSheet({
    title: 'Add context',
    render(s) {
      const isNew = route.view === 'new' || !current;
      s.body.innerHTML = `
        <div class="tiles">
          <button class="tile" data-pick="file-camera">${ic('camera')}Camera</button>
          <button class="tile" data-pick="file-photos">${ic('image')}Photos</button>
          <button class="tile" data-pick="file-any">${ic('fileUp')}Files</button>
        </div>
        ${isNew ? `<button class="row" data-go="rounds">${ic('rounds')}<span class="row-label">Debate rounds</span><span class="row-value">${settings.rounds} · ${ROUND_LABEL[settings.rounds]}</span><span class="row-chev">${ic('chevR')}</span></button>` : ''}
        ${!isNew && !isProject() && current.messages.some((m) => m.kind === 'kickoff') ? `<button class="row" data-go="quick">${ic('question')}<span class="row-label">Ask the room a quick question<span class="row-sub">One or two agents answer directly. No new round, the brief stays as it is.</span></span><span class="row-chev">${ic('chevR')}</span></button>` : ''}
        <button class="row" data-go="agents">${ic('users')}<span class="row-label">Agents</span><span class="row-value">${AGENTS.length}</span><span class="row-chev">${ic('chevR')}</span></button>
        <p class="sheet-intro" style="margin-top:12px">Agents can see photos and PDFs, and read text files (txt, md, csv, json).</p>`;
      s.body.onclick = (e) => {
        const pick = e.target.closest('[data-pick]');
        if (pick) { s.close(); $(pick.dataset.pick).click(); return; }
        const go = e.target.closest('[data-go]');
        if (go?.dataset.go === 'rounds') { s.close(); openRoundsSheet(); }
        if (go?.dataset.go === 'agents') { s.close(); openAgentsSheet(); }
        if (go?.dataset.go === 'quick') { s.close(); startQuick(null); }
      };
    },
  });
}

/** Put the composer into quick-question mode (optionally aimed at one agent). */
function startQuick(agentId) {
  if (!current || isProject()) return;
  if (current.status === 'running') return toast('Wait for the room to finish, then ask.');
  quickMode = { agentId, name: agentId ? agentOf(agentId).name : 'the room' };
  renderDock();
  setTimeout(() => $('input').focus(), 50);
}
function cancelQuick() { quickMode = null; renderDock(); }

function openRoundsSheet() {
  openSheet({
    title: 'Debate rounds',
    render(s) {
      const draw = () => {
        s.body.innerHTML = `<p class="sheet-intro">How many rounds the room debates before the Orchestrator writes the brief. It can conclude early once the idea is mature.</p>` +
          [1, 2, 3, 4].map((n) => `<button class="row check" data-n="${n}">
              <span class="row-label">${n} ${n === 1 ? 'round' : 'rounds'}<span class="row-sub">${ROUND_LABEL[n]}${n >= 3 ? ' · uses more of your Claude limits' : ''}</span></span>
              <span class="row-value">${settings.rounds === n ? ic('check') : ''}</span>
            </button>`).join('');
      };
      draw();
      s.body.onclick = (e) => {
        const b = e.target.closest('[data-n]');
        if (!b) return;
        settings.rounds = Number(b.dataset.n);
        saveSettings();
        draw();
        renderTop(); renderDock();
        setTimeout(s.close, 180);
      };
    },
  });
}

function openRoomSheet() {
  if (!current) return;
  openSheet({
    title: 'Room',
    tall: true,
    render(s) {
      const counts = {};
      for (const m of current.messages) counts[m.agentId] = (counts[m.agentId] || 0) + 1;
      s.body.innerHTML = `
        <button class="row" data-act="rename">${ic('pencil')}<span class="row-label">${esc(current.title)}</span><span class="row-chev">${ic('chevR')}</span></button>
        <div class="row" style="cursor:default">${ic('rounds')}<span class="row-label">Round ${Math.max(current.round, 1)} of ${current.maxRounds}</span><span class="row-value">${STATUS_LABEL[current.status] || ''}</span></div>
        ${current.brief ? `<button class="row" data-act="brief">${ic('doc')}<span class="row-label">Idea Brief</span><span class="row-chev">${ic('chevR')}</span></button>` : ''}
        ${(() => {
          const inRoom = new Set(['orchestrator', ...(current.roster || []), ...Object.keys(counts).filter((id) => AGENT_MAP[id])]);
          const row = (a) => `<button class="ag-row tap" data-agent="${a.id}" style="--agent-color:${esc(a.color)}">
            <span class="a-avatar">${a.emoji}</span>
            <span class="ag-main"><span class="ag-top"><span class="a-name">${esc(a.name)}</span>${a.research ? '<span class="ag-tag">web research</span>' : ''}</span><span class="ag-desc">${esc(a.description || '')}</span></span>
            <span class="ag-count">${counts[a.id] || 0}</span>
          </button>`;
          const here = AGENTS.filter((a) => inRoom.has(a.id));
          const bench = AGENTS.filter((a) => !inRoom.has(a.id));
          return `<div class="sb-label" style="padding:14px 6px 8px">In this room</div>${here.map(row).join('')}`
            + (bench.length ? `<div class="sb-label" style="padding:14px 6px 8px">Not picked for this idea</div><p class="sheet-intro">The Orchestrator chooses who joins each idea. Ask for one of these in a reply and it can re-pick next round.</p>${bench.map(row).join('')}` : '');
        })()}
        <button class="wide-btn soft" data-act="agents" style="margin-top:6px">Manage agents</button>`;
      s.body.onclick = (e) => {
        const ag = e.target.closest('[data-agent]');
        if (ag) { openAgentDetail(ag.dataset.agent); return; }
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'rename') { s.close(); renameCurrent(); }
        if (act === 'brief') { s.close(); openBriefViewer(); }
        if (act === 'agents') { s.close(); openAgentsSheet(); }
      };
    },
  });
}

function openAgentDetail(agentId) {
  const a = AGENT_MAP[agentId];
  if (!a) return;
  openSheet({
    title: `${a.emoji} ${a.name}`,
    tall: true,
    render(s) {
      const entries = current ? current.messages.filter((m) => m.agentId === agentId) : [];
      // How often the chair cited this agent by name in syntheses and the brief.
      const cited = current ? current.messages.filter((m) => m.kind === 'synthesis' || m.kind === 'brief').reduce((n, m) => n + ((m.content.match(new RegExp(a.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length), 0) : 0;
      const canAsk = current && !isProject() && current.status !== 'running' && current.messages.some((m) => m.kind === 'kickoff') && agentId !== 'orchestrator' && !a.crew;
      s.body.innerHTML = `
        <p class="sheet-intro">${esc(a.description || '')}</p>
        <div class="row" style="cursor:default"><span class="row-label">Model</span><span class="row-value">${esc(a.model)}</span></div>
        ${current && entries.length ? `<div class="row" style="cursor:default"><span class="row-label">Cited by the chair</span><span class="row-value">${cited} ${cited === 1 ? 'time' : 'times'}</span></div>` : ''}
        ${canAsk ? `<button class="wide-btn soft" data-ask="${esc(agentId)}" style="margin:8px 0 4px">Ask ${esc(a.name)} directly</button>` : ''}
        ${!a.builtin && !a.crew ? `<button class="wide-btn soft" data-edit-agent="${esc(agentId)}" style="margin:4px 0">Edit this agent</button>` : ''}
        ${current ? `<div class="sb-label" style="padding:14px 6px 8px">${entries.length} ${entries.length === 1 ? 'contribution' : 'contributions'} to this idea</div>` : ''}
        ${entries.slice().reverse().map((m) => `<div class="ag-row"><span class="ag-main">
            <span class="ag-top"><span class="ag-tag">${KIND_LABEL[m.kind] || `Round ${m.round}`}</span><span class="a-meta">${timeOf(m.ts)}</span></span>
            <span class="ag-desc" style="color:var(--text);font-size:15px">${mdInline(esc(m.summary))}</span>
          </span></div>`).join('')}`;
      s.body.onclick = (e) => {
        const ask = e.target.closest('[data-ask]');
        if (ask) { closeAllLayers(); startQuick(ask.dataset.ask); return; }
        const ed = e.target.closest('[data-edit-agent]');
        if (ed) { closeAllLayers(); openAgentsSheet({ edit: ed.dataset.editAgent }); }
      };
    },
  });
}

const EXTRA_KINDS = [
  ['pitch', 'Pitch deck', '10 slides for investors'], ['onepager', 'One-pager', 'The idea on one page'],
  ['elevator', 'Elevator pitches', '10 s, 30 s and 2 min, spoken'], ['landing', 'Landing page copy', 'Headline to FAQ'],
  ['premortem', 'Pre-mortem', 'How it fails a year from now, by the Critic'],
  ['tam', 'Market size model', 'TAM / SAM / SOM with editable assumptions'], ['pricing', 'Pricing options', 'Three models with revenue at scale'],
  ['regulatory', 'Regulatory checklist', 'What the MVP must comply with'],
  ['stores', 'App store scan', 'Competing apps, ratings, complaints · web'], ['forums', 'What people complain about', 'Reddit, forums, reviews · web'],
  ['seo', 'Search demand & keywords', 'What people search for · web'],
];

function openBriefViewer() {
  if (!current?.brief) return;
  const title = current.title;
  let version = 'current'; // or an index into briefHistory
  let showDiff = false;
  openSheet({
    title: 'Idea Brief',
    tall: true,
    render(s) {
      const draw = () => {
        const history = current.briefHistory || [];
        const brief = version === 'current' ? current.brief : history[version].content;
        const prev = version === 'current' ? history[history.length - 1]?.content : history[version - 1]?.content;
        const extras = current.extras || {};
        s.body.innerHTML = `
          ${history.length ? `<div class="version-row">${history.map((h, i) => `<button class="chip-btn${version === i ? ' on' : ''}" data-ver="${i}">v${i + 1}</button>`).join('')}<button class="chip-btn${version === 'current' ? ' on' : ''}" data-ver="current">v${history.length + 1} · latest</button></div>` : ''}
          <div class="btn-pair" style="margin-bottom:16px">
            <button class="wide-btn soft" data-act="copy">Copy</button>
            <button class="wide-btn soft" data-act="share">Share</button>
            ${prev ? `<button class="wide-btn ${showDiff ? 'accent' : 'soft'}" data-act="diff">${showDiff ? 'Hide changes' : 'What changed'}</button>` : ''}
          </div>
          ${showDiff && prev ? diffHtml(prev, brief) : `<div class="md a-body">${md(brief)}</div>`}
          ${version === 'current' ? `
          <div class="sb-label" style="padding:22px 6px 8px">From this brief</div>
          ${EXTRA_KINDS.map(([k, name, sub]) => `<button class="row" data-extra="${k}">${ic('doc')}<span class="row-label">${name}<span class="row-sub">${extras[k] ? `Ready · ${new Date(extras[k].ts).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : sub}</span></span><span class="row-value">${extras[k] ? 'Open' : 'Write'}</span><span class="row-chev">${ic('chevR')}</span></button>`).join('')}
          ${Object.values(extras).filter((x) => x.kind === 'comparison').map((x) => `<button class="row" data-extra="compare_${esc(x.otherId)}">${ic('fork')}<span class="row-label">${esc(x.title)}<span class="row-sub">Ready · ${new Date(x.ts).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span></span><span class="row-value">Open</span><span class="row-chev">${ic('chevR')}</span></button>`).join('')}
          <button class="row" data-act="names">${ic('globe')}<span class="row-label">Check the name<span class="row-sub">Domains and handles for “${esc(briefTitle(current.brief))}”</span></span><span class="row-chev">${ic('chevR')}</span></button>` : ''}`;
      };
      draw();
      s.body.onclick = async (e) => {
        const ver = e.target.closest('[data-ver]');
        if (ver) { version = ver.dataset.ver === 'current' ? 'current' : Number(ver.dataset.ver); showDiff = false; draw(); return; }
        const ex = e.target.closest('[data-extra]');
        if (ex) {
          const kind = ex.dataset.extra;
          if (current.extras?.[kind]) return openExtraViewer(kind);
          ex.querySelector('.row-value').textContent = 'Writing…';
          ex.disabled = true;
          try {
            await api(`/api/ideas/${current.id}/extras`, { method: 'POST', body: JSON.stringify({ kind }) });
            await openIdea(current.id, { silent: true });
            draw();
            openExtraViewer(kind);
          } catch (err) { toast(err.message); draw(); }
          return;
        }
        const act = e.target.closest('[data-act]')?.dataset.act;
        const brief = version === 'current' ? current.brief : (current.briefHistory || [])[version]?.content;
        if (act === 'diff') { showDiff = !showDiff; draw(); }
        if (act === 'names') openNamesSheet();
        if (act === 'copy' && await copyText(brief)) toast('Brief copied');
        if (act === 'share') {
          if (navigator.share) { try { await navigator.share({ title, text: brief }); } catch {} }
          else if (await copyText(brief)) toast('Brief copied');
        }
      };
    },
  });
}

function openExtraViewer(kind) {
  const x = current?.extras?.[kind];
  if (!x) return;
  const a = agentOf(x.agentId);
  openSheet({
    title: x.title,
    tall: true,
    render(s) {
      s.body.innerHTML = `
        <div class="doc-by" style="--agent-color:${esc(a.color)}"><span class="a-avatar">${a.emoji}</span><span>${esc(a.name)} · ${new Date(x.ts).toLocaleDateString([], { month: 'short', day: 'numeric' })}${x.briefRound && current.briefRound && x.briefRound !== current.briefRound ? ' · written for an earlier brief' : ''}</span></div>
        <div class="btn-pair" style="margin-bottom:16px">
          <button class="wide-btn soft" data-act="copy">Copy</button>
          <button class="wide-btn soft" data-act="share">Share</button>
          <button class="wide-btn soft" data-act="redo">Rewrite</button>
        </div>
        <div class="md a-body">${md(x.content)}</div>`;
      s.body.onclick = async (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'copy' && await copyText(x.content)) toast('Copied');
        if (act === 'share') {
          if (navigator.share) { try { await navigator.share({ title: `${current.title} — ${x.title}`, text: x.content }); } catch {} }
          else if (await copyText(x.content)) toast('Copied');
        }
        if (act === 'redo') {
          toast('Rewriting…');
          try { await api(`/api/ideas/${current.id}/extras`, { method: 'POST', body: JSON.stringify({ kind }) }); await openIdea(current.id, { silent: true }); s.close(); openExtraViewer(kind); } catch (err) { toast(err.message); }
        }
      };
    },
  });
}

function openNamesSheet() {
  if (!current) return;
  openSheet({
    title: 'Name check',
    tall: true,
    render(s) {
      const run = async (name) => {
        s.body.innerHTML = `<label class="field"><span>Name</span><input id="name-q" type="text" value="${esc(name)}" maxlength="40"></label><p class="sheet-intro">Checking domains…</p>`;
        $('name-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') run($('name-q').value.trim()); });
        let r;
        try { r = await api(`/api/ideas/${current.id}/names?name=${encodeURIComponent(name)}`); } catch (e) { s.body.insertAdjacentHTML('beforeend', `<p class="sheet-intro">${esc(e.message)}</p>`); return; }
        s.body.querySelector('.sheet-intro').outerHTML = `
          ${r.names.map((n) => `<div class="sb-label" style="padding:10px 6px 6px">${esc(n.name)}</div><div class="domain-grid">${n.domains.map((d) => `<span class="domain ${d.status}">${esc(d.domain)}<em>${d.status}</em></span>`).join('')}</div>`).join('')}
          <div class="sb-label" style="padding:14px 6px 6px">Handles to check</div>
          ${r.handles.map((h) => `<a class="row" href="${esc(h.url)}" target="_blank" rel="noopener">${ic('link')}<span class="row-label">${esc(h.site)}</span><span class="row-chev">${ic('chevR')}</span></a>`).join('')}
          <p class="sheet-intro" style="margin-top:10px">${esc(r.note)}</p>`;
      };
      run(briefTitle(current.brief || '') || current.title);
    },
  });
}

function openBriefsSheet() {
  openSheet({
    title: 'Idea Briefs',
    tall: true,
    render(s) {
      const done = ideas.filter((i) => i.hasBrief);
      s.body.innerHTML = done.length
        ? done.map((i) => `<button class="row" data-id="${i.id}">${ic('doc')}<span class="row-label">${esc(i.title)}<span class="row-sub">${new Date(i.lastActivity).toLocaleDateString()}</span></span><span class="row-chev">${ic('chevR')}</span></button>`).join('')
        : '<p class="sheet-intro">No briefs yet. Each idea gets one when its debate concludes.</p>';
      s.body.onclick = async (e) => {
        const b = e.target.closest('[data-id]');
        if (!b) return;
        s.close();
        location.hash = `#/idea/${b.dataset.id}`;
        await openIdea(b.dataset.id);
        openBriefViewer();
      };
    },
  });
}

function openSettingsSheet() {
  openSheet({
    title: 'Settings',
    render(s) {
      const draw = () => {
        s.body.innerHTML = `
          <div class="account-card"><span class="avatar-btn" style="width:40px;height:40px;font-size:16px">${esc(((ME?.firstName || 'B')[0] || 'B').toUpperCase())}</span><span style="min-width:0"><div class="brief-title">${esc(`${ME?.firstName || ''} ${ME?.lastName || ''}`.trim() || 'You')}</div><div class="brief-sub">${esc(ME?.email || '')}${isAdminUser() ? ' · administrator' : ''}</div></span></div>
          ${ME?.weakPassword ? '<div class="form-error" style="margin-bottom:10px">Your password is the initial one. Change it now.</div>' : ''}
          <div class="btn-pair" style="margin-bottom:14px"><button class="wide-btn soft" data-open="password">Change password</button><button class="wide-btn soft" data-open="signout">Sign out</button></div>
          ${isAdminUser() ? `<button class="row" data-open="people">${ic('users')}<span class="row-label">People<span class="row-sub">Access requests and members</span></span><span class="row-value">${pendingUsers ? `${pendingUsers} waiting` : ''}</span><span class="row-chev">${ic('chevR')}</span></button>` : ''}
          <label class="field" style="margin-top:14px"><span>Greeting name</span><input id="set-name" type="text" maxlength="40" placeholder="${esc(ME?.firstName || 'Used in your greeting')}" value="${esc(settings.name)}"></label>
          <div class="sb-label" style="padding:6px 6px 8px">Appearance</div>
          ${['system', 'dark', 'light'].map((t) => `<button class="row check" data-theme="${t}"><span class="row-label">${t[0].toUpperCase() + t.slice(1)}</span><span class="row-value">${settings.theme === t ? ic('check') : ''}</span></button>`).join('')}
          <div class="sb-label" style="padding:14px 6px 8px">Notifications</div>
          <button class="row" data-push="toggle" id="push-row"><span class="row-label">Phone notifications<span class="row-sub" id="push-sub">Checking…</span></span><span class="row-value" id="push-val"></span></button>
          <button class="row" id="progress-row" data-progress="1"><span class="row-label">Progress on the lock screen<span class="row-sub">One quiet notification per project that updates in place as each agent or task finishes.</span></span><span class="row-value" id="progress-val">…</span></button>
          <div class="sb-label" style="padding:14px 6px 8px">Agent time</div>
          <div class="row" style="cursor:default" id="usage-row"><span class="row-label">This month<span class="row-sub" id="usage-sub">Loading…</span></span><span class="row-value" id="usage-val"></span></div>
          <label class="field" style="margin-top:8px"><span>Monthly cap (hours of agent time; 0 = no cap). Box warns at 80 percent.</span><input id="set-cap" type="number" min="0" max="999" step="1" value="${Number(settings.capHours || 0)}"></label>
          <div class="sb-label" style="padding:14px 6px 8px">What the room knows about you</div>
          <label class="field"><span>Every agent reads this before every turn: your goals, constraints, preferences (e.g. “solo founder, no ads, prefer B2B, based in Texas”).</span><textarea id="set-about" rows="4" maxlength="2000" placeholder="About you and how you want ideas judged…"></textarea></label>
          <div id="knowledge-list"></div>
          <button class="wide-btn soft" data-open="knowledge">Add knowledge files</button>
          <p class="hint" style="margin-top:6px">Text, PDF or images attached to every debate and crew turn: your resume, a market report, brand guidelines.</p>
          <div class="sb-label" style="padding:14px 6px 8px">Library</div>
          <button class="row" data-open="sources">${ic('link')}<span class="row-label">Source library<span class="row-sub">Every link the researchers cited</span></span><span class="row-chev">${ic('chevR')}</span></button>
          <a class="row" href="/api/export" download>${ic('download')}<span class="row-label">Export everything<span class="row-sub">A zip with every idea, transcript, brief, document and prototype</span></span><span class="row-chev">${ic('chevR')}</span></a>
          <p class="sheet-intro" style="margin-top:10px">Box runs every agent through your Claude subscription on your server. ${AGENTS.length} agents in the room.</p>`;
        $('set-cap').addEventListener('change', (e) => { settings.capHours = Math.max(0, Number(e.target.value) || 0); saveSettings(); checkSpending(); });
        const drawKnowledge = (p) => {
          $('set-about').value = p.about || '';
          $('progress-val').textContent = p.progressPush === false ? 'Off' : 'On';
          $('progress-row').dataset.on = p.progressPush === false ? '0' : '1';
          $('knowledge-list').innerHTML = (p.knowledge || []).map((k) => `<div class="row" style="cursor:default">${ic('doc')}<span class="row-label">${esc(k.name)}<span class="row-sub">${fileLabel(k)}</span></span><button class="icon-btn" data-kdel="${k.id}" aria-label="Remove">${ic('trash')}</button></div>`).join('');
        };
        api('/api/prefs').then(drawKnowledge).catch(() => {});
        let aboutTimer;
        $('set-about').addEventListener('input', () => { clearTimeout(aboutTimer); aboutTimer = setTimeout(() => api('/api/prefs', { method: 'POST', body: JSON.stringify({ about: $('set-about').value }) }).catch(() => {}), 600); });
        s.body.addEventListener('click', async (e) => {
          const pr = e.target.closest('[data-progress]');
          if (pr) { try { drawKnowledge(await api('/api/prefs', { method: 'POST', body: JSON.stringify({ progressPush: pr.dataset.on !== '1' }) })); } catch (err) { toast(err.message); } return; }
          const del = e.target.closest('[data-kdel]');
          if (del) { try { drawKnowledge(await api(`/api/prefs/knowledge/${del.dataset.kdel}`, { method: 'DELETE' })); } catch (err) { toast(err.message); } return; }
          if (e.target.closest('[data-open="knowledge"]')) {
            const input = document.createElement('input');
            input.type = 'file'; input.multiple = true; input.accept = 'image/*,application/pdf,.pdf,.txt,.md,.csv,.json';
            input.onchange = async () => {
              const ids = [];
              for (const f of [...input.files].slice(0, 6)) {
                try { const meta = await api(`/api/uploads?name=${encodeURIComponent(f.name)}`, { method: 'POST', headers: { 'Content-Type': f.type || guessType(f.name) }, body: f }); ids.push(meta.id); } catch (err) { toast(`${f.name}: ${err.message}`); }
              }
              if (ids.length) { try { drawKnowledge(await api('/api/prefs/knowledge', { method: 'POST', body: JSON.stringify({ attachments: ids }) })); toast('Added'); } catch (err) { toast(err.message); } }
            };
            input.click();
          }
        });
        api('/api/overview').then((o) => {
          const u = o.usage;
          const sub = $('usage-sub'); const val = $('usage-val');
          if (!sub) return;
          val.textContent = fmtDuration(u.monthMs);
          sub.textContent = `${u.monthTurns} agent turns · ${fmtDuration(u.totalMs)} all time${u.byIdea[0] ? ` · most: ${u.byIdea[0].title} (${fmtDuration(u.byIdea[0].ms)})` : ''}`;
        }).catch(() => {});
        $('set-name').addEventListener('input', (e) => {
          settings.name = e.target.value.trim();
          saveSettings(); renderAvatar();
          if (route.view === 'new') $('greeting').textContent = greeting();
        });
        pushState().then((st) => {
          const sub = $('push-sub'); const val = $('push-val');
          if (!sub) return;
          const text = {
            on: ['On — briefs, approvals, finished sites, and a badge on the icon', 'On'],
            off: ['Off — tap to turn on', 'Off'],
            denied: ['Blocked in iPhone Settings → Notifications → Box', '—'],
            homescreen: ['Add Box to your Home Screen (Share → Add to Home Screen), then open it from the icon', '—'],
            unsupported: ['Not available in this browser', '—'],
          }[st];
          sub.textContent = text[0]; val.textContent = text[1];
          $('push-row').dataset.state = st;
        });
      };
      draw();
      s.body.onclick = async (e) => {
        if (e.target.closest('[data-open="sources"]')) { s.close(); openSourcesSheet(); return; }
        if (e.target.closest('[data-open="people"]')) { s.close(); openPeopleSheet(); return; }
        if (e.target.closest('[data-open="password"]')) { s.close(); openPasswordSheet(); return; }
        if (e.target.closest('[data-open="signout"]')) {
          const ok = await dialog({ title: 'Sign out?', text: 'Notifications stay on for this device.', confirm: 'Sign out' });
          if (!ok) return;
          try { await api('/api/logout', { method: 'POST', body: '{}' }); } catch {}
          try { const ks = await caches.keys(); await Promise.all(ks.map((k) => caches.delete(k))); } catch {}
          location.reload();
          return;
        }
        const pr = e.target.closest('[data-push]');
        if (pr) {
          const st = pr.dataset.state;
          if (st === 'on') { await disablePush(); draw(); }
          else if (st === 'off') { await enablePush(); draw(); }
          else if (st === 'homescreen') toast('Open Box from its Home Screen icon to turn on notifications.');
          return;
        }
        const b = e.target.closest('[data-theme]');
        if (!b) return;
        settings.theme = b.dataset.theme;
        saveSettings(); applyTheme(); draw();
      };
    },
  });
}

// ---------- agents sheet ----------
async function loadAgents() {
  try {
    const [agents, crew] = await Promise.all([api('/api/agents'), api('/api/crew').catch(() => [])]);
    AGENTS = agents;
    AGENT_MAP = Object.fromEntries([...crew, ...AGENTS].map((a) => [a.id, a]));
  } catch {}
  renderTop();
  if (current) renderThread();
}

function openAgentsSheet(opts = {}) {
  let draft = null;
  let editing = null; // id of an added agent being edited
  let presets = null;
  openSheet({
    title: 'Agents',
    tall: true,
    render(s) {
      const modelName = (m) => ({ sonnet: 'Sonnet — balanced', opus: 'Opus — deepest', haiku: 'Haiku — fastest' }[m] || m);
      const list = () => {
        s.setTitle('Agents');
        s.setBack(null);
        s.body.innerHTML = `
          <p class="sheet-intro">The Orchestrator reads each idea and picks 4–7 specialists for it. The two researchers search the web before every debate. Agents you add always take part.</p>
          ${(() => {
            const row = (a) => `<div class="ag-row" style="--agent-color:${esc(a.color)}">
              <span class="a-avatar">${a.emoji}</span>
              <span class="ag-main">
                <span class="ag-top"><span class="a-name">${esc(a.name)}</span><span class="ag-tag">${a.id === 'orchestrator' ? 'chair' : a.research ? 'web research' : a.builtin ? (a.core ? 'core' : 'specialist') : 'added · always joins'} · ${esc(a.model)}</span></span>
                <span class="ag-desc">${esc(a.description || '')}</span>
                <span class="ag-actions">
                  ${a.builtin && a.id !== 'orchestrator' ? `<button class="chip-btn" data-clone="${a.id}">Clone & edit</button>` : ''}
                  ${a.builtin ? '' : `<button class="chip-btn" data-edit="${a.id}">Edit</button><button class="chip-btn" data-remove="${a.id}">Remove</button>`}
                </span>
              </span>
            </div>`;
            const chair = AGENTS.filter((a) => a.id === 'orchestrator');
            const research = AGENTS.filter((a) => a.research);
            const pool = AGENTS.filter((a) => a.builtin && !a.research && a.id !== 'orchestrator');
            const custom = AGENTS.filter((a) => !a.builtin);
            const grp = (t, arr) => arr.length ? `<div class="sb-label" style="padding:12px 6px 8px">${t}</div>${arr.map(row).join('')}` : '';
            return grp('Chair', chair) + grp('Research, before every debate', research) + grp('Specialist pool', pool) + grp('Your agents', custom);
          })()}
          <div class="btn-pair" style="margin-top:6px">
            <button class="wide-btn soft" data-act="market">Marketplace</button>
            <button class="wide-btn accent" data-act="add">Add an agent</button>
          </div>
          <button class="row" data-act="guest" style="margin-top:10px">${ic('mic')}<span class="row-label">Guest expert from a transcript<span class="row-sub">Paste an interview, talk or writing by someone; an agent speaks for them.</span></span><span class="row-chev">${ic('chevR')}</span></button>`;
      };
      const guestForm = (err = '') => {
        s.setTitle('Guest expert');
        s.setBack(list);
        s.body.innerHTML = `
          <label class="field"><span>Name</span><input id="gx-name" type="text" maxlength="40" placeholder="e.g. Maria Chen"></label>
          <label class="field"><span>What they said or wrote</span><textarea id="gx-text" rows="10" maxlength="40000" placeholder="Paste a transcript, interview, blog posts or notes — at least a few paragraphs."></textarea></label>
          <div class="hint">Box writes the agent's instructions from this material only; it never invents biography. You can edit the result.</div>
          ${err ? `<div class="form-error">${esc(err)}</div>` : ''}
          <button class="wide-btn accent" data-act="guest-create">Create the guest</button>`;
      };
      const market = async () => {
        s.setTitle('Marketplace');
        s.setBack(list);
        s.body.innerHTML = '<p class="sheet-intro">Loading…</p>';
        try { presets = (await api('/api/agents/presets')).presets; } catch (e) { s.body.innerHTML = `<p class="sheet-intro">${esc(e.message)}</p>`; return; }
        s.body.innerHTML = `<p class="sheet-intro">Ready-made specialists. Install one and it joins every debate like an agent you wrote yourself; you can edit it afterwards.</p>
          ${presets.map((p) => `<div class="ag-row"><span class="a-avatar">${p.emoji}</span><span class="ag-main">
              <span class="ag-top"><span class="a-name">${esc(p.name)}</span></span>
              <span class="ag-desc">${esc(p.instructions.slice(0, 160))}…</span>
              <span class="ag-actions">${p.installed ? '<span class="ag-tag">installed</span>' : `<button class="chip-btn" data-install="${p.id}">Install</button>`}<button class="chip-btn" data-preset-edit="${p.id}">Edit first</button></span>
            </span></div>`).join('')}`;
      };
      const form = (err = '') => {
        s.setTitle(editing ? 'Edit agent' : 'New agent');
        s.setBack(list);
        const d = draft || { name: '', emoji: '', model: 'sonnet', instructions: '', traits: {} };
        const sel = (k, label) => `<label class="field"><span>${label}</span><select data-trait="${k}">
            <option value="low"${d.traits?.[k] === 'low' ? ' selected' : ''}>${{ optimism: 'Skeptical', risk: 'Cautious', verbosity: 'Terse' }[k]}</option>
            <option value="mid"${!d.traits?.[k] || d.traits[k] === 'mid' ? ' selected' : ''}>Balanced</option>
            <option value="high"${d.traits?.[k] === 'high' ? ' selected' : ''}>${{ optimism: 'Optimistic', risk: 'Bold', verbosity: 'Thorough' }[k]}</option>
          </select></label>`;
        s.body.innerHTML = `
          <label class="field"><span>Name</span><input id="ag-name" type="text" maxlength="40" placeholder="e.g. Legal Advisor" value="${esc(d.name)}"></label>
          <div class="field-row">
            <label class="field icon"><span>Icon</span><input id="ag-emoji" type="text" maxlength="8" placeholder="🤖" value="${esc(d.emoji)}"></label>
            <label class="field"><span>Model</span><select id="ag-model">
              <option value="sonnet">Sonnet — balanced</option>
              <option value="opus">Opus — deepest</option>
              <option value="haiku">Haiku — fastest</option>
            </select></label>
          </div>
          <label class="field"><span>Instructions</span><textarea id="ag-instructions" rows="8" maxlength="3000" placeholder="Who is this agent and what should it push on? For example: You are a startup lawyer. Flag regulatory, privacy and IP risks, rate each one, and propose the cheapest way to stay compliant at MVP stage.">${esc(d.instructions)}</textarea></label>
          <div class="hint"><span id="ag-count">${d.instructions.length}</span> / 3000 · at least 30 characters: the role, what it focuses on, and how it argues.</div>
          <div class="sb-label" style="padding:10px 4px 6px">Temperament</div>
          <div class="field-row three">${sel('optimism', 'Outlook')}${sel('risk', 'Risk appetite')}${sel('verbosity', 'Length')}</div>
          ${err ? `<div class="form-error">${esc(err)}</div>` : ''}
          <button class="wide-btn" data-act="review">${editing ? 'Save changes' : 'Review'}</button>`;
        $('ag-model').value = d.model;
        $('ag-instructions').addEventListener('input', (e) => { $('ag-count').textContent = e.target.value.length; });
        if (!d.name) setTimeout(() => $('ag-name')?.focus(), 60);
      };
      const read = () => ({
        name: $('ag-name').value.trim(),
        emoji: $('ag-emoji').value.trim() || '🤖',
        model: $('ag-model').value,
        instructions: $('ag-instructions').value.trim(),
        traits: Object.fromEntries([...s.body.querySelectorAll('[data-trait]')].map((el) => [el.dataset.trait, el.value])),
      });
      const confirmView = (err = '') => {
        s.setTitle('Confirm new agent');
        s.setBack(() => form());
        s.body.innerHTML = `
          <p class="sheet-intro">Check this before adding. Nothing is saved until you confirm.</p>
          <div class="preview-card">
            <div class="pv-head"><span class="pv-emoji">${esc(draft.emoji)}</span><span class="pv-name">${esc(draft.name)}</span></div>
            <div class="pv-model">Model: ${modelName(draft.model)}</div>
            <div class="pv-label">Instructions</div>
            <div class="pv-text">${esc(draft.instructions)}</div>
          </div>
          <ul class="notes">
            <li>Speaks once per round in every idea: new ones right away, running ones from their next round.</li>
            <li>Each round costs one more Claude call per debate, which counts toward your Claude limits.</li>
            <li>You can edit or remove it any time from this screen.</li>
          </ul>
          ${err ? `<div class="form-error">${esc(err)}</div>` : ''}
          <div class="btn-pair">
            <button class="wide-btn soft" data-act="edit">Edit</button>
            <button class="wide-btn accent" data-act="confirm">Confirm &amp; add</button>
          </div>`;
      };
      const startEdit = (id) => {
        const a = AGENT_MAP[id];
        if (!a) return;
        editing = id;
        draft = { name: a.name, emoji: a.emoji, model: a.model, instructions: a.instructions || '', traits: a.traits || {} };
        form();
      };
      const startClone = (id) => {
        const a = AGENT_MAP[id];
        if (!a) return;
        editing = null;
        draft = { name: `${a.name} (mine)`, emoji: a.emoji, model: a.model, instructions: a.description ? `${a.description}\n\nYou are a variant of the built-in ${a.name}. ` : '', traits: {} };
        form();
      };
      if (opts.edit) startEdit(opts.edit); else list();
      s.body.onclick = async (e) => {
        const rm = e.target.closest('[data-remove]');
        if (rm) {
          const a = AGENT_MAP[rm.dataset.remove];
          const ok = await dialog({ title: `Remove ${a.name}?`, text: 'It stops speaking in all debates from their next turn. Its past messages stay.', confirm: 'Remove', danger: true });
          if (!ok) return;
          try {
            await api(`/api/agents/${a.id}`, { method: 'DELETE' });
            await loadAgents(); list();
            toast(`${a.name} left the room`);
          } catch (err) { toast(err.message); }
          return;
        }
        const inst = e.target.closest('[data-install]');
        if (inst) {
          inst.disabled = true; inst.textContent = 'Installing…';
          try { const a = await api(`/api/agents/presets/${inst.dataset.install}`, { method: 'POST', body: '{}' }); await loadAgents(); toast(`${a.emoji} ${a.name} joined the room`); market(); } catch (err) { toast(err.message); market(); }
          return;
        }
        const pe = e.target.closest('[data-preset-edit]');
        if (pe) {
          const p = presets.find((x) => x.id === pe.dataset.presetEdit);
          editing = null; draft = { name: p.name, emoji: p.emoji, model: 'sonnet', instructions: p.instructions, traits: {} }; form();
          return;
        }
        const cl = e.target.closest('[data-clone]');
        if (cl) { startClone(cl.dataset.clone); return; }
        const ed = e.target.closest('[data-edit]');
        if (ed) { startEdit(ed.dataset.edit); return; }
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'market') market();
        if (act === 'guest') guestForm();
        if (act === 'guest-create') {
          const btn = e.target.closest('button');
          btn.disabled = true; btn.textContent = 'Reading the material…';
          try {
            const a = await api('/api/agents/from-text', { method: 'POST', body: JSON.stringify({ name: $('gx-name').value, text: $('gx-text').value }) });
            await loadAgents(); toast(`${a.emoji} ${a.name} joined the room`); list();
          } catch (err) { guestForm(err.message); }
          return;
        }
        if (act === 'add') { draft = null; editing = null; form(); }
        if (act === 'review') {
          const d = read();
          draft = d;
          if (d.name.length < 2) return form('Give the agent a name (at least 2 characters).');
          if (!editing && AGENTS.some((a) => a.name.toLowerCase() === d.name.toLowerCase())) return form(`An agent named “${d.name}” is already in the room.`);
          if ([...d.emoji].length > 4) return form('Use a single emoji for the icon.');
          if (d.instructions.length < 30) return form('Instructions need at least 30 characters.');
          if (editing) {
            try { await api(`/api/agents/${editing}`, { method: 'PATCH', body: JSON.stringify(d) }); await loadAgents(); toast('Agent updated'); editing = null; draft = null; list(); } catch (err) { form(err.message); }
            return;
          }
          confirmView();
        }
        if (act === 'edit') form();
        if (act === 'confirm') {
          const btn = e.target.closest('button');
          btn.disabled = true; btn.textContent = 'Adding…';
          try {
            const agent = await api('/api/agents', { method: 'POST', body: JSON.stringify(draft) });
            draft = null;
            await loadAgents(); list();
            toast(`${agent.emoji} ${agent.name} joined the room`);
          } catch (err) { confirmView(err.message); }
        }
      };
    },
  });
}

// ---------- live events ----------
// The version of the app shell this page loaded with. When the server reports
// a different one (after a deploy), the page reloads itself so a phone never
// keeps using an old copy of Box.
let APP_VERSION = null;
function checkVersion(v) {
  if (!v) return;
  if (!APP_VERSION) { APP_VERSION = v; return; }
  if (v !== APP_VERSION) {
    try { caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))); } catch {}
    location.reload();
  }
}

function handleEvent(ev) {
  const mine = current && ev.ideaId === current.id;
  switch (ev.event) {
    case 'hello':
      checkVersion(ev.version);
      refreshIdeas();
      if (current) openIdea(current.id, { silent: true });
      break;
    case 'message':
      if (mine && !current.messages.some((m) => m.id === ev.message.id)) {
        current.messages.push(ev.message);
        if (ev.message.round) current.round = Math.max(current.round, ev.message.round);
        if (thinking && thinking.agentId === ev.message.agentId) thinking = null;
        renderThread(); renderTop();
      }
      refreshIdeasSoon();
      break;
    case 'agent_thinking':
      if (mine) {
        thinking = { agentId: ev.agentId, label: ev.label || null, since: Date.now() };
        if (ev.round) current.round = ev.round;
        current.status = 'running';
        renderThread(); renderTop(); renderDock();
      }
      break;
    case 'status':
      if (mine) {
        current.status = ev.status;
        current.error = ev.error || null;
        thinking = null;
        lastActivity = null;
        if (ev.status === 'done' || ev.status === 'paused' || ev.status === 'idle') openIdea(current.id, { silent: true });
        else { renderThread(); renderTop(); renderDock(); }
      }
      refreshIdeasSoon();
      break;
    case 'activity':
      if (mine && current.project) {
        lastActivity = { tool: ev.tool, text: ev.text, agentId: ev.agentId };
        current.project.activity = [...(current.project.activity || []), lastActivity].slice(-40);
        const line = document.querySelector('.act-line');
        if (line && !expanded.has('activity')) {
          line.querySelector('.act-tool').textContent = ACT_LABEL[ev.tool] || ev.tool;
          line.querySelector('.act-tool').className = `act-tool ${ev.tool}`;
          line.querySelector('.act-text').textContent = ev.text;
        } else renderThread();
      }
      break;
    case 'extras':
      if (mine) openIdea(current.id, { silent: true });
      break;
    case 'promoted':
    case 'docs':
      if (mine) openIdea(current.id, { silent: true });
      refreshIdeasSoon();
      break;
    case 'stage':
      if (mine && current.project) {
        current.project.stage = ev.stage;
        if (['review', 'deploy_setup', 'maintenance'].includes(ev.stage)) openIdea(current.id, { silent: true });
        else { renderTop(); renderThread(); renderDock(); }
      }
      refreshIdeasSoon();
      break;
    case 'tasks':
      if (mine && current.project) {
        current.project.tasks = ev.tasks;
        renderThread();
        const open = $('layer').querySelector('.sheet');
        if (open && open.parentElement._redraw) open.parentElement._redraw();
      }
      break;
    case 'round':
      if (mine) { current.round = ev.round; renderTop(); }
      break;
    case 'roster':
      if (mine) { current.roster = ev.roster; renderThread(); }
      break;
    case 'renamed': {
      const i = ideas.find((x) => x.id === ev.ideaId);
      if (i) i.title = ev.title;
      if (mine) { current.title = ev.title; renderTop(); }
      renderSidebar();
      break;
    }
    case 'ideas_changed':
      refreshIdeasSoon();
      if (current && ev.deleted === current.id) location.hash = '#/';
      break;
    case 'agents_changed':
      loadAgents();
      break;
    case 'users_changed':
      refreshPending();
      { const open = $('layer').querySelector('.backdrop'); if (open && open._redraw) open._redraw(); }
      break;
  }
}
function connectEvents() {
  const es = new EventSource('/api/events');
  es.onmessage = (e) => { try { handleEvent(JSON.parse(e.data)); } catch {} };
}

// ---------- boot ----------
// ---------- sign-in ----------
function showLogin(view = 'login', ctx = {}) {
  $('login')?.remove();
  const el = document.createElement('div');
  el.id = 'login';
  const field = (id, label, type, extra = '') => `<label class="field"><span>${label}</span><input id="${id}" type="${type}" ${extra}></label>`;
  const views = {
    login: `<h1>Welcome back</h1><p>Sign in to Box.</p>
      ${field('lg-email', 'Email', 'email', 'autocomplete="username" inputmode="email" required')}
      ${field('lg-pw', 'Password', 'password', 'autocomplete="current-password" required')}
      <div class="form-error hidden" id="login-err"></div>
      <button class="wide-btn" type="submit">Sign in</button>
      <div class="login-links"><button type="button" data-view="forgot">Forgot password</button><button type="button" data-view="signup">Request access</button></div>`,
    signup: `<h1>Request access</h1><p>The administrator approves requests. You get an email with a link to set your password.</p>
      <div class="field-row">${field('su-first', 'First name', 'text', 'autocomplete="given-name" maxlength="60" required')}${field('su-last', 'Last name', 'text', 'autocomplete="family-name" maxlength="60" required')}</div>
      ${field('su-phone', 'Contact number', 'tel', 'autocomplete="tel" inputmode="tel" required')}
      ${field('su-email', 'Email', 'email', 'autocomplete="email" inputmode="email" required')}
      <div class="form-error hidden" id="login-err"></div>
      <button class="wide-btn" type="submit">Send request</button>
      <div class="login-links"><button type="button" data-view="login">Back to sign in</button></div>`,
    forgot: `<h1>Reset password</h1><p>Enter your email. If it has an approved account, a reset link follows.</p>
      ${field('fg-email', 'Email', 'email', 'autocomplete="username" inputmode="email" required')}
      <div class="form-error hidden" id="login-err"></div>
      <button class="wide-btn" type="submit">Send link</button>
      <div class="login-links"><button type="button" data-view="login">Back to sign in</button></div>`,
    reset: `<h1>Set your password</h1><p>${ctx.email ? `For ${esc(ctx.email)}. ` : ''}At least 8 characters; a few words you will remember work best.</p>
      ${field('rs-pw', 'New password', 'password', 'autocomplete="new-password" minlength="8" required')}
      ${field('rs-pw2', 'Repeat it', 'password', 'autocomplete="new-password" minlength="8" required')}
      <div class="form-error hidden" id="login-err"></div>
      <button class="wide-btn" type="submit">Save password</button>`,
    done: `<h1>${esc(ctx.title || 'Done')}</h1><p>${esc(ctx.text || '')}</p><button class="wide-btn" type="submit">Sign in</button>`,
  };
  el.innerHTML = `<form class="login-box"><div class="welcome-mark">${ic('spark')}</div>${views[view]}</form>`;
  document.body.appendChild(el);
  const form = el.querySelector('form');
  const err = (m) => { const e = $('login-err'); if (e) { e.textContent = m; e.classList.remove('hidden'); } };
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) showLogin(b.dataset.view); });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    const post = async (path, body) => {
      const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Something went wrong.');
      return data;
    };
    try {
      if (view === 'login') { await post('/api/login', { email: $('lg-email').value, password: $('lg-pw').value }); location.hash = location.hash.startsWith('#/reset') ? '#/' : location.hash; location.reload(); }
      else if (view === 'signup') { const r = await post('/api/signup', { firstName: $('su-first').value, lastName: $('su-last').value, phone: $('su-phone').value, email: $('su-email').value }); showLogin('done', { title: 'Request sent', text: r.message }); }
      else if (view === 'forgot') { const r = await post('/api/forgot', { email: $('fg-email').value }); showLogin('done', { title: 'Check your email', text: r.message }); }
      else if (view === 'reset') {
        if ($('rs-pw').value !== $('rs-pw2').value) throw new Error('The two passwords differ.');
        await post('/api/reset', { token: ctx.token, password: $('rs-pw').value });
        history.replaceState(null, '', '/#/');
        showLogin('done', { title: 'Password saved', text: 'Sign in with your email and new password.' });
      } else if (view === 'done') { showLogin('login'); }
    } catch (ex) { err(ex.message); btn.disabled = false; }
  };
  setTimeout(() => form.querySelector('input')?.focus(), 100);
}

/** Change password (signed in). */
function openPasswordSheet() {
  openSheet({
    title: 'Change password',
    render(s) {
      s.body.innerHTML = `
        <label class="field"><span>Current password</span><input id="cp-cur" type="password" autocomplete="current-password"></label>
        <label class="field"><span>New password</span><input id="cp-new" type="password" autocomplete="new-password" minlength="8"></label>
        <label class="field"><span>Repeat it</span><input id="cp-new2" type="password" autocomplete="new-password" minlength="8"></label>
        <div class="hint">At least 8 characters. Other devices are signed out; this one stays signed in.</div>
        <div class="form-error hidden" id="cp-err"></div>
        <button class="wide-btn accent" data-act="save">Save</button>`;
      s.body.onclick = async (e) => {
        if (e.target.closest('[data-act]')?.dataset.act !== 'save') return;
        const err = $('cp-err');
        if ($('cp-new').value !== $('cp-new2').value) { err.textContent = 'The two passwords differ.'; err.classList.remove('hidden'); return; }
        try {
          await api('/api/password', { method: 'POST', body: JSON.stringify({ current: $('cp-cur').value, next: $('cp-new').value }) });
          if (ME) ME.weakPassword = false;
          s.close(); toast('Password changed');
        } catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); }
      };
    },
  });
}

/** Administrator: access requests and members. */
function openPeopleSheet() {
  if (!isAdminUser()) return;
  openSheet({
    title: 'People',
    tall: true,
    render(s) {
      const draw = async () => {
        s.body.innerHTML = '<p class="sheet-intro">Loading…</p>';
        let r;
        try { r = await api('/api/admin/users'); } catch (e) { s.body.innerHTML = `<p class="sheet-intro">${esc(e.message)}</p>`; return; }
        const pending = r.users.filter((u) => u.status === 'pending');
        const members = r.users.filter((u) => u.status !== 'pending');
        const row = (u) => `<div class="ag-row"><span class="a-avatar">${esc((u.firstName || '?')[0].toUpperCase())}</span><span class="ag-main">
            <span class="ag-top"><span class="a-name">${esc(u.name)}</span><span class="ag-tag">${u.primary ? 'primary administrator' : u.role === 'admin' ? `administrator · ${u.status}` : u.status}</span></span>
            <span class="ag-desc">${esc(u.email)}${u.phone ? ` · ${esc(u.phone)}` : ''} · ${u.status === 'pending' ? `asked ${new Date(u.createdAt).toLocaleDateString()}` : u.lastLoginAt ? `last sign-in ${new Date(u.lastLoginAt).toLocaleDateString()}` : 'never signed in'}</span>
            <span class="ag-actions">${u.status === 'pending'
              ? `<button class="chip-btn on" data-u="${u.id}" data-act="approve">Approve</button><button class="chip-btn" data-u="${u.id}" data-act="decline">Decline</button>`
              : u.primary || u.id === ME.id ? '' : `${ME.primary ? (u.role === 'admin' ? `<button class="chip-btn" data-u="${u.id}" data-act="remove-admin">Remove admin</button>` : `<button class="chip-btn on" data-u="${u.id}" data-act="make-admin">Make admin</button>`) : ''}<button class="chip-btn" data-u="${u.id}" data-act="resend">Send set-password link</button>${u.status === 'disabled' ? `<button class="chip-btn" data-u="${u.id}" data-act="enable">Enable</button>` : `<button class="chip-btn" data-u="${u.id}" data-act="disable">Disable</button>`}<button class="chip-btn" data-u="${u.id}" data-act="decline">Remove</button>`}</span>
          </span></div>`;
        s.body.innerHTML = `<p class="sheet-intro">Members see only their own ideas and projects. Administrators see everyone's and can approve people.${ME.primary ? ' Only you can make or remove administrators.' : ''}</p>${r.mailConfigured ? '' : '<div class="system-note"><strong>Email is not set up</strong>Approvals still work: the set-password link is shown here for you to send by hand. Add the SMTP secrets to send it automatically.</div>'}
          <div class="sb-label" style="padding:6px 6px 8px">Access requests${pending.length ? ` <span class="sb-count">${pending.length}</span>` : ''}</div>
          ${pending.map(row).join('') || '<p class="sheet-intro">No requests waiting.</p>'}
          <div class="sb-label" style="padding:14px 6px 8px">Members</div>${members.map(row).join('')}`;
      };
      draw();
      s.body.closest('.backdrop')._redraw = draw;
      s.body.onclick = async (e) => {
        const b = e.target.closest('[data-act][data-u]');
        if (!b) return;
        const act = b.dataset.act;
        if (act === 'decline') { const ok = await dialog({ title: 'Remove this person?', text: 'They lose access and the request is deleted. Their ideas stay.', confirm: 'Remove', danger: true }); if (!ok) return; }
        b.disabled = true;
        try {
          const r = await api(`/api/admin/users/${b.dataset.u}/${act}`, { method: 'POST', body: '{}' });
          if ((act === 'approve' || act === 'resend') && !r.emailed && r.link) {
            await dialog({ title: 'Send this link yourself', text: `Email could not be sent (${r.error || 'SMTP not configured'}). Copy the link and send it to ${r.user.email}. It works once, for 24 hours.`, input: r.link, confirm: 'Done' });
          } else if (act === 'approve') toast(`Approved · set-password email sent to ${r.user.email}`);
          else toast('Done');
          refreshPending();
          draw();
        } catch (ex) { toast(ex.message); b.disabled = false; }
      };
    },
  });
}

(async function boot() {
  applyTheme();
  hydrateIcons();
  renderAvatar();
  const resetMatch = location.hash.match(/^#\/reset\/([A-Za-z0-9_-]{20,})/);
  if (resetMatch) {
    const r = await fetch(`/api/reset?token=${encodeURIComponent(resetMatch[1])}`).then((x) => x.json()).catch(() => ({}));
    if (r.valid) return showLogin('reset', { token: resetMatch[1], email: r.email });
    return showLogin('done', { title: 'Link expired', text: 'This link is no longer valid. Use “Forgot password” to get a new one.' });
  }
  const session = await fetch('/api/session').then((r) => r.json()).catch(() => ({}));
  checkVersion(session.version);
  if (!session.authed) {
    // Keep checking for updates while the sign-in screen is up.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) fetch('/api/session').then((r) => r.json()).then((s) => checkVersion(s.version)).catch(() => {}); });
    return showLogin();
  }
  ME = session.user;
  renderAvatar();
  registerSW();
  refreshPending();
  api('/api/templates').then((t) => { TEMPLATES = t; if (route.view === 'new') renderTemplates(); }).catch(() => {});
  await loadAgents();
  await refreshIdeas();
  await onRoute();
  connectEvents();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    refreshIdeasSoon();
    fetch('/api/session').then((r) => r.json()).then((s) => checkVersion(s.version)).catch(() => {});
    if (swReg) swReg.update().catch(() => {});
  });
  // A newly installed service worker (after a deploy) asks open pages to reload.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'updated' && performance.now() > 10000) location.reload();
    });
  }
  setTimeout(checkSpending, 3000);
  setInterval(checkSpending, 30 * 60 * 1000);
})();

/** Spending guard: warn once a day when agent time passes 80 percent of the cap. */
async function checkSpending() {
  const cap = Number(settings.capHours || 0);
  if (!cap) return;
  let o;
  try { o = await api('/api/overview'); } catch { return; }
  const hours = o.usage.monthMs / 3600000;
  const pct = Math.round((hours / cap) * 100);
  if (pct < 80) return;
  const key = `box-cap-warned-${new Date().toISOString().slice(0, 10)}-${pct >= 100 ? 'over' : 'near'}`;
  try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch {}
  toast(pct >= 100 ? `Agent time is over your ${cap} h monthly cap (${hours.toFixed(1)} h used)` : `Agent time at ${pct}% of your ${cap} h monthly cap`);
}
