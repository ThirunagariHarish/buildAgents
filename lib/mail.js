// Outgoing email over SMTPS (implicit TLS, port 465) with no dependencies.
// Works with Gmail (an App Password), Fastmail, Zoho, Resend's SMTP, etc.
//
//   SC_SMTP_HOST=smtp.gmail.com  SC_SMTP_PORT=465
//   SC_SMTP_USER=you@gmail.com   SC_SMTP_PASS=<app password>
//   SC_MAIL_FROM="Run Scenario <you@gmail.com>"  (defaults to the SMTP user)
//
// When unconfigured, send() resolves { sent: false } and Run Scenario shows the links
// to the administrator in the app instead.

const tls = require('tls');

const cfg = () => ({
  host: process.env.SC_SMTP_HOST || '', port: Number(process.env.SC_SMTP_PORT || 465),
  user: process.env.SC_SMTP_USER || '', pass: process.env.SC_SMTP_PASS || '',
  from: process.env.SC_MAIL_FROM || process.env.SC_SMTP_USER || '',
});
function configured() { const c = cfg(); return !!(c.host && c.user && c.pass); }

function smtpSession(c) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host: c.host, port: c.port, servername: c.host, timeout: 15000 });
    let buf = '';
    const waiters = [];
    const fail = (e) => { try { sock.destroy(); } catch {} reject(e); };
    sock.on('error', fail);
    sock.on('timeout', () => fail(new Error('SMTP timeout')));
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        // Multi-line replies: "250-..." continue, "250 ..." ends.
        if (/^\d{3}-/.test(line)) continue;
        const w = waiters.shift();
        if (w) w(line);
      }
    });
    const expect = (okCodes) => new Promise((res, rej) => waiters.push((line) => {
      const code = Number(line.slice(0, 3));
      if (okCodes.includes(code)) res(line); else rej(new Error(`SMTP: ${line}`));
    }));
    const send = (cmd, ok) => { sock.write(`${cmd}\r\n`); return expect(ok); };
    sock.once('secureConnect', () => resolve({ sock, expect, send }));
  });
}

/**
 * Send one plain-text email. Resolves { sent, error? }. A failure that may be
 * temporary (timeout, connection, 4xx) is retried twice with a pause; a
 * refused login or address is not. Every send is logged (no content).
 */
async function send(msg) {
  let r, tries = 0;
  for (const wait of [0, 3000, 10000]) {
    if (wait) await new Promise((res) => setTimeout(res, wait));
    tries++;
    r = await sendOnce(msg);
    if (r.sent || /SMTP: (5\d\d)/.test(r.error || '') || /not configured/.test(r.error || '')) break;
  }
  if (!r.sent) console.error(`mail to ${String(msg.to).replace(/^([^@]{1,2})[^@]*@/, '$1***@')} failed after ${tries} tries: ${r.error}`);
  try {
    const { DATA } = require('./config');
    const fs = require('fs');
    const line = JSON.stringify({ at: new Date().toISOString(), to: msg.to, subject: msg.subject, sent: r.sent, error: r.error || null, tries });
    fs.appendFileSync(require('path').join(DATA, 'mail-log.jsonl'), `${line}\n`, { mode: 0o600 });
  } catch {}
  return r;
}

async function sendOnce({ to, subject, text }) {
  const c = cfg();
  if (!configured()) return { sent: false, error: 'SMTP is not configured.' };
  try {
    const { sock, expect, send: cmd } = await smtpSession(c);
    await expect([220]);
    await cmd(`EHLO scenario.local`, [250]);
    await cmd(`AUTH PLAIN ${Buffer.from(`\0${c.user}\0${c.pass}`).toString('base64')}`, [235]);
    // Gmail and most providers only deliver reliably (DMARC) when the From
    // address belongs to the account that logs in; a different address goes in Reply-To.
    let fromAddr = (c.from.match(/<([^>]+)>/) || [, c.from])[1].trim();
    const name = c.from.includes('<') ? c.from.split('<')[0].trim().replace(/^"|"$/g, '') : 'Run Scenario';
    let replyTo = null;
    if (fromAddr.toLowerCase() !== c.user.toLowerCase() && fromAddr.split('@')[1] !== c.user.split('@')[1]) { replyTo = fromAddr; fromAddr = c.user; }
    const fromHeader = `${name ? `=?UTF-8?B?${Buffer.from(name).toString('base64')}?= ` : ''}<${fromAddr}>`;
    await cmd(`MAIL FROM:<${fromAddr}>`, [250]);
    await cmd(`RCPT TO:<${to}>`, [250, 251]);
    await cmd('DATA', [354]);
    const headers = [
      `From: ${fromHeader}`, `To: <${to}>`, ...(replyTo ? [`Reply-To: <${replyTo}>`] : []), `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
      `Date: ${new Date().toUTCString()}`, `Message-ID: <${Date.now()}.${require('crypto').randomBytes(6).toString('hex')}@${fromAddr.split('@')[1] || 'localhost'}>`,
      'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: 8bit', 'Auto-Submitted: auto-generated',
    ];
    const body = String(text).replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    sock.write(`${headers.join('\r\n')}\r\n\r\n${body}\r\n.\r\n`);
    await expect([250]);
    await cmd('QUIT', [221]).catch(() => {});
    sock.end();
    return { sent: true };
  } catch (e) {
    return { sent: false, error: e.message };
  }
}

/** Log in and out without sending anything: { ok, error? }. */
async function verify() {
  const c = cfg();
  if (!configured()) return { ok: false, error: 'SMTP is not configured.' };
  try {
    const { sock, expect, send: cmd } = await smtpSession(c);
    await expect([220]);
    await cmd('EHLO scenario.local', [250]);
    await cmd(`AUTH PLAIN ${Buffer.from(`\0${c.user}\0${c.pass}`).toString('base64')}`, [235]);
    await cmd('QUIT', [221]).catch(() => {});
    sock.end();
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

module.exports = { send, configured, verify };
