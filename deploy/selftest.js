// Offline test of Jot: a real server on a scratch data folder, a fake Claude,
// fake Twilio and Stripe secrets, and requests the way the app and the
// outside services make them. Run: node deploy/selftest.js
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const { spawn } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jt-test-'));
const PORT = 34000 + Math.floor(Math.random() * 1000);
const BASE = `http://localhost:${PORT}`;
const env = {
  JT_DATA_DIR: path.join(tmp, 'data'), JT_PORT: String(PORT), JT_PUBLIC_URL: BASE, JT_SCHEDULE: '0',
  JT_CLAUDE_BIN: path.join(__dirname, 'fake-claude.js'), JT_ADMIN_EMAIL: 'owner@example.com',
  JT_TWILIO_SID: `AC${'a'.repeat(32)}`, JT_TWILIO_TOKEN: 'b'.repeat(32), JT_TWILIO_FROM: '+15550001111',
  JT_STRIPE_WEBHOOK: `whsec_${'c'.repeat(24)}`, JT_FAKE_SPEECH: 'remind me to call the plumber in 2 hours',
};
Object.assign(process.env, env);
fs.chmodSync(env.JT_CLAUDE_BIN, 0o755);

const when = require('../lib/when');
const links = require('../lib/links');
const auth = require('../lib/auth');
let n = 0;
const ok = (m) => { n++; console.log(`  ok ${m}`); };

function client() {
  let cookie = '';
  return async (url, { method = 'GET', body, headers = {}, raw } = {}) => {
    const r = await fetch(BASE + url, { method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: raw != null ? raw : body ? JSON.stringify(body) : undefined, redirect: 'manual' });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
    return { status: r.status, j, t, headers: r.headers };
  };
}
async function account(email, name) {
  const inv = auth.invite({ email, firstName: name });
  auth.resetPassword({ token: inv.token, password: 'a-good-pass-123' });
  const c = client();
  const r = await c('/api/login', { method: 'POST', body: { email, password: 'a-good-pass-123' } });
  assert.strictEqual(r.status, 200, r.t);
  return { c, id: inv.user.id };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await wait(100); } throw new Error('timed out'); }

