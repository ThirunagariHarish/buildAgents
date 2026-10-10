// Agents' notifications in Telegram, for anyone who links a chat.
//
// Needs Pocket Box's own bot (PB_TG_BOT_TOKEN, from @BotFather). It is not
// Box's bot: a bot's updates can only be read by one program, and Box reads
// its own. Without the token this is all switched off.
//
// Linking: the person taps "Connect Telegram", which opens
// t.me/<bot>?start=<one-time code>; Telegram sends "/start <code>" to the bot,
// and that chat is linked to the person. "/stop" in the chat unlinks it.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA } = require('./config');

const FILE = path.join(DATA, 'telegram.json');
const CODE_TTL = 30 * 60 * 1000;
const token = () => process.env.PB_TG_BOT_TOKEN || '';
const configured = () => /^\d+:[\w-]{30,}$/.test(token());

const load = () => { try { return { codes: {}, links: {}, offset: 0, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch { return { codes: {}, links: {}, offset: 0 }; } };
function save(s) { const t = `${FILE}.tmp`; fs.writeFileSync(t, JSON.stringify(s, null, 1), { mode: 0o600 }); fs.renameSync(t, FILE); }

let botName = null;

async function call(method, body, timeoutMs = 15000) {
  const r = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(timeoutMs),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw Object.assign(new Error(j.description || `Telegram said ${r.status}.`), { code: j.error_code });
  return j.result;
}

/** A one-time link that connects the person's Telegram chat. */
function linkFor(userId) {
  if (!configured() || !botName) return null;
  const s = load();
  for (const [c, v] of Object.entries(s.codes)) if (v.userId === userId || v.expiresAt < Date.now()) delete s.codes[c];
  const code = crypto.randomBytes(12).toString('base64url');
  s.codes[code] = { userId, expiresAt: Date.now() + CODE_TTL };
  save(s);
  return `https://t.me/${botName}?start=${code}`;
}

function status(userId) {
  const link = load().links[userId];
  return { available: configured() && !!botName, linked: !!link, name: link ? link.name : null };
}

function unlink(userId) { const s = load(); delete s.links[userId]; save(s); }

const esc = (t) => String(t || '').replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');

/** Send to one person's linked chat. Returns true when Telegram took it. */
async function sendTo(userId, { title, body, url, silent = false }) {
  if (!configured()) return false;
  const link = load().links[userId];
  if (!link) return false;
  const text = `*${esc(title)}*\n${esc(body)}${url ? `\n${esc(url)}` : ''}`;
  try {
    await call('sendMessage', { chat_id: link.chatId, text: text.slice(0, 4000), parse_mode: 'MarkdownV2', disable_web_page_preview: true, disable_notification: !!silent });
    return true;
  } catch (e) {
    // The person blocked the bot or deleted the chat: forget the link.
    if (e.code === 403 || e.code === 400) unlink(userId);
    return false;
  }
}

async function handle(update) {
  const m = update.message;
  if (!m || !m.chat || m.chat.type !== 'private' || typeof m.text !== 'string') return;
  const chatId = m.chat.id;
  const say = (text) => call('sendMessage', { chat_id: chatId, text }).catch(() => {});
  const start = m.text.match(/^\/start(?:\s+([\w-]{8,40}))?/);
  if (start) {
    const s = load();
    const v = start[1] && s.codes[start[1]];
    if (!v || v.expiresAt < Date.now()) return say('That link has expired. In Pocket Box, open You → How agents reach you and tap Connect Telegram again.');
    delete s.codes[start[1]];
    // One chat belongs to one person.
    for (const [uid, l] of Object.entries(s.links)) if (l.chatId === chatId) delete s.links[uid];
    s.links[v.userId] = { chatId, name: [m.chat.first_name, m.chat.username && `@${m.chat.username}`].filter(Boolean).join(' ').slice(0, 60), at: Date.now() };
    save(s);
    require('./bus').toUser(v.userId, { event: 'prefs' });
    return say('Connected. Your Pocket Box agents will message you here. Send /stop to disconnect.');
  }
  if (/^\/stop\b/.test(m.text)) {
    const s = load();
    let found = false;
    for (const [uid, l] of Object.entries(s.links)) if (l.chatId === chatId) { delete s.links[uid]; found = true; }
    save(s);
    return say(found ? 'Disconnected. Agents won\'t message you here any more.' : 'This chat isn\'t connected to Pocket Box.');
  }
  return say('This is Pocket Box. Your agents message you here; to change them, open Pocket Box.');
}

/** Long-poll for /start and /stop. Runs only with the bot token. */
async function start() {
  if (!configured()) return;
  try { botName = (await call('getMe')).username; } catch (e) { console.error(`telegram: ${e.message}`); return; }
  try { await call('deleteWebhook', {}); } catch {}
  console.log(`  Telegram: @${botName}`);
  for (;;) {
    try {
      const s = load();
      const updates = await call('getUpdates', { offset: s.offset, timeout: 50, allowed_updates: ['message'] }, 60000);
      for (const u of updates) {
        await handle(u).catch(() => {});
        const cur = load(); cur.offset = u.update_id + 1; save(cur);
      }
    } catch (e) {
      // Another program reading this bot's updates (409) or the network: wait and retry.
      await new Promise((r) => setTimeout(r, e.code === 409 ? 30000 : 5000));
    }
  }
}

module.exports = { configured, start, linkFor, status, unlink, sendTo };
