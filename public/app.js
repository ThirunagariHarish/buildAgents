// Box frontend — vanilla JS, no build step.

let AGENTS = {};          // agentId -> meta
let ideas = [];           // sidebar list
let current = null;       // full current idea object
let evtSource = null;
let expanded = new Set(); // message ids shown in full
let thinkingAgent = null;

const $ = (id) => document.getElementById(id);

// ---------- mobile drawer ----------
function openDrawer() {
  $('sidebar').classList.add('open');
  $('drawer-backdrop').classList.remove('hidden');
}
function closeDrawer() {
  $('sidebar').classList.remove('open');
  $('drawer-backdrop').classList.add('hidden');
}

// ---------- tiny markdown renderer ----------
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function mdInline(s) {
  return s
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
function md(src) {
  const lines = esc(src).split('\n');
  let html = '', inCode = false, inUl = false, inOl = false, para = [];
  const flushPara = () => { if (para.length) { html += `<p>${mdInline(para.join(' '))}</p>`; para = []; } };
  const closeLists = () => {
    if (inUl) { html += '</ul>'; inUl = false; }
    if (inOl) { html += '</ol>'; inOl = false; }
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (line.trim().startsWith('```')) {
      flushPara(); closeLists();
      html += inCode ? '</code></pre>' : '<pre><code>';
      inCode = !inCode; continue;
    }
    if (inCode) { html += line + '\n'; continue; }
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) { flushPara(); closeLists(); html += `<h${h[1].length}>${mdInline(h[2])}</h${h[1].length}>`; continue; }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { flushPara(); closeLists(); html += '<hr>'; continue; }
    const ul = line.match(/^\s*[-*+]\s+(.*)/);
    if (ul) { flushPara(); if (inOl) { html += '</ol>'; inOl = false; } if (!inUl) { html += '<ul>'; inUl = true; } html += `<li>${mdInline(ul[1])}</li>`; continue; }
    const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
    if (ol) { flushPara(); if (inUl) { html += '</ul>'; inUl = false; } if (!inOl) { html += '<ol>'; inOl = true; } html += `<li>${mdInline(ol[1])}</li>`; continue; }
    const bq = line.match(/^\s*>\s?(.*)/);
    if (bq) { flushPara(); closeLists(); html += `<blockquote>${mdInline(bq[1])}</blockquote>`; continue; }
    if (!line.trim()) { flushPara(); closeLists(); continue; }
    para.push(line.trim());
  }
  if (inCode) html += '</code></pre>';
  flushPara(); closeLists();
  return html;
}

// ---------- api ----------
async function api(path, opts) {
  const r = await fetch(path, opts ? { headers: { 'Content-Type': 'application/json' }, ...opts } : undefined);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
}

// ---------- sidebar ----------
async function refreshIdeas() {
  ideas = await api('/api/ideas');
  const list = $('idea-list');
  list.innerHTML = '';
  for (const i of ideas) {
    const el = document.createElement('div');
    el.className = 'idea-item' + (current && current.id === i.id ? ' active' : '');
    el.innerHTML = `<span class="idot ${i.status}"></span><span class="ititle">${esc(i.title)}</span><span class="icount">${i.messageCount}</span>`;
    el.onclick = () => openIdea(i.id);
    list.appendChild(el);
  }
}

// ---------- room ----------
async function openIdea(id) {
  current = await api(`/api/ideas/${id}`);
  expanded = new Set();
  thinkingAgent = null;
  $('empty-state').classList.add('hidden');
  $('room').classList.remove('hidden');
  closeAgentPanel();
  closeDrawer();
  renderRoom();
  connectEvents(id);
  refreshIdeas();
}

function statusLabel(s) {
  return { idle: 'Not started', running: 'Debating…', paused: 'Paused', done: 'Concluded', error: 'Error' }[s] || s;
}

function renderRoomHead() {
  $('room-title').textContent = current.title;
  $('room-meta').textContent = `Round ${current.round || '–'} of ${current.maxRounds} · ${current.messages.length} messages`;
  const pill = $('status-pill');
  pill.textContent = statusLabel(current.status);
  pill.className = current.status;
  const running = current.status === 'running';
  $('run-btn').classList.toggle('hidden', running);
  $('run-btn').textContent = current.status === 'idle' ? '▶ Start debate'
    : current.status === 'done' ? '↻ Refine further' : '▶ Resume';
  $('pause-btn').classList.toggle('hidden', !running);
  $('brief-btn').classList.toggle('hidden', !current.brief);
}

function renderAgentStrip() {
  const strip = $('agent-strip');
  strip.innerHTML = '';
  for (const a of Object.values(AGENTS)) {
    const count = current.messages.filter((m) => m.agentId === a.id).length;
    const chip = document.createElement('div');
    chip.className = 'agent-chip' + (thinkingAgent === a.id ? ' thinking' : '');
    chip.style.setProperty('--chip-color', a.color);
    chip.innerHTML = `<span>${a.emoji}</span><span>${esc(a.name)}</span><span class="chip-count">${count}</span><span class="chip-status"></span>`;
    chip.onclick = () => openAgentPanel(a.id);
    strip.appendChild(chip);
  }
}

