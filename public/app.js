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
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
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

const KIND_LABEL = { kickoff: 'Kickoff', research: 'Web research', synthesis: 'Synthesis', brief: 'Final brief', doc: 'Document', approved: 'Approved' };
const STATUS_LABEL = { running: 'Debating', paused: 'Paused', done: 'Concluded', error: 'Stopped', idle: 'Not started' };
const ROUND_LABEL = { 1: 'Quick pass', 2: 'Standard', 3: 'Deep', 4: 'Exhaustive' };
const SUGGESTIONS = [
  'An app that matches dog owners with neighbors for midday walks',
  'A browser extension that turns long YouTube videos into ready-to-post shorts',
  'A subscription box for home cooks built around local farms',
];

// ---------- api ----------
async function api(path, opts) {
  const init = opts ? { headers: { 'Content-Type': 'application/json' }, ...opts } : undefined;
  const r = await fetch(path, init);
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && data.login) showLogin();
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
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
  return settings.name ? `${part}, ${settings.name}` : part;
}
function renderAvatar() {
  $('avatar-btn').textContent = (settings.name.trim()[0] || 'B').toUpperCase();
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
  if (standalone && !desktop.matches) root.setProperty('--app-h', `${Math.max(window.innerHeight, screenHeight())}px`);
  else root.removeProperty('--app-h');
}
window.addEventListener('resize', fitApp);
window.addEventListener('orientationchange', () => { tallestView = 0; setTimeout(fitApp, 300); });
window.visualViewport?.addEventListener('resize', fitApp);
window.visualViewport?.addEventListener('scroll', fitApp);
fitApp();

// One-off layout report so screen-size problems on a real phone can be diagnosed.
setTimeout(() => {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;bottom:0;box-sizing:content-box;height:env(safe-area-inset-bottom);padding-top:env(safe-area-inset-top)';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const report = {
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
}, 1500);

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
  const groups = { needs: [], ideas: [], projects: [] };
  for (const i of ideas) groups[placeOf(i).group].push(i);
  const item = (i) => {
    const pl = placeOf(i);
    return `<button class="sb-item${current && current.id === i.id ? ' active' : ''}" data-id="${i.id}">
        <span class="sb-ico ${pl.cls}">${ic(pl.icon)}</span>
        <span class="sb-item-text"><span class="sb-item-title">${esc(i.title)}</span><span class="sb-item-sub ${pl.cls}">${esc(pl.label)}</span></span>
      </button>`;
  };
  const section = (title, arr, empty) => (arr.length || empty)
    ? `<div class="sb-label">${title}${arr.length ? ` <span class="sb-count">${arr.length}</span>` : ''}</div>${arr.length ? arr.map(item).join('') : `<div class="sb-empty">${empty}</div>`}`
    : '';
  list.innerHTML = section('Needs you', groups.needs, '')
    + section('Ideas', groups.ideas, groups.needs.length || groups.projects.length ? '' : 'Your ideas will show up here.')
    + section('Projects', groups.projects, 'Promote an idea with a finished brief to start a project.');
}
$('idea-list').addEventListener('click', (e) => {
  const b = e.target.closest('.sb-item');
  if (!b) return;
  closeDrawer();
  location.hash = `#/idea/${b.dataset.id}`;
});
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
  let sub = `Round ${Math.max(current.round, 1)} of ${current.maxRounds}`;
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
  if (isProject()) {
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
  if (s === 'running') items.push({ icon: 'pause', label: 'Pause debate', run: pauseCurrent });
  else if (s === 'done') items.push({ icon: 'refresh', label: 'Run another round', run: runCurrent });
  else items.push({ icon: 'play', label: s === 'idle' ? 'Start debate' : 'Resume debate', run: runCurrent });
  items.push('-', { icon: 'trash', label: 'Delete', danger: true, run: deleteCurrent });
  openPopover($('more-btn'), items);
};

