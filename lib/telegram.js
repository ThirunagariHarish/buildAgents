// Jot in Telegram: free, instant, on every phone and computer. The owner
// creates a bot with @BotFather and pastes its token in Admin. A person taps
// "Connect Telegram" in Settings, which opens t.me/<bot>?start=<one-time code>;
// from then on anything they send the bot (words, links, photos with
// captions) is saved to their Jot, and reminders arrive there too.
//   /stop unlinks the chat.

const fs = require('fs');
const path = require('path');
const store = require('./store');
const secrets = require('./secrets');
const capture = require('./capture');
const voice = require('./voice');

const STATE = path.join(store.DATA, 'telegram-state.json');
let running = false, me = null, lastToken = '', stopFlag = false;

async function call(method, body = {}, timeoutMs = 40000) {
  const r = await fetch(`https://api.telegram.org/bot${secrets.get('telegramToken')}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`Telegram ${method}: ${j.description || r.status}`);
  return j.result;
}
const say = (chatId, text) => call('sendMessage', { chat_id: chatId, text: String(text).slice(0, 4000), disable_web_page_preview: true }, 15000).catch((e) => console.error(e.message));

async function photo(fileId) {
  const f = await call('getFile', { file_id: fileId }, 15000);
  if (!f.file_path || f.file_size > 12 * 1024 * 1024) return null;
  const r = await fetch(`https://api.telegram.org/file/bot${secrets.get('telegramToken')}/${f.file_path}`, { signal: AbortSignal.timeout(30000) });
  return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
}

async function handle(u) {
  const m = u.message || u.edited_message;
  if (!m || !m.chat || m.chat.type !== 'private') return;
  const chatId = m.chat.id;
  const text = String(m.text || m.caption || '').trim();
  const start = text.match(/^\/start(?:\s+([\w-]{6,40}))?$/);
  if (start) {
    const uid = start[1] ? store.takeCode('tg', start[1]) : null;
    if (uid) { store.linkTelegram(chatId, uid); return say(chatId, 'Linked. Send me anything: a thought, a link, a photo. Add #tags to sort it, or say "remind me to call John at 5pm". Type "help" for more.'); }
    return say(chatId, store.userForTelegram(chatId) ? 'You are already linked. Send me anything to save it.' : 'To link this chat, open Jot, go to Settings and tap Connect Telegram.');
  }
  const uid = store.userForTelegram(chatId);
  if (!uid) return say(chatId, 'This chat is not linked to a Jot account yet. Open Jot, go to Settings and tap Connect Telegram.');
  if (/^\/stop$/.test(text)) { store.unlinkTelegram(uid); return say(chatId, 'Unlinked. Your notes stay in Jot.'); }
  store.touch(uid, 'telegram');
  const tz = store.channelsOf(uid).prefs.tz || 'UTC';
  // A voice note becomes a jot of its words.
  const audio = m.voice || m.audio;
  if (audio) {
    if (audio.duration > 180) return say(chatId, 'That voice note is over 3 minutes. Send shorter ones, or type it.');
    let said = '';
    try { const buf = await photo(audio.file_id); said = buf ? await voice.transcribeFile(buf) : ''; } catch (e) { console.error(`telegram voice: ${e.message}`); return say(chatId, 'I could not listen to voice notes just now. Type it instead, or try again later.'); }
    if (!said) return say(chatId, "I couldn't make out any words in that one. Try again a little closer to the mic.");
    const r = await capture.jot(uid, { text: [said, text].filter(Boolean).join('\n'), source: 'telegram', voice: true, tz });
    return say(chatId, `${r.reply}\n\nI heard: "${said.slice(0, 300)}"`);
  }
  const cmd = capture.command(uid, text.replace(/^\//, ''), tz);
  if (cmd && !(m.photo && m.photo.length)) return say(chatId, cmd);
  const images = [];
  if (m.photo && m.photo.length) { try { const b = await photo(m.photo[m.photo.length - 1].file_id); if (b) images.push(b); } catch (e) { console.error(e.message); } }
  else if (m.document && /^image\//.test(m.document.mime_type || '')) { try { const b = await photo(m.document.file_id); if (b) images.push(b); } catch {} }
  const r = await capture.jot(uid, { text, images, source: 'telegram', tz });
  return say(chatId, r.reply);
}

/** Long-poll for messages while a token is set; picks up a new token by itself. */
async function loop() {
  if (running) return;
  running = true;
  let state = store.readJson(STATE, { offset: 0 });
  while (!stopFlag) {
    const token = secrets.get('telegramToken');
    if (!token) { me = null; await new Promise((r) => setTimeout(r, 15000)); continue; }
    if (token !== lastToken) { lastToken = token; me = null; try { me = await call('getMe', {}, 15000); } catch (e) { console.error(e.message); await new Promise((r) => setTimeout(r, 30000)); continue; } }
    try {
      const updates = await call('getUpdates', { offset: state.offset, timeout: 25, allowed_updates: ['message', 'edited_message'] });
      for (const u of updates) {
        state.offset = u.update_id + 1;
        try { await handle(u); } catch (e) { console.error(`telegram: ${e.message}`); }
      }
      if (updates.length) store.writeJson(STATE, state);
    } catch (e) {
      console.error(e.message);
      await new Promise((r) => setTimeout(r, 10000));
    }
  }
  running = false;
}
function stop() { stopFlag = true; }

/** For reminders. */
async function sendTo(uid, text) {
  const chat = store.channelsOf(uid).telegram;
  if (!chat || !secrets.get('telegramToken')) return false;
  try { await call('sendMessage', { chat_id: chat, text: String(text).slice(0, 4000) }, 15000); return true; } catch (e) { console.error(e.message); return false; }
}
/** The deep link a person taps to connect (null until the bot is set up). */
async function connectLink(uid) {
  if (!secrets.get('telegramToken')) return null;
  if (!me) { try { me = await call('getMe', {}, 15000); lastToken = secrets.get('telegramToken'); } catch { return null; } }
  return `https://t.me/${me.username}?start=${store.issueCode('tg', uid)}`;
}
const botName = () => (me ? me.username : null);

module.exports = { loop, stop, sendTo, connectLink, botName, handle };
