// Speech to text on our own server, for phones whose browser can't dictate
// live and for Telegram voice notes. It reuses the Whisper model that Run
// Scenario installs on the same machine (a Python sidecar and its model
// cache), so nothing is sent to an outside service. Without it, the app
// still dictates live wherever the browser can.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const PYTHON = process.env.JT_SPEECH_PYTHON || '/opt/scenario-venv/bin/python';
const SCRIPT = process.env.JT_SPEECH_SCRIPT || '/opt/scenario/models/sidecar.py';
const HF = process.env.JT_SPEECH_HF || '/opt/scenario/data/hf';
const FAKE = process.env.JT_FAKE_SPEECH || '';

const available = () => !!FAKE || (fs.existsSync(PYTHON) && fs.existsSync(SCRIPT));
let ffmpegPath;
function ffmpeg() {
  if (ffmpegPath === undefined) { try { ffmpegPath = execFileSync('sh', ['-c', 'command -v ffmpeg'], { encoding: 'utf8' }).trim() || null; } catch { ffmpegPath = null; } }
  return ffmpegPath;
}

// One recording at a time: the model is memory-heavy.
let chain = Promise.resolve();
function run(pcm) {
  const job = () => new Promise((resolve, reject) => {
    if (FAKE) return resolve(pcm.length ? FAKE : '');
    const file = path.join(os.tmpdir(), `jt-voice-${crypto.randomBytes(6).toString('hex')}.pcm`);
    fs.writeFileSync(file, pcm, { mode: 0o600 });
    const child = spawn(PYTHON, [SCRIPT], { env: { PATH: process.env.PATH, HOME: process.env.HOME || '/root', HF_HOME: HF, LANG: 'C.UTF-8' } });
    let out = '', err = '';
    const t = setTimeout(() => child.kill('SIGKILL'), 180000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(t); fs.rmSync(file, { force: true }); reject(e); });
    child.on('close', (code) => {
      clearTimeout(t); fs.rmSync(file, { force: true });
      try { const j = JSON.parse(out); if (j.error) throw new Error(j.error); resolve(String(j.text || '')); }
      catch (e) { reject(new Error(`speech failed (exit ${code}): ${(err || e.message).trim().split('\n').slice(-1)[0].slice(0, 200)}`)); }
    });
    child.stdin.end(JSON.stringify({ mode: 'transcribe', path: file }));
  });
  const p = chain.then(job, job);
  chain = p.catch(() => {});
  return p;
}
const tidy = (t) => (/[\p{L}\p{N}]/u.test(t) ? t.replace(/(\s*\.){3,}/g, '.').replace(/\s+/g, ' ').trim() : '');

/** 16 kHz mono 16-bit PCM (what the app sends) to text. */
async function transcribe(pcm) {
  if (!available()) throw Object.assign(new Error('Speech is not set up on this server.'), { status: 503 });
  return tidy(await run(pcm));
}

/** Any audio file (a Telegram voice note) to text, through ffmpeg. */
async function transcribeFile(buf) {
  if (FAKE) return tidy(FAKE);
  if (!available() || !ffmpeg()) throw new Error('Voice notes need ffmpeg and the speech model on the server.');
  const pcm = await new Promise((resolve, reject) => {
    const ff = spawn(ffmpeg(), ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-t', '120', '-f', 's16le', '-ac', '1', '-ar', '16000', 'pipe:1']);
    const chunks = []; let err = '';
    ff.stdout.on('data', (d) => chunks.push(d));
    ff.stderr.on('data', (d) => (err += d));
    ff.on('error', reject);
    ff.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg: ${err.slice(0, 200)}`))));
    ff.stdin.on('error', () => {});
    ff.stdin.end(buf);
  });
  return tidy(await run(pcm));
}

module.exports = { available, transcribe, transcribeFile, ffmpeg };
