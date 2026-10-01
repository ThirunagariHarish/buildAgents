// Runs the exact Claude call the agents make, once per model, and prints
// the outcome. Used by remote-deploy.sh so each deploy log shows whether
// debates can actually run.
const { askClaude } = require('../lib/claude');

(async () => {
  for (const model of ['haiku', 'sonnet', 'opus']) {
    try {
      const r = await askClaude({ prompt: 'Reply with exactly: OK', system: 'You are a connectivity check.', model });
      console.log(`${model}: OK (${Math.round(r.durationMs / 1000)}s) -> ${r.text.trim().slice(0, 40)}`);
    } catch (e) {
      console.log(`${model}: FAILED -> ${e.message}`);
    }
  }
})();
