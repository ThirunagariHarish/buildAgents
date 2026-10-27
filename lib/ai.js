// AI on the owner's Claude plan (claude -p on the server), only for the owner,
// administrators and people the owner grants it to:
//   auto-tag  files a note under 1-3 tags (reusing the person's own tags) when
//             they didn't add any themselves
//   ask       answers a question from the person's own notes, citing them
// Everyone else gets the same app without these.

const store = require('./store');
const { askJson, askClaude } = require('./claude');

const allowed = (u) => !!u && (u.primary || u.role === 'admin' || u.claude === true);
const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

// One AI job at a time, so a burst of jots never floods the plan.
const queue = [];
let busy = false;
function enqueue(fn) { queue.push(fn); pump(); }
async function pump() {
  if (busy) return;
  const fn = queue.shift();
  if (!fn) return;
  busy = true;
  try { await fn(); } catch (e) { console.error(`ai: ${e.message}`); } finally { busy = false; setImmediate(pump); }
}

const TAG_SYSTEM = 'You file short personal notes for one person. Pick 1 to 3 tags that will help them find the note later. Reuse their existing tags whenever one fits; otherwise make a new one. Tags are lowercase, one or two words joined by a hyphen, no #.';
function autoTag(uid, note, existing) {
  if (note.tags.length || (!note.text && !note.links.length)) return;
  enqueue(async () => {
    const fresh = store.getNote(uid, note.id);
    if (!fresh) return;
    const body = `${fresh.text}\n${(fresh.links || []).map((l) => `${l.title || ''} ${l.site || ''} ${l.url}`).join('\n')}`.slice(0, 3000);
    const r = await askJson({ system: TAG_SYSTEM, prompt: `Their existing tags: ${existing.slice(0, 50).join(', ') || 'none yet'}\n\nThe note:\n"""\n${body}\n"""\n\nReply with ONLY JSON: {"tags": ["..."]}`, model: store.settings().models.tag, tools: [], timeoutMs: 90000 });
    const tags = (Array.isArray(r.json.tags) ? r.json.tags : []).map((t) => String(t).toLowerCase().replace(/^#/, '').replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/^-|-$/g, '').slice(0, 32)).filter(Boolean).slice(0, 3);
    if (tags.length && store.getNote(uid, note.id)) store.updateNote(uid, note.id, { aiTags: tags });
  });
}

const ASK_SYSTEM = 'You answer questions for one person using ONLY their own saved notes, which are listed with numbers. Be brief and concrete. Cite the notes you used like [3] or [3][7]. If the notes do not contain the answer, say so plainly and suggest what they might search for. Never invent facts that are not in the notes.';
/** Pick the notes most likely to matter, then ask. Returns { answer, cited: [noteId] }. */
async function ask(uid, question) {
  const q = str(question, 500);
  const words = q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
  const all = store.notes(uid);
  const scored = all.map((n, i) => {
    const hay = `${n.text} ${(n.links || []).map((l) => `${l.title} ${l.site}`).join(' ')} ${[...n.tags, ...(n.aiTags || [])].join(' ')}`.toLowerCase();
    const hits = words.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
    return { n, score: hits * 10 + Math.max(0, 5 - i / 20) };
  }).sort((a, b) => b.score - a.score).slice(0, 80);
  const list = scored.map((x, i) => ({ i: i + 1, n: x.n }));
  const text = list.map(({ i, n }) => `[${i}] (${new Date(n.createdAt).toISOString().slice(0, 10)}${n.tags.length ? ` #${n.tags.join(' #')}` : ''}) ${str(n.text, 600)}${(n.links || []).length ? ` | links: ${n.links.map((l) => l.title || l.url).join('; ')}` : ''}`).join('\n');
  const r = await askClaude({ system: ASK_SYSTEM, prompt: `Today is ${new Date().toISOString().slice(0, 10)}.\n\nTHEIR NOTES:\n${text || '(no notes yet)'}\n\nTHEIR QUESTION: ${q}`, model: store.settings().models.ask, tools: [], timeoutMs: 180000 });
  const cited = [...new Set([...r.text.matchAll(/\[(\d{1,3})\]/g)].map((m) => Number(m[1])))].map((k) => list[k - 1]).filter(Boolean).map((x) => ({ k: x.i, id: x.n.id }));
  return { answer: r.text.trim().slice(0, 4000), cited };
}

module.exports = { allowed, autoTag, ask };
