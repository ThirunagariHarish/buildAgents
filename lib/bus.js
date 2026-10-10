// Live updates to open Studio screens (server-sent events), and a registry
// of runs in flight. Each event about an agent reaches only its owner and
// administrators.

const clients = new Map(); // res -> user

function attach(res, user) { clients.set(res, user); }
function detach(res) { clients.delete(res); }

function write(res, payload) { try { res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch {} }

/** An event about one agent: its owner and administrators see it. */
function publish(agent, payload) {
  for (const [res, u] of clients) {
    if (u && (u.role === 'admin' || u.id === agent.ownerId)) write(res, { agentId: agent.id, ...payload });
  }
}
/** An event for everyone signed in (or only administrators). */
function broadcast(payload, { adminsOnly = false } = {}) {
  for (const [res, u] of clients) if (u && (!adminsOnly || u.role === 'admin')) write(res, payload);
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

module.exports = { attach, detach, publish, broadcast, start, finish, stop, stopping, running, allRunning, setThinking, thinking };
