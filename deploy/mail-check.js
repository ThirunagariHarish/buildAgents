#!/usr/bin/env node
// Why might emails not arrive? Prints, for the deploy log (which is public, so
// every address is masked): how the sender is set up, the sending domain's
// SPF and DMARC records, and the last emails the app tried to send.
//   node deploy/mail-check.js <ENV_PREFIX> <mail-log.jsonl>
const dns = require('dns').promises;
const fs = require('fs');
const P = process.argv[2] || 'SC';
const logFile = process.argv[3];
const mask = (e) => String(e || '').replace(/^([^@]{1,2})[^@]*@/, '$1***@');
const addr = (s) => ((String(s || '').match(/<([^>]+)>/) || [, s])[1] || '').trim().toLowerCase();
const user = process.env[`${P}_SMTP_USER`] || '';
const fromRaw = process.env[`${P}_MAIL_FROM`] || user;
const from = addr(fromRaw), fromDomain = from.split('@')[1] || '', userDomain = user.split('@')[1] || '';
(async () => {
  console.log(`   SMTP host ${process.env[`${P}_SMTP_HOST`] || '(none)'}:${process.env[`${P}_SMTP_PORT`] || 465}, login ${mask(user)}`);
  console.log(`   From header ${fromRaw.includes('<') ? `"${fromRaw.split('<')[0].trim().replace(/"/g, '')}" ` : ''}<${mask(from)}>, domain ${fromDomain || '?'}; ${fromDomain === userDomain ? 'same domain as the login (aligned)' : `DIFFERENT from the login's domain ${userDomain}`}`);
  for (const d of [...new Set([fromDomain, userDomain].filter(Boolean))]) {
    const txt = async (n) => (await dns.resolveTxt(n).catch(() => [])).map((r) => r.join(''));
    const spf = (await txt(d)).filter((t) => /^v=spf1/i.test(t));
    const dmarc = (await txt(`_dmarc.${d}`)).filter((t) => /^v=DMARC1/i.test(t));
    const mx = (await dns.resolveMx(d).catch(() => [])).map((m) => m.exchange);
    console.log(`   ${d}: SPF ${spf[0] || 'none'} | DMARC ${dmarc[0] || 'none'} | MX ${mx.slice(0, 2).join(', ') || 'none'}`);
  }
  let lines = [];
  try { lines = fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch {}
  const recent = lines.slice(-12);
  const failed = lines.filter((x) => !x.sent).length;
  console.log(`   mail log: ${lines.length} attempt(s), ${failed} failed${recent.length ? '; latest:' : ''}`);
  for (const x of recent) console.log(`     ${x.at}  ${x.sent ? 'SENT  ' : 'FAILED'}  ${mask(x.to)}  "${x.subject}"${x.error ? `  ${x.error}` : ''}${x.tries > 1 ? `  (${x.tries} tries)` : ''}`);
})();