let server;
(async () => {
  // Reminders, without a server.
  const now = Date.UTC(2026, 9, 27, 14, 0); // Tue 27 Oct 2026, 10:00 in New York
  const tz = 'America/New_York';
  const at = (t) => when.parseReminder(t, { now, tz });
  const local = (ms) => new Date(ms).toLocaleString('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' });
  assert.strictEqual(at('remind me in 30 minutes to stretch').at, now + 30 * 60000);
  assert.strictEqual(at('remind me in 30 minutes to stretch').text, 'Stretch');
  assert.match(local(at('remind me to call Sam at 5pm').at), /Oct 27.*5:00/);
  assert.match(local(at('remind me tomorrow morning: dentist').at), /Wed, Oct 28.*9:00/);
  assert.match(local(at('remind me on friday at 3:30pm: dentist').at), /Fri, Oct 30.*3:30/);
  assert.match(local(at('remind me Nov 3 to renew the passport').at), /Nov 3/);
  assert.strictEqual(at('just a thought about pricing'), null);
  ok('reminder times parse in the person\'s time zone');
  assert(links.privateIp('10.0.0.5') && links.privateIp('127.0.0.1') && links.privateIp('169.254.169.254') && links.privateIp('::1') && !links.privateIp('8.8.8.8'));
  await assert.rejects(links.safeGet('http://127.0.0.1:1/'));
  ok('link previews refuse private addresses');

  // The server.
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; server.stdout.on('data', (d) => (log += d)); server.stderr.on('data', (d) => (log += d));
  await until(async () => { try { return (await fetch(`${BASE}/api/public`)).ok; } catch { return false; } });
  const anon = client();
  assert.strictEqual((await anon('/api/notes')).status, 401);
  const pub = (await anon('/api/public')).j;
  assert.strictEqual(pub.access, 'open'); assert.strictEqual(pub.sms, true);
  const home = await anon('/');
  assert(home.status === 200 && /app\.js/.test(home.t) && /default-src 'self'/.test(home.headers.get('content-security-policy')));
  ok('server starts; sign-in enforced; security headers');

  // Accounts.
  await until(() => auth.listUsers().some((u) => u.email === 'owner@example.com'));
  const owner = auth.listUsers().find((u) => u.email === 'owner@example.com');
  assert(owner.primary && owner.role === 'admin');
  const su = await anon('/api/signup', { method: 'POST', body: { firstName: 'Ana', email: 'ana@example.com' } });
  assert.strictEqual(su.status, 200, su.t);
  assert.strictEqual(auth.listUsers().find((u) => u.email === 'ana@example.com').status, 'unverified');
  const A = await account('alex@example.com', 'Alex');
  const B = await account('bea@example.com', 'Bea');
  ok('open sign-up waits for email confirmation; invited accounts sign in');

  // Jots.
  let r = await A.c('/api/notes', { method: 'POST', body: { text: 'pricing idea: annual plan at 2 months free #Growth #growth', tz } });
  assert.strictEqual(r.status, 200, r.t);
  assert.deepStrictEqual(r.j.note.tags, ['growth']);
  const n1 = r.j.note.id;
  r = await A.c('/api/notes', { method: 'POST', body: { text: 'remind me to send the deck to Priya in 2 hours', tz } });
  assert(r.j.note.remind && /Send the deck to Priya/.test(r.j.note.remind.text) && /remind you/.test(r.j.reply));
  const n2 = r.j.note.id;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  r = await A.c('/api/notes', { method: 'POST', body: { text: 'whiteboard from the offsite #work', images: [`data:image/png;base64,${png.toString('base64')}`, 'data:image/png;base64,bm90IGFuIGltYWdl'] } });
  assert.strictEqual(r.j.note.images.length, 1, 'non-images are dropped');
  const pic = r.j.note.images[0];
  assert.strictEqual((await A.c(pic)).status, 200);
  assert.strictEqual((await B.c(pic)).status, 404, 'another person cannot open the picture');
  assert.strictEqual((await anon(pic)).status, 401);
  assert.strictEqual((await A.c('/media/..%2F..%2Fusers.json')).status, 404);
  assert.strictEqual((await B.c(`/api/notes/${n1}`)).status, 404, 'another person cannot open the jot');
  assert.strictEqual((await A.c('/api/notes', { method: 'POST', body: { text: '   ' } })).status, 400);
  ok('jots: tags, reminders, pictures; each person sees only their own');

  r = await A.c('/api/notes?q=ANNUAL plan');
  assert.deepStrictEqual(r.j.notes.map((x) => x.id), [n1]);
  r = await A.c('/api/notes?tag=work');
  assert.strictEqual(r.j.notes.length, 1);
  r = await A.c(`/api/notes?from=${Date.now() + 864e5}`);
  assert.strictEqual(r.j.notes.length, 0);
  r = await A.c('/api/tags');
  assert.deepStrictEqual(r.j.tags.map((t) => t.tag).sort(), ['growth', 'work']);
  assert.strictEqual((await B.c('/api/notes?q=annual')).j.notes.length, 0);
  ok('search by words, tag and date');

  // Speaking instead of typing.
  assert(/microphone=\(self\)/.test(home.headers.get('permissions-policy')), 'the page may use the microphone');
  assert.strictEqual((await A.c('/api/session')).j.speech, true);
  r = await A.c('/api/transcribe', { method: 'POST', raw: Buffer.alloc(32000), headers: { 'Content-Type': 'application/octet-stream' } });
  assert.strictEqual(r.j.text, 'remind me to call the plumber in 2 hours', r.t);
  assert.strictEqual((await A.c('/api/transcribe', { method: 'POST', raw: Buffer.alloc(100), headers: { 'Content-Type': 'application/octet-stream' } })).status, 400, 'too short');
  assert.strictEqual((await anon('/api/transcribe', { method: 'POST', raw: Buffer.alloc(32000), headers: { 'Content-Type': 'application/octet-stream' } })).status, 401);
  r = await A.c('/api/notes', { method: 'POST', body: { text: r.j.text, voice: true, tz } });
  assert(r.j.note.voice && r.j.note.remind, 'a spoken jot is marked and its reminder set');
  await A.c(`/api/notes/${r.j.note.id}`, { method: 'DELETE' });
  ok('voice: transcription, spoken jots, microphone allowed');

  r = await A.c(`/api/notes/${n1}`, { method: 'PATCH', body: { pinned: true, text: 'pricing idea: annual plan at 2 months free #growth #pricing' } });
  assert(r.j.note.pinned && r.j.note.tags.includes('pricing'));
  r = await A.c('/api/notes?pinned=1');
  assert.deepStrictEqual(r.j.pinned.map((x) => x.id), [n1]);
  r = await A.c(`/api/notes/${n2}/remind`, { method: 'POST', body: { snoozeMin: 60 } });
  assert(r.j.note.remind.at > Date.now() + 59 * 60000 && r.j.when);
  assert.strictEqual((await A.c(`/api/notes/${n2}/remind`, { method: 'POST', body: { at: Date.now() - 1000 } })).status, 400);
  r = await A.c('/api/reminders');
  assert.deepStrictEqual(r.j.upcoming.map((x) => x.id), [n2]);
  r = await A.c('/api/export?format=md');
  assert(/annual plan/.test(r.t) && /attachment/.test(r.headers.get('content-disposition')));
  ok('pin, edit, snooze, reminders list, export');

  // The personal capture link (iPhone Shortcuts).
  const s = (await A.c('/api/settings')).j;
  const capPath = new URL(s.capture).pathname;
  r = await anon(capPath, { method: 'POST', body: { text: 'from the share sheet https://example.invalid/post #reading' } });
  assert(r.j.ok, r.t);
  r = await anon(capPath, { method: 'POST', raw: 'text=plain+form+post', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert(r.j.ok);
  assert.strictEqual((await anon('/in/notarealtokenatallxxxxxx', { method: 'POST', body: { text: 'x' } })).status, 404);
  r = await A.c('/api/notes?tag=reading');
  assert.strictEqual(r.j.notes[0].source, 'shortcut');
  await A.c('/api/channels/capture', { method: 'POST' });
  assert.strictEqual((await anon(capPath, { method: 'POST', body: { text: 'old link' } })).status, 404, 'a new link retires the old one');
  ok('capture link saves jots; a new link retires the old');

  // Texts through Twilio: linking with a code, then jots and commands.
  const twilio = async (params, sig) => {
    const data = `${BASE}/sms/twilio${Object.keys(params).sort().map((k) => k + params[k]).join('')}`;
    const good = crypto.createHmac('sha1', env.JT_TWILIO_TOKEN).update(data).digest('base64');
    return anon('/sms/twilio', { method: 'POST', raw: new URLSearchParams(params).toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': sig || good } });
  };
  assert.strictEqual((await twilio({ From: '+15551234567', Body: 'hi' }, 'forged')).status, 403);
  r = await twilio({ From: '+15551234567', Body: 'hi' });
  assert(/not linked/.test(r.t));
  const code = (await A.c('/api/channels/sms', { method: 'POST' })).j.code;
  r = await twilio({ From: '+15551234567', Body: `link ${code}` });
  assert(/Linked/.test(r.t), r.t);
  assert(/expired/.test((await twilio({ From: '+15559999999', Body: `LINK ${code}` })).t), 'a code works once');
  r = await twilio({ From: '+15551234567', Body: 'book: Four Thousand Weeks #reading' });
  assert(/Saved/.test(r.t) && /#reading/.test(r.t));
  r = await twilio({ From: '+15551234567', Body: 'find annual' });
  assert(/annual plan/.test(r.t), r.t);
  assert.strictEqual((await A.c('/api/notes?q=thousand')).j.notes[0].source, 'sms');
  ok('texts: signature checked, LINK code once, jots and "find"');

  // AI: owner, admins and granted people only.
  assert.strictEqual((await A.c('/api/ask', { method: 'POST', body: { question: 'pricing?' } })).status, 403);
  const O = client();
  const oinv = auth.relink(owner.id); auth.resetPassword({ token: oinv.token, password: 'owner-pass-123' });
  assert.strictEqual((await O('/api/login', { method: 'POST', body: { email: 'owner@example.com', password: 'owner-pass-123' } })).status, 200);
  assert.strictEqual((await O(`/api/people/${A.id}`, { method: 'POST', body: { ai: true } })).status, 200);
  r = await A.c('/api/ask', { method: 'POST', body: { question: 'What did I decide about pricing?' } });
  assert.strictEqual(r.status, 200, r.t);
  assert(/annual plan/.test(r.j.answer) && r.j.cited.length === 1 && r.j.cited[0].note.id === n1, JSON.stringify(r.j));
  await A.c('/api/notes', { method: 'POST', body: { text: 'try a weekly digest email for power users' } });
  r = await until(async () => { const x = (await A.c('/api/notes?q=digest')).j.notes[0]; return x.aiTags.length ? x : null; });
  assert.deepStrictEqual(r.aiTags, ['ideas', 'product']);
  ok('AI: ask cites the right jot; auto-tags only for people allowed');

  // Admin.
  assert.strictEqual((await A.c('/api/admin')).status, 403);
  r = await O('/api/admin');
  assert(r.j.viewerIsOwner && r.j.stats.notes === 7 && r.j.stats.viaSms === 1 && r.j.secrets.twilioSid.set);
  assert(!JSON.stringify(r.j).includes(env.JT_TWILIO_TOKEN), 'keys are never shown');
  assert.strictEqual((await O(`/api/people/${B.id}`, { method: 'POST', body: { role: 'admin' } })).status, 200);
  assert.strictEqual((await B.c('/api/admin')).status, 200, 'a new administrator sees Admin');
  assert.strictEqual((await B.c('/api/admin/settings', { method: 'POST', body: { access: 'paid' } })).status, 403, 'only the owner changes access');
  assert.strictEqual((await B.c('/api/admin')).j.secrets, null);
  assert.strictEqual((await O('/api/admin/secret', { method: 'POST', body: { name: 'stripeSecret', value: 'nope' } })).status, 400);
  r = await O('/api/admin/invite', { method: 'POST', body: { email: 'cara@example.com', name: 'Cara' } });
  assert(r.j.link && /#\/reset\//.test(r.j.link), 'without mail, the link is handed back');
  r = await O('/api/admin/settings', { method: 'POST', body: { access: 'invite', priceCents: 1900 } });
  assert.strictEqual(r.j.settings.access, 'invite');
  assert.strictEqual((await anon('/api/signup', { method: 'POST', body: { firstName: 'Dan', email: 'dan@example.com' } })).status, 403);
  ok('admin: owner-only keys and access; invite; promote');

  // Stripe: a signed, paid checkout makes an account once.
  const event = { id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_test_abcdefghijklmnop', payment_status: 'paid', amount_total: 1900, currency: 'usd', customer_details: { email: 'Buyer@Example.com', name: 'Bo Buyer' }, metadata: { app: 'jot' } } } };
  const raw = JSON.stringify(event);
  const sign = (t, body) => `t=${t},v1=${crypto.createHmac('sha256', env.JT_STRIPE_WEBHOOK).update(`${t}.${body}`).digest('hex')}`;
  const t0 = Math.floor(Date.now() / 1000);
  assert.strictEqual((await anon('/stripe/webhook', { method: 'POST', raw, headers: { 'Stripe-Signature': `t=${t0},v1=${'0'.repeat(64)}` } })).status, 400);
  assert.strictEqual((await anon('/stripe/webhook', { method: 'POST', raw, headers: { 'Stripe-Signature': sign(t0 - 900, raw) } })).status, 400, 'old signatures are refused');
  r = await anon('/stripe/webhook', { method: 'POST', raw, headers: { 'Stripe-Signature': sign(t0, raw) } });
  assert(r.j.ok, r.t);
  r = await anon('/stripe/webhook', { method: 'POST', raw, headers: { 'Stripe-Signature': sign(t0, raw) } });
  assert(r.j.duplicate);
  const buyer = auth.listUsers().find((u) => u.email === 'buyer@example.com');
  assert(buyer && buyer.plan === 'lifetime' && buyer.firstName === 'Bo');
  assert.strictEqual((await O('/api/admin')).j.stats.purchases, 1);
  ok('Stripe: signature and age checked; one account per purchase');

  // Reminders go out once (no channels here, so nothing is delivered, but it is marked sent).
  const store = require('../lib/store');
  store.updateNote(A.id, n2, { remind: { ...store.getNote(A.id, n2).remind, at: Date.now() - 1000 } });
  const reminders = require('../lib/reminders');
  assert.strictEqual(await reminders.tick(), 1);
  assert.strictEqual(await reminders.tick(), 0, 'never sent twice');
  ok('due reminders are sent once');

  // Deleting an account removes its jots and pictures.
  r = await B.c('/api/account', { method: 'DELETE', body: { confirm: 'DELETE' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await B.c('/api/notes')).status, 401);
  assert.strictEqual((await O('/api/account', { method: 'DELETE', body: { confirm: 'DELETE' } })).status, 400, 'the owner cannot delete their account');
  ok('account deletion');

  assert(!/Error|TypeError/.test(log.replace(/sms: .*|link preview.*/g, '')), log);
  console.log(`\n${n} passed`);
  server.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(0);
})().catch((e) => { console.error(e); if (server) server.kill(); process.exit(1); });
