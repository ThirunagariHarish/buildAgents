// Opens the real login page in Chromium and signs in with the cluster's first-admin login (read from a file).
import { chromium } from 'playwright';
import fs from 'node:fs';
const [email, password] = fs.readFileSync(process.argv[2], 'utf8').split('\n');
const site = 'https://unusual-options-detector.cashflowus.com';
const mask = (t) => String(t).replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, '<email>');
for (const [label, opts] of [['desktop', { viewport: { width: 1280, height: 800 } }], ['iphone', { viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1', isMobile: true, hasTouch: true }]]) {
  const b = await chromium.launch(); const ctx = await b.newContext(opts); const p = await ctx.newPage();
  const errs = []; p.on('console', (m) => m.type() === 'error' && errs.push(mask(m.text()).slice(0, 160))); p.on('pageerror', (e) => errs.push('pageerror ' + mask(e.message).slice(0, 160)));
  const calls = []; p.on('response', (r) => { if (r.url().includes('/api/')) calls.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
  await p.goto(site + '/login', { waitUntil: 'networkidle' });
  const inputs = await p.$$eval('input', (els) => els.map((e) => `${e.type}:${e.name || e.id || e.autocomplete}`));
  console.log(`[${label}] login page inputs: ${inputs.join(', ')}`);
  await p.fill('input[type=email], input[name=email]', email);
  await p.fill('input[type=password]', password);
  await p.click('button[type=submit]');
  await p.waitForTimeout(6000);
  console.log(`[${label}] after submit: ${new URL(p.url()).pathname}; calls: ${calls.join(' | ')}`);
  const alert = await p.$$eval('[role=alert], .text-destructive, [aria-live]', (els) => els.map((e) => e.textContent.trim()).filter(Boolean));
  if (alert.length) console.log(`[${label}] messages shown: ${mask(alert.join(' / ')).slice(0, 300)}`);
  if (errs.length) console.log(`[${label}] console errors: ${errs.slice(0, 5).join(' | ')}`);
  const cookies = (await ctx.cookies()).map((c) => `${c.name} secure=${c.secure} sameSite=${c.sameSite}`);
  console.log(`[${label}] cookies: ${cookies.join(', ') || 'none'}`);
  await p.screenshot({ path: `shot-${label}.png` });
  await b.close();
}