// ---------- routing ----------
function parseHash() {
  const m = location.hash.match(/^#\/idea\/([a-f0-9]+)/);
  return m ? { view: 'idea', id: m[1] } : { view: 'new' };
}
async function onRoute() {
  closeAllLayers();
  closeDrawer();
  route = parseHash();
  if (route.view === 'idea') await openIdea(route.id);
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
  renderTop();
  renderSidebar();
  renderDock();
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
  let idea;
  try { idea = await api(`/api/ideas/${id}`); } catch {
    if (!silent) toast('That idea no longer exists.');
    location.hash = '#/';
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
    const proto = (m.attachments || []).find((x) => x.kind === 'html');
    if (proto) extra += `<button class="brief-card proto-card" data-proto="${esc(proto.id)}">
        <span class="brief-ico">${ic('image')}</span>
        <span style="min-width:0"><div class="brief-title">Clickable prototype</div><div class="brief-sub">Tap to try it on your phone</div></span>
      </button>`;
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
  for (const m of messages) {
    if (m.kind === 'user') {
      html += `<div class="u-msg"><div class="u-label">You · to the room</div>${attachmentsHtml(m.attachments)}<div class="u-bubble">${esc(m.content)}</div></div>`;
      continue;
    }
    if (m.round !== lastRound) {
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
    }).join('')}${p.prototype ? `<button class="doc-tile proto" data-proto="${esc(p.prototype.id)}">
          <span class="doc-tile-emoji">${ic('image')}</span>
          <span class="doc-tile-title">Prototype</span>
          <span class="doc-tile-sub">Clickable · ${p.prototype.name ? 'tap to try' : ''}</span>
        </button>` : ''}</div>`;
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
    html += `<a class="site-card" href="${esc(p.url)}" target="_blank" rel="noopener">
        <span class="brief-ico">${ic('globe')}</span>
        <span style="min-width:0"><div class="brief-title">${esc(p.url.replace(/^https?:\/\//, ''))}</div><div class="brief-sub">${p.stage === 'maintenance' ? 'Live · in maintenance' : 'Live · tap to open'}${p.repoUrl ? ' · code on GitHub' : ''}</div></span>
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

function openTasksSheet() {
  if (!current?.project?.tasks?.length) return;
  openSheet({
    title: 'Task board',
    tall: true,
    render(s) {
      const tasks = current.project.tasks;
      const icon = { done: 'check', doing: 'spark', blocked: 'alert', todo: 'chevR' };
      s.body.innerHTML = `<p class="sheet-intro">${tasks.filter((t) => t.status === 'done').length} of ${tasks.length} done. Tasks come from the Tech Lead’s build plan, then from QA and your feedback.</p>
        ${tasks.map((t) => {
          const a = agentOf(t.agentId || (t.role === 'frontend' ? 'frontend' : 'backend'));
          return `<div class="task-row ${esc(t.status)}">
            <span class="task-ico">${ic(icon[t.status] || 'chevR')}</span>
            <span class="task-main">
              <span class="task-title">${esc(t.id)} · ${esc(t.title)}</span>
              <span class="task-sub">${a.emoji} ${esc(a.name)} · ${esc(t.size || 'M')}${t.source === 'qa' ? ' · fix from QA' : t.source === 'owner' ? ' · from you' : ''}${t.commit ? ` · ${esc(t.commit)}` : ''}</span>
              ${t.report ? `<span class="task-report">${esc(t.report)}</span>` : ''}
            </span>
          </div>`;
        }).join('')}`;
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
      s.body.innerHTML = `
        <div class="doc-by" style="--agent-color:${esc(a.color)}"><span class="a-avatar">${a.emoji}</span><span>${esc(a.name)}${d.version > 1 ? ` · version ${d.version}` : ''} · ${new Date(d.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span></div>
        <div class="btn-pair" style="margin-bottom:16px">
          <button class="wide-btn soft" data-act="copy">Copy</button>
          <button class="wide-btn soft" data-act="share">Share</button>
        </div>
        <div class="md a-body">${md(d.content)}</div>`;
      s.body.onclick = async (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'copy' && await copyText(d.content)) toast('Document copied');
        if (act === 'share') {
          if (navigator.share) { try { await navigator.share({ title: `${current.title} — ${d.title}`, text: d.content }); } catch {} }
          else if (await copyText(d.content)) toast('Document copied');
        }
      };
    },
  });
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

function openPrototype() {
  const proto = current?.project?.prototype;
  if (!proto) return;
  const src = `/api/uploads/${proto.id}`;
  openSheet({
    title: 'Prototype',
    tall: true,
    render(s) {
      s.body.classList.add('proto-body');
      s.body.innerHTML = `
        <div class="proto-bar"><span>By the UX Designer · sample content, nothing is saved</span><a class="proto-open" href="${src}" target="_blank" rel="noopener">Full screen ${ic('chevR')}</a></div>
        <iframe class="proto-frame" src="${src}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" title="Prototype"></iframe>`;
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
    html += `<div class="brewing">
        <span class="brew-mark">${ic('spark')}</span>
        <span class="shimmer">${thinking?.label ? esc(thinking.label) : who ? `${who.emoji} ${esc(who.name)} is thinking` : 'Gathering the room'}</span>
        <span class="brew-time" id="brew-time"></span>
      </div>`;
  }
  $('messages').innerHTML = html;
  tickBrew();
  if (stick) requestAnimationFrame(() => scrollToBottom(false));
}

function tickBrew() {
  const el = $('brew-time');
  if (el && thinking) el.textContent = `${Math.floor((Date.now() - thinking.since) / 1000)}s`;
}
setInterval(tickBrew, 1000);

$('messages').addEventListener('click', async (e) => {
  const t = e.target.closest('[data-toggle],[data-copy],[data-brief],[data-zoom],[data-agent],[data-doc],[data-proto],[data-tasks]');
  if (!t) return;
  if (t.dataset.doc) {
    openDocViewer(t.dataset.doc);
  } else if (t.dataset.tasks) {
    openTasksSheet();
  } else if (t.dataset.proto) {
    openPrototype();
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
      const idea = await api('/api/ideas', { method: 'POST', body: JSON.stringify({ text, attachments, maxRounds: settings.rounds }) });
      clearComposer();
      location.hash = `#/idea/${idea.id}`;
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
}
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
        <button class="row" data-go="agents">${ic('users')}<span class="row-label">Agents</span><span class="row-value">${AGENTS.length}</span><span class="row-chev">${ic('chevR')}</span></button>
        <p class="sheet-intro" style="margin-top:12px">Agents can see photos and PDFs, and read text files (txt, md, csv, json).</p>`;
      s.body.onclick = (e) => {
        const pick = e.target.closest('[data-pick]');
        if (pick) { s.close(); $(pick.dataset.pick).click(); return; }
        const go = e.target.closest('[data-go]');
        if (go?.dataset.go === 'rounds') { s.close(); openRoundsSheet(); }
        if (go?.dataset.go === 'agents') { s.close(); openAgentsSheet(); }
      };
    },
  });
}

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
      s.body.innerHTML = `
        <p class="sheet-intro">${esc(a.description || '')}</p>
        <div class="row" style="cursor:default"><span class="row-label">Model</span><span class="row-value">${esc(a.model)}</span></div>
        ${current ? `<div class="sb-label" style="padding:14px 6px 8px">${entries.length} ${entries.length === 1 ? 'contribution' : 'contributions'} to this idea</div>` : ''}
        ${entries.slice().reverse().map((m) => `<div class="ag-row"><span class="ag-main">
            <span class="ag-top"><span class="ag-tag">${KIND_LABEL[m.kind] || `Round ${m.round}`}</span><span class="a-meta">${timeOf(m.ts)}</span></span>
            <span class="ag-desc" style="color:var(--text);font-size:15px">${mdInline(esc(m.summary))}</span>
          </span></div>`).join('')}`;
    },
  });
}

function openBriefViewer() {
  if (!current?.brief) return;
  const brief = current.brief;
  const title = current.title;
  openSheet({
    title: 'Idea Brief',
    tall: true,
    render(s) {
      s.body.innerHTML = `
        <div class="btn-pair" style="margin-bottom:16px">
          <button class="wide-btn soft" data-act="copy">Copy</button>
          <button class="wide-btn soft" data-act="share">Share</button>
        </div>
        <div class="md a-body">${md(brief)}</div>`;
      s.body.onclick = async (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'copy' && await copyText(brief)) toast('Brief copied');
        if (act === 'share') {
          if (navigator.share) { try { await navigator.share({ title, text: brief }); } catch {} }
          else if (await copyText(brief)) toast('Brief copied');
        }
      };
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
          <label class="field"><span>Your name</span><input id="set-name" type="text" maxlength="40" placeholder="Used in your greeting" value="${esc(settings.name)}"></label>
          <div class="sb-label" style="padding:6px 6px 8px">Appearance</div>
          ${['system', 'dark', 'light'].map((t) => `<button class="row check" data-theme="${t}"><span class="row-label">${t[0].toUpperCase() + t.slice(1)}</span><span class="row-value">${settings.theme === t ? ic('check') : ''}</span></button>`).join('')}
          <p class="sheet-intro" style="margin-top:10px">Box runs every agent through your Claude subscription on your server. ${AGENTS.length} agents in the room.</p>`;
        $('set-name').addEventListener('input', (e) => {
          settings.name = e.target.value.trim();
          saveSettings(); renderAvatar();
          if (route.view === 'new') $('greeting').textContent = greeting();
        });
      };
      draw();
      s.body.onclick = (e) => {
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

function openAgentsSheet() {
  let draft = null;
  openSheet({
    title: 'Agents',
    tall: true,
    render(s) {
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
              </span>
              ${a.builtin ? '' : `<button class="icon-btn" data-remove="${a.id}" aria-label="Remove ${esc(a.name)}">${ic('trash')}</button>`}
            </div>`;
            const chair = AGENTS.filter((a) => a.id === 'orchestrator');
            const research = AGENTS.filter((a) => a.research);
            const pool = AGENTS.filter((a) => a.builtin && !a.research && a.id !== 'orchestrator');
            const custom = AGENTS.filter((a) => !a.builtin);
            const grp = (t, arr) => arr.length ? `<div class="sb-label" style="padding:12px 6px 8px">${t}</div>${arr.map(row).join('')}` : '';
            return grp('Chair', chair) + grp('Research, before every debate', research) + grp('Specialist pool', pool) + grp('Your agents', custom);
          })()}
          <button class="wide-btn accent" data-act="add" style="margin-top:6px">Add an agent</button>`;
      };
      const form = (err = '') => {
        s.setTitle('New agent');
        s.setBack(list);
        const d = draft || { name: '', emoji: '', model: 'sonnet', instructions: '' };
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
          ${err ? `<div class="form-error">${esc(err)}</div>` : ''}
          <button class="wide-btn" data-act="review">Review</button>`;
        $('ag-model').value = d.model;
        $('ag-instructions').addEventListener('input', (e) => { $('ag-count').textContent = e.target.value.length; });
        if (!d.name) setTimeout(() => $('ag-name')?.focus(), 60);
      };
      const read = () => ({
        name: $('ag-name').value.trim(),
        emoji: $('ag-emoji').value.trim() || '🤖',
        model: $('ag-model').value,
        instructions: $('ag-instructions').value.trim(),
      });
      const confirmView = (err = '') => {
        s.setTitle('Confirm new agent');
        s.setBack(() => form());
        const modelName = { sonnet: 'Sonnet — balanced', opus: 'Opus — deepest', haiku: 'Haiku — fastest' }[draft.model];
        s.body.innerHTML = `
          <p class="sheet-intro">Check this before adding. Nothing is saved until you confirm.</p>
          <div class="preview-card">
            <div class="pv-head"><span class="pv-emoji">${esc(draft.emoji)}</span><span class="pv-name">${esc(draft.name)}</span></div>
            <div class="pv-model">Model: ${modelName}</div>
            <div class="pv-label">Instructions</div>
            <div class="pv-text">${esc(draft.instructions)}</div>
          </div>
          <ul class="notes">
            <li>Speaks once per round in every idea: new ones right away, running ones from their next round.</li>
            <li>Each round costs one more Claude call per debate, which counts toward your Claude limits.</li>
            <li>You can remove it any time from this screen.</li>
          </ul>
          ${err ? `<div class="form-error">${esc(err)}</div>` : ''}
          <div class="btn-pair">
            <button class="wide-btn soft" data-act="edit">Edit</button>
            <button class="wide-btn accent" data-act="confirm">Confirm &amp; add</button>
          </div>`;
      };
      list();
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
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'add') { draft = null; form(); }
        if (act === 'review') {
          const d = read();
          draft = d;
          if (d.name.length < 2) return form('Give the agent a name (at least 2 characters).');
          if (AGENTS.some((a) => a.name.toLowerCase() === d.name.toLowerCase())) return form(`An agent named “${d.name}” is already in the room.`);
          if ([...d.emoji].length > 4) return form('Use a single emoji for the icon.');
          if (d.instructions.length < 30) return form('Instructions need at least 30 characters.');
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
function handleEvent(ev) {
  const mine = current && ev.ideaId === current.id;
  switch (ev.event) {
    case 'hello':
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
        if (ev.status === 'done') openIdea(current.id, { silent: true });
        else { renderThread(); renderTop(); renderDock(); }
      }
      refreshIdeasSoon();
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
  }
}
function connectEvents() {
  const es = new EventSource('/api/events');
  es.onmessage = (e) => { try { handleEvent(JSON.parse(e.data)); } catch {} };
}

// ---------- boot ----------
// ---------- sign-in ----------
function showLogin() {
  if ($('login')) return;
  const el = document.createElement('div');
  el.id = 'login';
  el.innerHTML = `<form class="login-box">
      <div class="welcome-mark">${ic('spark')}</div>
      <h1>Welcome back</h1>
      <p>Enter your Box password. This device stays signed in.</p>
      <input type="password" id="login-pw" autocomplete="current-password" placeholder="Password" required>
      <div class="form-error hidden" id="login-err"></div>
      <button class="wide-btn" type="submit">Continue</button>
    </form>`;
  document.body.appendChild(el);
  const form = el.querySelector('form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('login-pw').value }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Sign-in failed');
      location.reload();
    } catch (err) {
      $('login-err').textContent = err.message;
      $('login-err').classList.remove('hidden');
      btn.disabled = false;
    }
  };
  setTimeout(() => $('login-pw')?.focus(), 100);
}

(async function boot() {
  applyTheme();
  hydrateIcons();
  renderAvatar();
  const session = await fetch('/api/session').then((r) => r.json()).catch(() => ({}));
  if (session.loginRequired && !session.authed) return showLogin();
  await loadAgents();
  await refreshIdeas();
  await onRoute();
  connectEvents();
})();
