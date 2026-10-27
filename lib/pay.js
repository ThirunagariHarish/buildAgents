// One-time purchase through Stripe Checkout, called over HTTPS (no SDK).
// The owner pastes a Stripe secret key and a webhook signing secret in Admin
// and sets the price. A paid checkout creates the account (or marks an
// existing one as paid) and emails a link to choose a password.

const crypto = require('crypto');
const path = require('path');
const store = require('./store');
const secrets = require('./secrets');
const { BASE_URL } = require('./config');

const PURCHASES = path.join(store.DATA, 'purchases.json');
const configured = () => !!secrets.get('stripeSecret');

async function stripe(method, pathname, form) {
  const r = await fetch(`https://api.stripe.com/v1/${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${secrets.get('stripeSecret')}`, ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: form ? new URLSearchParams(form) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`Stripe: ${(j.error && j.error.message) || r.status}`), { status: 502 });
  return j;
}

/** A Checkout page for the lifetime purchase; returns its URL. */
async function checkout({ email } = {}) {
  if (!configured()) throw Object.assign(new Error('Payments are not set up yet.'), { status: 503 });
  const s = store.settings();
  const form = {
    mode: 'payment',
    'line_items[0][price_data][currency]': s.currency,
    'line_items[0][price_data][unit_amount]': String(s.priceCents),
    'line_items[0][price_data][product_data][name]': s.productName,
    'line_items[0][quantity]': '1',
    success_url: `${BASE_URL}/#/welcome/{CHECKOUT_SESSION_ID}`,
    cancel_url: `${BASE_URL}/#/`,
    customer_creation: 'always',
    allow_promotion_codes: 'true',
    'metadata[app]': 'jot',
  };
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) form.customer_email = email;
  const session = await stripe('POST', 'checkout/sessions', form);
  return session.url;
}

/** Stripe's signature: t=<time>,v1=<HMAC-SHA256 of "time.body">, within 5 minutes. */
function verify(raw, header) {
  const secret = secrets.get('stripeWebhook');
  if (!secret || !header) return false;
  const parts = Object.fromEntries(String(header).split(',').map((kv) => kv.split('=')).filter((x) => x.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
  const sigs = String(header).split(',').filter((kv) => kv.trim().startsWith('v1=')).map((kv) => kv.trim().slice(3));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300 || !sigs.length) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

/** A verified Stripe event. `grant(email, name)` creates or marks the account and sends the link. */
async function handleEvent(event, grant) {
  if (!event || event.type !== 'checkout.session.completed') return { ignored: true };
  const s = event.data && event.data.object;
  if (!s || s.payment_status !== 'paid' || (s.metadata && s.metadata.app && s.metadata.app !== 'jot')) return { ignored: true };
  const all = store.readJson(PURCHASES, []);
  if (all.some((p) => p.session === s.id)) return { duplicate: true };
  const email = String((s.customer_details && s.customer_details.email) || s.customer_email || '').toLowerCase();
  const name = String((s.customer_details && s.customer_details.name) || '').split(' ')[0];
  all.push({ session: s.id, email, amount: s.amount_total, currency: s.currency, at: Date.now() });
  store.writeJson(PURCHASES, all);
  if (email) await grant(email, name);
  return { ok: true, email };
}

/** For the thank-you page: did this checkout go through, and to which address? */
async function sessionStatus(id) {
  if (!/^cs_(test|live)_[\w]{10,}$/.test(String(id || '')) || !configured()) return { paid: false };
  const s = await stripe('GET', `checkout/sessions/${id}`);
  const email = String((s.customer_details && s.customer_details.email) || '');
  return { paid: s.payment_status === 'paid', email: email.replace(/^([^@]{1,2})[^@]*@/, '$1***@') };
}
const purchases = () => store.readJson(PURCHASES, []);

module.exports = { configured, checkout, verify, handleEvent, sessionStatus, purchases };
