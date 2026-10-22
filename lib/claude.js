// Headless Claude Code CLI (`claude -p`) on the owner's login. Analysts get
// only WebSearch/WebFetch: no shell, no files, and an environment that holds
// nothing but what Claude Code itself needs.

const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const CLAUDE_BIN = process.env.RV_CLAUDE_BIN || 'claude';
const ALL_TOOLS = ['Bash', 'Edit', 'Write', 'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task', 'NotebookEdit', 'TodoWrite'];
// An empty working directory, so no project's CLAUDE.md is picked up.
const RUN_DIR = path.join(os.tmpdir(), 'reinvent-runs');
fs.mkdirSync(RUN_DIR, { recursive: true });

function toolArgs(tools) {
  const allowed = tools.filter((t) => ALL_TOOLS.includes(t));
  return ['--disallowed-tools', ALL_TOOLS.filter((t) => !allowed.includes(t)).join(','), ...(allowed.length ? ['--allowedTools', ...allowed] : [])];
}

function askClaude({ prompt, system, model = 'sonnet', tools = [], timeoutMs = 8 * 60 * 1000, onActivity }) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--model', model, '--append-system-prompt', system || '', ...toolArgs(tools)];
    const env = {};
    for (const k of ['PATH', 'LANG', 'LC_ALL', 'TERM', 'TZ', 'TMPDIR', 'HOME', 'USER', 'SHELL', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'CLAUDE_CODE_OAUTH_TOKEN']) if (process.env[k]) env[k] = process.env[k];
    const child = spawn(CLAUDE_BIN, args, { cwd: RUN_DIR, env });
    const started = Date.now();
    let out = '', err = '', buf = '', settled = false, calls = 0, searches = 0, pages = 0;
    const timer = setTimeout(() => { if (!settled) { settled = true; child.kill('SIGKILL'); reject(new Error(`Claude timed out after ${Math.round(timeoutMs / 1000)}s`)); } }, timeoutMs);
    child.stdin.end(prompt);
    child.stdout.on('data', (d) => {
      out += d; buf += d;
      const lines = buf.split('\n'); buf = lines.pop();
      for (const line of lines) {
        let j; try { j = JSON.parse(line); } catch { continue; }
        const content = j.type === 'assistant' ? j.message?.content : null;
        if (!Array.isArray(content)) continue;
        for (const b of content) {
          if (b.type !== 'tool_use') continue;
          calls += 1;
          if (b.name === 'WebSearch') searches += 1; else if (b.name === 'WebFetch') pages += 1;
          if (!onActivity) continue;
          const what = b.name === 'WebSearch' ? `searching “${String(b.input?.query || '').slice(0, 80)}”` : b.name === 'WebFetch' ? `reading ${String(b.input?.url || '').replace(/^https?:\/\//, '').slice(0, 70)}` : b.name;
          try { onActivity(what); } catch {}
        }
      }
    });
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error(`Could not start Claude: ${e.message}`)); } });
    child.on('close', (code) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      let res = null;
      for (const line of out.split('\n')) { try { const j = JSON.parse(line); if (j.type === 'result') res = j; } catch {} }
      if (code !== 0 || !res || res.is_error) {
        const detail = [res && res.result, err.trim()].filter(Boolean).join(' | ').slice(0, 500);
        if (/Invalid bearer token|Not logged in|authentication_error|OAuth token/i.test(detail)) return reject(new Error('Claude is not logged in on the server.'));
        return reject(new Error(`Claude failed (exit ${code}): ${detail || 'no detail'}`));
      }
      resolve({ text: res.result || '', costUsd: res.total_cost_usd || 0, durationMs: Date.now() - started, toolCalls: calls, searches, pages });
    });
  });
}

/** Pull the first JSON object out of a reply (models sometimes wrap it in prose or fences). */
function parseJson(text) {
  const s = String(text || '');
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : s;
  const a = body.indexOf('{');
  if (a < 0) throw new Error('The analyst did not return JSON.');
  // Walk to the matching close brace, minding strings.
  let depth = 0, inStr = false, esc = false;
  for (let i = a; i < body.length; i++) {
    const c = body[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(body.slice(a, i + 1));
  }
  throw new Error('The analyst returned broken JSON.');
}

/** Ask for JSON; one retry with the parse error if the reply isn't valid. */
async function askJson(opts) {
  const r = await askClaude(opts);
  try { return { ...r, json: parseJson(r.text) }; } catch (e) {
    const r2 = await askClaude({ ...opts, tools: [], prompt: `${opts.prompt}\n\nYour previous reply could not be parsed (${e.message}). Reply again with ONLY the JSON object, no prose.\n\nPrevious reply:\n${r.text.slice(0, 6000)}` });
    return { ...r2, costUsd: r.costUsd + r2.costUsd, durationMs: r.durationMs + r2.durationMs, searches: r.searches, pages: r.pages, json: parseJson(r2.text) };
  }
}

module.exports = { askClaude, askJson, parseJson };
