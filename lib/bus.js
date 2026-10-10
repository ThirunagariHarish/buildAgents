// Live updates to open Studio screens (server-sent events), and a registry
// of runs in flight. Each event about an agent reaches only its owner and
// administrators.

const clients = new Map(); // res -> session token

function attach(res, token) { clients.set(res, token); }
function detach(res) { clients.delete(res); }

function write(res, payload) { try { res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch {} }

/**
 * Who is behind each open stream, looked up again at every event: a session
 * that was signed out, or a person disabled or no longer an administrator,
 * stops receiving at once.
 */
function* listeners() {
  const auth = require('./auth');
  for (const [res, token] of clients) {
    const u = auth.userForSession(token);
    if (!u) { clients.delete(res); try { res.end(); } catch {} continue; }
    yield [res, u];
  }
}

/** An event about one agent: its owner, the people it is shared with, and administrators. */
function publish(agent, payload) {
  for (const [res, u] of listeners()) {
    if (u.role === 'admin' || u.id === agent.ownerId || (agent.members || []).some((m) => m.userId === u.id)) write(res, { agentId: agent.id, ...payload });
  }
}
/** An event for everyone signed in (or only administrators). */
function broadcast(payload, { adminsOnly = false } = {}) {
  for (const [res, u] of listeners()) if (!adminsOnly || u.role === 'admin') write(res, payload);
}

/** An event for one person's open screens. */
function toUser(userId, payload) {
  for (const [res, u] of listeners()) if (u.id === userId) write(res, payload);
}

// ---- runs in flight -------------------------------------------------------
const runs = new Map(); // agentId -> { stop, thinking }
function start(id) { if (runs.has(id)) return null; const r = { stop: false, thinking: null }; runs.set(id, r); return r; }
function finish(id) { runs.delete(id); }
function stop(id) { const r = runs.get(id); if (r) r.stop = true; }
function stopping(id) { return !!runs.get(id)?.stop; }
function running(id) { return runs.has(id); }
function allRunning() { return [...runs.keys()]; }
function setThinking(id, t) { const r = runs.get(id); if (r) r.thinking = t ? { ...t, since: Date.now() } : null; }
function thinking(id) { const t = runs.get(id)?.thinking; return t ? { ...t, elapsedMs: Date.now() - t.since } : null; }

module.exports = { attach, detach, publish, broadcast, toUser, start, finish, stop, stopping, running, allRunning, setThinking, thinking };