function agentMeta(agentId) {
  if (agentId === 'user') return { name: 'You', emoji: '🧑', color: 'var(--accent)' };
  return AGENTS[agentId] || { name: agentId, emoji: '🤖', color: 'var(--border)' };
}

const KIND_LABEL = { kickoff: 'kickoff', debate: 'debate', synthesis: 'synthesis', brief: 'final brief', user: 'steer' };

function msgEl(m) {
  const a = agentMeta(m.agentId);
  const el = document.createElement('div');
  el.className = 'msg' + (m.agentId === 'user' ? ' user-msg' : '');
  el.dataset.mid = m.id;
  el.style.setProperty('--agent-color', a.color);
  const time = new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const isOpen = expanded.has(m.id);
  const body = isOpen
    ? `<div class="msg-full"><div class="md">${md(m.content)}</div><div class="collapse-hint">▲ collapse</div></div>`
    : `<div class="msg-summary">${mdInline(esc(m.summary))}${m.agentId !== 'user' ? '<div class="expand-hint">▼ click for full message</div>' : ''}</div>`;
  el.innerHTML = `
    <div class="avatar" title="${esc(a.name)}">${a.emoji}</div>
    <div class="msg-body">
      <div class="msg-head">
        <span class="msg-name">${esc(a.name)}</span>
        <span class="msg-kind">${KIND_LABEL[m.kind] || m.kind}${m.kind !== 'user' ? ' · r' + m.round : ''}</span>
        <span class="msg-time">${time}</span>
      </div>
      ${body}
    </div>`;
  el.querySelector('.avatar').onclick = () => m.agentId !== 'user' && openAgentPanel(m.agentId);
  if (m.agentId !== 'user') {
    const toggle = () => { expanded.has(m.id) ? expanded.delete(m.id) : expanded.add(m.id); renderChat(); };
    el.querySelector('.msg-summary')?.addEventListener('click', toggle);
    el.querySelector('.collapse-hint')?.addEventListener('click', toggle);
  }
  return el;
}

function renderChat() {
  const chat = $('chat');
  const stick = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 120;
  chat.innerHTML = '';
  let lastRound = null;
  for (const m of current.messages) {
    if (m.kind !== 'user' && m.round !== lastRound) {
      lastRound = m.round;
      const div = document.createElement('div');
      div.className = 'round-divider';
      div.textContent = `Round ${m.round}`;
      chat.appendChild(div);
    }
    chat.appendChild(msgEl(m));
  }
  if (thinkingAgent) {
    const a = agentMeta(thinkingAgent);
    const el = document.createElement('div');
    el.className = 'msg thinking-msg';
    el.style.setProperty('--agent-color', a.color);
    el.innerHTML = `
      <div class="avatar">${a.emoji}</div>
      <div class="msg-body">
        <div class="msg-head"><span class="msg-name">${esc(a.name)}</span></div>
        <div class="msg-summary"><span class="dots"><i></i><i></i><i></i></span> thinking…</div>
      </div>`;
    chat.appendChild(el);
  }
  if (current.status === 'error' && current.error) {
    const el = document.createElement('div');
    el.className = 'error-card';
    el.innerHTML = `<strong>The debate stopped</strong><div>${esc(current.error)}</div>`;
    chat.appendChild(el);
  }
  if (stick) chat.scrollTop = chat.scrollHeight;
}

function renderRoom() {
  renderRoomHead();
  renderAgentStrip();
  renderChat();
}

// ---------- live events ----------
function connectEvents(id) {
  if (evtSource) evtSource.close();
  evtSource = new EventSource(`/api/ideas/${id}/events`);
  evtSource.onmessage = (e) => {
    if (!current || current.id !== id) return;
    const ev = JSON.parse(e.data);
    if (ev.event === 'message') {
      thinkingAgent = null;
      current.messages.push(ev.message);
      if (ev.message.round) current.round = ev.message.round;
      renderRoom();
      refreshIdeas();
    } else if (ev.event === 'agent_thinking') {
      thinkingAgent = ev.agentId;
      if (ev.round) current.round = ev.round;
      renderAgentStrip();
      renderChat();
      renderRoomHead();
    } else if (ev.event === 'status') {
      current.status = ev.status;
      current.error = ev.error || null;
      thinkingAgent = null;
      if (ev.status === 'done') openIdea(id); // reload to pick up brief
      else renderRoom();
      refreshIdeas();
    } else if (ev.event === 'round') {
      current.round = ev.round;
      renderRoomHead();
    } else if (ev.event === 'hello') {
      current.status = ev.status;
      renderRoomHead();
    }
  };
}

