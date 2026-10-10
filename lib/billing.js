// Payments through Stripe, with no SDK: Checkout for a plan, the customer
// portal to change or cancel, and a signed webhook that applies the result.
//
// Switched on by PB_STRIPE_SECRET_KEY, PB_STRIPE_WEBHOOK_SECRET and one price
// per plan: PB_STRIPE_PRICE_PLUS, PB_STRIPE_PRICE_FAMILY, PB_STRIPE_PRICE_BUSINESS.

const crypto = require('crypto');
const auth = require('./auth');
const { BASE_URL } = require('./config');

const PLAN_IDS = ['plus', 'family', 'business'];
const priceFor = (plan) => process.env[`PB_STRIPE_PRICE_${plan.toUpperCase()}`] || '';
const planForPrice = (price) => PLAN_IDS.find((p) => priceFor(p) && priceFor(p) === price) || null;
const configured = () => !!(process.env.PB_STRIPE_SECRET_KEY && process.env.PB_STRIPE_WEBHOOK_SECRET && PLAN_IDS.some(priceFor));

function form(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v && typeof v === 'object') out.push(form(v, key));
    else if (v !== undefined && v !== null) out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return out.filter(Boolean).join('&');
}

async function stripe(pathname, body) {
  const r = await fetch(`https://api.stripe.com/v1/${pathname}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${process.env.PB_STRIPE_SECRET_KEY}`, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: body ? form(body) : undefined, signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error?.message || `Stripe said ${r.status}.`), { status: 502 });
  return j;
}

async function checkout(user, plan) {
  if (!configured()) throw Object.assign(new Error('Payments aren\'t set up yet.'), { status: 409 });
  if (!PLAN_IDS.includes(plan) || !priceFor(plan)) throw Object.assign(new Error('No such plan.'), { status: 400 });
  const s = await stripe('checkout/sessions', {
    mode: 'subscription',
    line_items: { 0: { price: priceFor(plan), quantity: 1 } },
    client_reference_id: user.id,
    ...(user.stripeCustomer ? { customer: user.stripeCustomer } : { customer_email: user.email }),
    success_url: `${BASE_URL}/?paid=1#/me`, cancel_url: `${BASE_URL}/#/me`,
    allow_promotion_codes: 'true',
  });
  return s.url;
}

async function portal(user) {
  if (!configured() || !user.stripeCustomer) throw Object.assign(new Error('There is no subscription to manage yet.'), { status: 409 });
  const s = await stripe('billing_portal/sessions', { customer: user.stripeCustomer, return_url: `${BASE_URL}/#/me` });
  return s.url;
}

/** Check Stripe's signature header against the raw body. */
function verify(raw, header) {
  const secret = process.env.PB_STRIPE_WEBHOOK_SECRET || '';
  const parts = Object.fromEntries(String(header || '').split(',').map((x) => x.split('=')).filter((x) => x.length === 2));
  const t = Number(parts.t);
  if (!secret || !t || !parts.v1 || Math.abs(Date.now() / 1000 - t) > 600) return false;
  const want = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(want), Buffer.from(parts.v1)); } catch { return false; }
}

/** The plan a subscription object grants right now. */
function planOfSubscription(sub) {
  const price = sub && sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price && sub.items.data[0].price.id;
  const active = sub && ['active', 'trialing', 'past_due'].includes(sub.status);
  return active ? planForPrice(price) || 'free' : 'free';
}

/**
 * Apply a verified Stripe event. Stripe does not promise the order events
 * arrive in, so the event is only a nudge: the subscription's current state is
 * read back from Stripe and that is what is applied. Returns what changed.
 */
async function apply(event) {
  const o = event.data && event.data.object || {};
  if (event.type === 'checkout.session.completed' && o.mode === 'subscription') {
    let u = auth.setPlan(o.client_reference_id, { stripeCustomer: o.customer, stripeSubscription: o.subscription });
    if (!u) return 'no such user';
    // The subscription events may have come first, before this person was linked.
    if (o.subscription) {
      const sub = await stripe(`subscriptions/${encodeURIComponent(o.subscription)}`);
      u = auth.setPlan(u.id, { plan: planOfSubscription(sub), stripeSubscription: sub.id });
    }
    return `linked ${u.email} to ${o.customer}, on ${u.plan || 'free'}`;
  }
  if (/^customer\.subscription\.(created|updated|deleted)$/.test(event.type)) {
    const user = auth.listUsers().find((x) => x.stripeCustomer && x.stripeCustomer === o.customer);
    if (!user) return 'no such customer yet (checkout will link it)';
    // A late "updated" must not undo a newer change, so ask for the latest.
    let sub = o;
    try { sub = await stripe(`subscriptions/${encodeURIComponent(o.id)}`); } catch { /* fall back to the event's copy */ }
    // Another, newer subscription for this person is not cancelled by this one ending.
    if (user.stripeSubscription && sub.id !== user.stripeSubscription && planOfSubscription(sub) === 'free') return `ignored an old subscription of ${user.email}`;
    const plan = planOfSubscription(sub);
    const u = auth.setPlan(user.id, { plan, stripeSubscription: plan === 'free' ? null : sub.id });
    return `${u.email} is now on ${plan}`;
  }
  return 'ignored';
}

module.exports = { configured, checkout, portal, verify, apply, PLAN_IDS, priceFor };
