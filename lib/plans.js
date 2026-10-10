// Plans, limits and what each person's AI use costs.
//
// The primary administrator (the owner of this Pocket Box) is unlimited and
// builds on their own Claude login. Everyone else is on a plan; their room,
// crew and hand-offs run on the metered Claude API (PB_ANTHROPIC_API_KEY) and
// every call's cost is recorded here, so limits keep spend below price.

const fs = require('fs');
const path = require('path');
const { DATA } = require('./config');

const PLANS = {
  free: { name: 'Free', priceUsd: 0, builds: 1, agents: 5, spendUsd: 2, handoffsPerDay: 5, members: 0 },
  plus: { name: 'Plus', priceUsd: 5, builds: 2, agents: 15, spendUsd: 4, handoffsPerDay: 20, members: 0 },
  family: { name: 'Family', priceUsd: 10, builds: 3, agents: 30, spendUsd: 7, handoffsPerDay: 40, members: 5 },
  business: { name: 'Business', priceUsd: 25, builds: 5, agents: 60, spendUsd: 15, handoffsPerDay: 100, members: 3 },
};
const OWNER = { name: 'Owner', priceUsd: 0, builds: Infinity, agents: Infinity, spendUsd: Infinity, handoffsPerDay: Number(process.env.PB_HANDOFF_DAILY_CAP || 40), members: 20 };

const FILE = path.join(DATA, 'usage.json');
const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } };
const write = (v) => fs.writeFileSync(FILE, JSON.stringify(v, null, 1), { mode: 0o600 });
const month = () => new Date().toISOString().slice(0, 7);

function isOwner(user) { return !!(user && user.primary); }
function planOf(user) {
  if (isOwner(user)) return { id: 'owner', ...OWNER };
  const id = PLANS[user && user.plan] ? user.plan : 'free';
  return { id, ...PLANS[id] };
}

function usage(userId) {
  const u = read()[userId] || {};
  return u.month === month() ? { builds: u.builds || 0, spendUsd: u.spendUsd || 0, month: u.month } : { builds: 0, spendUsd: 0, month: month() };
}
function bump(userId, patch) {
  const all = read();
  const cur = usage(userId);
  all[userId] = { month: cur.month, builds: cur.builds + (patch.builds || 0), spendUsd: Math.round((cur.spendUsd + (patch.spendUsd || 0)) * 10000) / 10000 };
  write(all);
  return all[userId];
}
const recordBuild = (userId) => bump(userId, { builds: 1 });
const recordCost = (userId, usd) => { if (Number(usd) > 0) bump(userId, { spendUsd: Number(usd) }); };

/** May this person start one more custom build this month? { ok, reason }. */
function canBuild(user) {
  const p = planOf(user);
  if (p.id === 'owner') return { ok: true };
  if (!process.env.PB_ANTHROPIC_API_KEY) return { ok: false, reason: 'Custom agents aren\'t open for new accounts yet. Ready-made agents work now: tap one under "Ready in one tap".' };
  const u = usage(user.id);
  if (u.builds >= p.builds) return { ok: false, reason: `Your ${p.name} plan includes ${p.builds} custom agent${p.builds === 1 ? '' : 's'} a month, and you've used ${u.builds === 1 ? 'it' : 'them'}. Ready-made agents are still free to add; upgrade under You → Plan for more custom ones.`, upgrade: true };
  if (u.spendUsd >= p.spendUsd) return { ok: false, reason: `You've reached this month's AI limit on the ${p.name} plan. It resets on the 1st; upgrade under You → Plan for more.`, upgrade: true };
  return { ok: true };
}
/** May this person's agents keep using AI this month (changes, answers, hand-offs)? */
function canSpend(user) {
  const p = planOf(user);
  if (p.id === 'owner') return { ok: true };
  if (!process.env.PB_ANTHROPIC_API_KEY) return { ok: false, reason: 'AI for new accounts isn\'t switched on yet.' };
  return usage(user.id).spendUsd < p.spendUsd ? { ok: true } : { ok: false, reason: `This month's AI limit on the ${p.name} plan is used up.`, upgrade: true };
}
function canAddAgent(user, count) {
  const p = planOf(user);
  return count < p.agents ? { ok: true } : { ok: false, reason: `Your ${p.name} plan holds ${p.agents} agents. Remove one, or upgrade under You → Plan.`, upgrade: true };
}

module.exports = { PLANS, planOf, isOwner, usage, recordBuild, recordCost, canBuild, canSpend, canAddAgent };