// ---------- actions ----------
$('run-btn').onclick = async () => {
  if (!current) return;
  await api(`/api/ideas/${current.id}/run`, { method: 'POST', body: JSON.stringify({}) });
  current.status = 'running';
  renderRoomHead();
};
$('pause-btn').onclick = async () => {
  await api(`/api/ideas/${current.id}/pause`, { method: 'POST', body: '{}' });
};
$('delete-btn').onclick = async () => {
  if (!current || !confirm(`Delete "${current.title}"? This cannot be undone.`)) return;
  await api(`/api/ideas/${current.id}`, { method: 'DELETE' });
  current = null;
  if (evtSource) evtSource.close();
  $('room').classList.add('hidden');
  $('empty-state').classList.remove('hidden');
  refreshIdeas();
};
$('brief-btn').onclick = () => {
  $('brief-body').innerHTML = md(current.brief || '');
  $('brief-backdrop').classList.remove('hidden');
};
function closeBrief() { $('brief-backdrop').classList.add('hidden'); }

async function sendSteer() {
  const input = $('composer-input');
  const text = input.value.trim();
  if (!text || !current) return;
  input.value = '';
  input.style.height = 'auto';
  await api(`/api/ideas/${current.id}/message`, { method: 'POST', body: JSON.stringify({ text }) });
}
$('send-btn').onclick = sendSteer;
$('composer-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendSteer(); }
});
// auto-grow composer as you type (mobile-friendly)
$('composer-input').addEventListener('input', function () {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 120) + 'px';
});

// ---------- agent panel ----------
const AGENT_DESC = {
  orchestrator: 'Chairs the debate: sets the agenda, rules on disagreements, decides when the idea is mature, and writes the final Idea Brief.',
  entrepreneur: 'Thinks like a founder: business model, unit economics, moat, what the MVP must prove, fastest path to revenue.',
  marketer: 'Growth and positioning: exactly who the customer is, the wedge into the market, channels, naming, and go-to-market.',
  architect: 'Pragmatic principal engineer: how to actually build it, simplest viable architecture, technical risks, effort estimates.',
  visionary: 'Big-picture ideologist: the 10x version, "why now", adjacent applications, features nobody else would think of.',
  critic: 'The red team: strongest reasons it fails, hidden assumptions, ignored competition, risks — always with mitigations.',
};
function openAgentPanel(agentId) {
  const a = AGENTS[agentId];
  if (!a || !current) return;
  $('agent-panel-title').innerHTML = `${a.emoji} ${esc(a.name)}`;
  const entries = current.messages.filter((m) => m.agentId === agentId);
  let html = `<div class="panel-desc">${esc(AGENT_DESC[agentId] || '')}<br><br>Model: <code>${esc(a.model)}</code> · ${entries.length} contribution${entries.length === 1 ? '' : 's'}</div>`;
  for (const m of [...entries].reverse()) {
    html += `<div class="panel-entry"><div class="pe-meta">${KIND_LABEL[m.kind] || m.kind} · round ${m.round} · ${new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${m.durationMs ? ' · ' + Math.round(m.durationMs / 1000) + 's' : ''}</div>${mdInline(esc(m.summary))}</div>`;
  }
  $('agent-panel-body').innerHTML = html || '<div class="panel-desc">No contributions yet.</div>';
  $('agent-panel').classList.remove('hidden');
  $('panel-backdrop').classList.remove('hidden');
}
function closeAgentPanel() {
  $('agent-panel').classList.add('hidden');
  $('panel-backdrop').classList.add('hidden');
}

// ---------- new idea modal ----------
function openNewIdea() {
  closeDrawer();
  $('modal-backdrop').classList.remove('hidden');
  $('idea-text').focus();
}
function closeNewIdea() {
  $('modal-backdrop').classList.add('hidden');
  $('idea-title').value = '';
  $('idea-text').value = '';
}
$('new-idea-btn').onclick = openNewIdea;
$('create-idea-btn').onclick = async () => {
  const text = $('idea-text').value.trim();
  if (!text) return $('idea-text').focus();
  const title = $('idea-title').value.trim();
  const maxRounds = Number($('idea-rounds').value);
  const idea = await api('/api/ideas', { method: 'POST', body: JSON.stringify({ title, text }) });
  closeNewIdea();
  await api(`/api/ideas/${idea.id}/run`, { method: 'POST', body: JSON.stringify({ maxRounds }) });
  await openIdea(idea.id);
};
$('modal-backdrop').addEventListener('click', (e) => { if (e.target.id === 'modal-backdrop') closeNewIdea(); });
$('brief-backdrop').addEventListener('click', (e) => { if (e.target.id === 'brief-backdrop') closeBrief(); });

// ---------- boot ----------
(async function boot() {
  const list = await api('/api/agents');
  AGENTS = Object.fromEntries(list.map((a) => [a.id, a]));
  await refreshIdeas();
  if (ideas.length) openIdea(ideas[0].id);
})();
