// Registry of in-flight runs (one per idea), shared by the planning and build engines.
const runners = new Map(); // ideaId -> { stop, thinking }

function start(ideaId) {
  if (runners.has(ideaId)) return null;
  const r = { stop: false, thinking: null };
  runners.set(ideaId, r);
  return r;
}
function finish(ideaId) { runners.delete(ideaId); }
function requestStop(ideaId) { const r = runners.get(ideaId); if (r) r.stop = true; }
function stopping(ideaId) { return !!runners.get(ideaId)?.stop; }
function isRunning(ideaId) { return runners.has(ideaId); }
function setThinking(ideaId, thinking) { const r = runners.get(ideaId); if (r) r.thinking = thinking ? { ...thinking, since: Date.now() } : null; }
function speaker(ideaId) {
  const t = runners.get(ideaId)?.thinking;
  return t ? { agentId: t.agentId, label: t.label, elapsedMs: Date.now() - t.since } : null;
}

module.exports = { start, finish, requestStop, stopping, isRunning, setThinking, speaker };
