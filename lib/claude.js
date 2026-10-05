// Headless Claude Code CLI wrapper.
// Runs `claude -p` as a subprocess so Box uses the user's Claude
// subscription login directly — no API key, no SDK.

const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const CLAUDE_BIN = process.env.BOX_CLAUDE_BIN || 'claude';

/**
 * bubblewrap arguments for a build-crew turn: the whole filesystem read-only,
 * Box's data directory hidden, only this project's repository and the build
 * user's home writable. Postgres and Redis are reached over 127.0.0.1 through
 * the read-only root (binding /var/run/postgresql separately fails: /var/run
 * is a symlink). The deploy self-test uses exactly these arguments.
 */
function sandboxArgs(cwd, home, dataDir = path.resolve(__dirname, '..', 'data')) {
  return [
    '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--tmpfs', '/tmp', '--tmpfs', '/run/user',
    '--tmpfs', dataDir, '--bind', cwd, cwd, '--bind', home, home,
    '--unshare-pid', '--die-with-parent', '--chdir', cwd,
  ];
}
const TURN_TIMEOUT_MS = Number(process.env.BOX_TURN_TIMEOUT_MS || 10 * 60 * 1000);

// A neutral cwd so agent calls don't pick up any project's CLAUDE.md.
const RUN_DIR = path.join(os.tmpdir(), 'box-agent-runs');
fs.mkdirSync(RUN_DIR, { recursive: true });

/**
 * Ask Claude one question with a persona system prompt.
 * `blocks` are optional image/document content blocks; when present the call
 * uses the CLI's stream-json input so they reach the model as real media.
 * Returns { text, model, costUsd, durationMs } or throws.
 */
const ALL_TOOLS = ['Bash', 'Edit', 'Write', 'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task', 'NotebookEdit', 'TodoWrite'];

/**
 * Tools may be plain names ("Read") or permission rules ("Bash(npm:*)").
 * Only the named tools are allowed; everything else is disallowed outright.
 */
