// Text Jot by SMS (and MMS pictures) through Twilio. One Jot number for
// everyone: a person links their own phone by texting "LINK 123456" (a code
// from Settings) to it, which also proves the phone is theirs. After that,
// every text from that phone is saved to their Jot, and reminders can come
// back by text. Twilio posts each incoming text to /sms/twilio; we check its
// signature with the auth token before believing it.

const crypto = require('crypto');
const store = require('./store');
const secrets = require('./secrets');
const capture = require('./capture');
const { BASE_URL } = require('./config');

const configured = () => !!(secrets.get('twilioSid') && secrets.get('twilioToken') && secrets.get('twilioFrom'));
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const twiml = (msg) => `<?xml version="1.0" encoding="UTF-8"?><Response>${msg ? `<Message>${xml(String(msg).slice(0, 1500))}</Message>` : ''}</Response>`;

/** Twilio's request signature: HMAC-SHA1 over the URL plus every POST field, sorted. */
function validSignature(signature, params, url = `${BASE_URL}/sms/twilio`) {
  const token = secrets.get('twilioToken');
  if (!token || !signature) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const expected = crypto.createHmac('sha1', token).update(data).digest('base64');
  const a = Buffer.from(expected), b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function mediaFrom(url) {
  if (!/^https:\/\/api\.twilio\.com\//.test(url)) return null;
  const auth = Buffer.from(`${secrets.get('twilioSid')}:${secrets.get('twilioToken')}`).toString('base64');
  let r = await fetch(url, { headers: { Authorization: `Basic ${auth}` }, redirect: 'manual', signal: AbortSignal.timeout(20000) });
  // Twilio redirects media to its storage; follow once, without our credentials.
  if (r.status >= 300 && r.status < 400 && r.headers.get('location')) r = await fetch(r.headers.get('location'), { signal: AbortSignal.timeout(20000) });
  if (!r.ok) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  return buf.length <= 12 * 1024 * 1024 ? buf : null;
}

/** An incoming text (Twilio's form fields). Returns the TwiML reply. */
async function incoming(params) {
  const from = String(params.From || '').trim();
  const body = String(params.Body || '').trim();
  if (!/^\+[1-9]\d{6,14}$/.test(from)) return twiml(null);
  const link = body.match(/^link\s+(\d{6})$/i);
  if (link) {
    const uid = store.takeCode('sms', link[1]);
    if (!uid) return twiml('That code has expired. Get a new one in Jot, Settings, Text to Jot.');
    store.linkPhone(from, uid);
    return twiml('Linked. Text this number anything and it is saved to your Jot. Add #tags, or "remind me to call John at 5pm". Reply HELP for more.');
  }
  const uid = store.userForPhone(from);
  if (!uid) return twiml('This phone is not linked to a Jot account. Open Jot, Settings, Text to Jot, and follow the steps.');
  store.touch(uid, 'sms');
  const tz = store.channelsOf(uid).prefs.tz || 'UTC';
  const n = Math.min(Number(params.NumMedia) || 0, 6);
  const cmd = n ? null : capture.command(uid, body, tz);
  if (cmd) return twiml(cmd);
  const images = [];
  for (let i = 0; i < n; i++) if (/^image\//.test(String(params[`MediaContentType${i}`] || ''))) { try { const b = await mediaFrom(String(params[`MediaUrl${i}`] || '')); if (b) images.push(b); } catch {} }
  const r = await capture.jot(uid, { text: body, images, source: 'sms', tz });
  return twiml(r.reply);
}

/** Send a text (reminders). */
async function sendTo(uid, text) {
  const to = store.channelsOf(uid).phone;
  if (!to || !configured()) return false;
  const sid = secrets.get('twilioSid');
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${secrets.get('twilioToken')}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: secrets.get('twilioFrom'), Body: String(text).slice(0, 1500) }),
    signal: AbortSignal.timeout(15000),
  }).catch((e) => ({ ok: false, statusText: e.message }));
  if (!r.ok) console.error(`sms: ${r.status || ''} ${r.statusText || ''}`);
  return !!r.ok;
}

module.exports = { configured, incoming, sendTo, validSignature, twiml, number: () => secrets.get('twilioFrom') || null };
