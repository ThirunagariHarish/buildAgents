// Outgoing email over SMTPS (implicit TLS, port 465) with no dependencies.
// Works with Gmail (an App Password), Fastmail, Zoho, Resend's SMTP, etc.
//
//   BOX_SMTP_HOST=smtp.gmail.com  BOX_SMTP_PORT=465
//   BOX_SMTP_USER=you@gmail.com   BOX_SMTP_PASS=<app password>
//   BOX_MAIL_FROM="Box <you@gmail.com>"  (defaults to the SMTP user)
//
// When unconfigured, send() resolves { sent: false } and Box shows the links
// to the administrator in the app instead.

const tls = require('tls');

const cfg = () => ({
  host: process.env.BOX_SMTP_HOST || '', port: Number(process.env.BOX_SMTP_PORT || 465),
  user: process.env.BOX_SMTP_USER || '', pass: process.env.BOX_SMTP_PASS || '',
  from: process.env.BOX_MAIL_FROM || process.env.BOX_SMTP_USER || '',
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

/** Send one plain-text email. Resolves { sent, error? }. */
async function send({ to, subject, text }) {
  const c = cfg();
  if (!configured()) return { sent: false, error: 'SMTP is not configured.' };
  try {
    const { sock, expect, send: cmd } = await smtpSession(c);
    await expect([220]);
    await cmd(`EHLO box.local`, [250]);
    await cmd(`AUTH PLAIN ${Buffer.from(`\0${c.user}\0${c.pass}`).toString('base64')}`, [235]);
    const fromAddr = (c.from.match(/<([^>]+)>/) || [, c.from])[1].trim();
    await cmd(`MAIL FROM:<${fromAddr}>`, [250]);
    await cmd(`RCPT TO:<${to}>`, [250, 251]);
    await cmd('DATA', [354]);
    const headers = [
      `From: ${c.from}`, `To: ${to}`, `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
      `Date: ${new Date().toUTCString()}`, `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@box>`,
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

module.exports = { send, configured };
