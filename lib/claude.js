// Headless Claude Code CLI wrapper.
// Runs `claude -p` as a subprocess so Box uses the user's Claude
// subscription login directly — no API key, no SDK.

const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const CLAUDE_BIN = process.env.BOX_CLAUDE_BIN || 'claude';
const TURN_TIMEOUT_MS = Number(process.env.BOX_TURN_TIMEOUT_MS || 10 * 60 * 1000);

// A neutral cwd so agent calls don't pick up any project's CLAUDE.md.
const RUN_DIR = path.join(os.tmpdir(), 'box-agent-runs');
fs.mkdirSync(RUN_DIR, { recursive: true });

/**
 * Ask Claude one question with a persona system prompt.
 * Returns { text, model, costUsd, durationMs } or throws.
 */
function askClaude({ prompt, system, model }) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      '--output-format', 'json',
      '--model', model || 'sonnet',
      '--append-system-prompt', system || '',
      '--disallowed-tools', 'Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,Task,NotebookEdit,TodoWrite',
    ];

    const env = { ...process.env };
    delete env.CLAUDE_CODE_ENTRYPOINT; // avoid nested-session confusion

    const child = spawn(CLAUDE_BIN, args, { cwd: RUN_DIR, env });
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`Claude turn timed out after ${TURN_TIMEOUT_MS / 1000}s`));
    }, TURN_TIMEOUT_MS);

    child.stdin.write(prompt);
    child.stdin.end();
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Failed to launch Claude CLI (${CLAUDE_BIN}): ${err.message}`));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`Claude CLI exited with code ${code}: ${(stderr || stdout).slice(0, 800)}`));
      }
      try {
        const parsed = JSON.parse(stdout);
        if (parsed.is_error) return reject(new Error(`Claude returned an error: ${String(parsed.result).slice(0, 800)}`));
        resolve({
          text: parsed.result || '',
          model: parsed.model || model,
          costUsd: parsed.total_cost_usd || 0,
          durationMs: Date.now() - started,
        });
      } catch (e) {
        reject(new Error(`Could not parse Claude CLI output: ${stdout.slice(0, 800)}`));
      }
    });
  });
}

/** Split the "SUMMARY: ..." first line from the body. */
function splitSummary(text) {
  const m = text.match(/^\s*SUMMARY:\s*(.+?)\s*(?:\n|$)/);
  if (m) {
    const body = text.slice(m.index + m[0].length).replace(/^\s*(-{3,}|\*{3,})\s*\n/, '').trim();
    return { summary: m[1].trim(), content: body || m[1].trim() };
  }
  const firstLine = text.trim().split('\n')[0].slice(0, 160);
  return { summary: firstLine, content: text.trim() };
}

module.exports = { askClaude, splitSummary };