function toolArgs(tools) {
  const base = (t) => t.replace(/\(.*$/, '');
  const allowed = tools.filter((t) => ALL_TOOLS.includes(base(t)));
  const allowedBases = new Set(allowed.map(base));
  return [
    '--disallowed-tools', ALL_TOOLS.filter((t) => !allowedBases.has(t)).join(','),
    ...(allowed.length ? ['--allowedTools', ...allowed] : []),
  ];
}

/** One line describing a tool call, for the live activity feed. */
function describeToolUse(name, input = {}) {
  const short = (s, n = 90) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n)}…` : s; };
  const file = input.file_path || input.path || input.notebook_path;
  switch (name) {
    case 'Bash': return { tool: 'run', text: short(input.description || input.command) };
    case 'Read': return { tool: 'read', text: short(file) };
    case 'Write': return { tool: 'write', text: short(file) };
    case 'Edit': case 'MultiEdit': return { tool: 'edit', text: short(file) };
    case 'Glob': case 'Grep': return { tool: 'search', text: short(input.pattern) };
    case 'WebSearch': return { tool: 'search', text: short(input.query) };
    case 'WebFetch': return { tool: 'fetch', text: short(input.url) };
    default: return { tool: name.toLowerCase(), text: short(JSON.stringify(input)) };
  }
}

function askClaude({ prompt, system, model, blocks = [], tools = [], cwd, runAs = null, timeoutMs, onActivity }) {
  return new Promise((resolve, reject) => {
    const streaming = blocks.length > 0 || !!onActivity;
    const structuredInput = blocks.length > 0;
    const turnTimeout = timeoutMs || TURN_TIMEOUT_MS;
    const args = [
      '-p',
      ...(streaming
        ? [...(structuredInput ? ['--input-format', 'stream-json'] : []), '--output-format', 'stream-json', '--verbose']
        : ['--output-format', 'json']),
      '--model', model || 'sonnet',
      '--append-system-prompt', system || '',
      ...toolArgs(tools),
    ];

    const env = { ...process.env };
    delete env.CLAUDE_CODE_ENTRYPOINT; // avoid nested-session confusion
    const opts = { cwd: cwd || RUN_DIR, env };
    if (runAs) {
      // Build-crew turns run as an unprivileged user: no access to Box's data,
      // password or the rest of the server.
      delete env.BOX_PASSWORD;
      env.HOME = runAs.home;
      env.USER = runAs.name;
      opts.uid = runAs.uid;
      opts.gid = runAs.gid;
    }

    // Build-crew turns run inside a bubblewrap sandbox when the server enabled
    // it (BOX_BWRAP=1): the whole filesystem is read-only, Box's data directory
    // is hidden, and only this project's repository and the build user's home
    // are writable. One project's agent cannot read another project's code.
    let bin = CLAUDE_BIN;
    let finalArgs = args;
    if (runAs && process.env.BOX_BWRAP === '1' && cwd) {
      bin = 'bwrap';
      finalArgs = [...sandboxArgs(cwd, runAs.home), '--', CLAUDE_BIN, ...args];
    }
    const child = spawn(bin, finalArgs, opts);
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`Claude turn timed out after ${Math.round(turnTimeout / 1000)}s`));
    }, turnTimeout);

    if (structuredInput) {
      child.stdin.write(JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: prompt }, ...blocks] },
      }) + '\n');
    } else {
      child.stdin.write(prompt);
    }
    child.stdin.end();
    let lineBuf = '';
    let toolCalls = 0;
    child.stdout.on('data', (d) => {
      stdout += d;
      if (!onActivity) return;
      lineBuf += d;
      const lines = lineBuf.split('\n');
      lineBuf = lines.pop();
      for (const line of lines) {
        let j;
        try { j = JSON.parse(line); } catch { continue; }
        const content = j.type === 'assistant' ? j.message?.content : null;
        if (!Array.isArray(content)) continue;
        for (const block of content) {
          if (block.type === 'tool_use') {
            toolCalls += 1;
            try { onActivity({ ...describeToolUse(block.name, block.input), n: toolCalls, at: Date.now() }); } catch {}
          } else if (block.type === 'text' && block.text && block.text.length > 20) {
            try { onActivity({ tool: 'say', text: block.text.replace(/\s+/g, ' ').trim().slice(0, 140), n: toolCalls, at: Date.now() }); } catch {}
          }
        }
      }
    });
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
      let parsed = null;
      if (streaming) {
        for (const line of stdout.split('\n')) {
          try { const j = JSON.parse(line); if (j.type === 'result') parsed = j; } catch {}
        }
      } else {
        try { parsed = JSON.parse(stdout); } catch {}
      }
      // The CLI's JSON puts the human-readable failure in `result`, after a
      // long usage block, so pull it out rather than truncating raw output.
      // Killed by a signal (code null) without our own timeout firing: the
      // server is restarting or the run was stopped. That is a pause, not a
      // failure; the run resumes after the restart.
      if (code === null) return reject(new Error('__paused__'));
      const failed = code !== 0 || !parsed || parsed.is_error;
      const detail = parsed
        ? [parsed.result, parsed.terminal_reason, stderr].filter(Boolean).join(' | ')
        : (stderr.trim() || (streaming ? 'the process ended without a result' : stdout));
      if (failed && /Invalid bearer token|Not logged in|Failed to authenticate|authentication_error|OAuth token/i.test(detail)) {
        return reject(new Error(`Claude is not logged in on the server, so the agents cannot run. On the server, run \`claude\`, type \`/login\`, finish the login, then tap Resume. Details: ${detail.slice(0, 300)}`));
      }
      if (failed) {
        return reject(new Error(`Claude call failed (model ${model}, exit ${code}): ${detail.slice(0, 600) || 'no error text'}`));
      }
      resolve({
        text: parsed.result || '',
        model: parsed.model || model,
        costUsd: parsed.total_cost_usd || 0,
        durationMs: Date.now() - started,
        toolCalls,
      });
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

module.exports = { askClaude, splitSummary, sandboxArgs, ALL_TOOLS };
