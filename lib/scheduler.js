// Wakes agents on their schedule. Phones do not run anything constantly, so
// at each scheduled minute (in each paired phone's time zone) the Studio sends
// a push; tapping it, or the next time the Runtime opens, runs the agent.

const { listAgents } = require('./store');
const devices = require('./devices');
const packages = require('./packages');
const push = require('./push');
const prefs = require('./prefs');
const settings = require('./settings');
const cloudrun = require('./cloudrun');
let onCloudRun = () => {};

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const sent = new Set();

function localParts(tz, d = new Date()) {
  try {
    const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }).formatToParts(d);
    const get = (t) => f.find((p) => p.type === t)?.value;
    return { hm: `${get('hour')}:${get('minute')}`, day: String(get('weekday')).slice(0, 3).toLowerCase() };
  } catch { return null; }
}

function ownerTz(agent) {
  return prefs.get(agent.ownerId).tz || (devices.list(agent.ownerId)[0] || {}).tz || 'UTC';
}

function cloudDue(a, rec, now, minuteKey) {
  const tz = ownerTz(a);
  const lp = localParts(tz, now);
  for (const t of rec.package.manifest.triggers || []) {
    if (t.type === 'schedule' && lp && t.at === lp.hm && (!t.days || !t.days.length || t.days.includes(lp.day))) {
      const key = `cloud:${a.id}:${minuteKey}`;
      if (!sent.has(key)) { sent.add(key); return { type: 'schedule', at: t.at }; }
    }
    if (t.type === 'interval' && now - (a.lastCloudRunAt || 0) >= Number(t.minutes) * 60000) return { type: 'interval', minutes: t.minutes };
  }
  return null;
}

function tick() {
  const now = new Date();
  const minuteKey = now.toISOString().slice(0, 16);
  for (const a of listAgents()) {
    if (!a.release) continue;
    const rec = packages.load(a.id);
    if (!rec || rec.channel === 'off') continue;
    // Cloud agents: the Studio runs them itself.
    if (a.runsOn === 'cloud') {
      if (settings.missing(a.id, rec.package.manifest).length || cloudrun.isRunning(a.id)) continue;
      const trig = cloudDue(a, rec, now, minuteKey);
      if (!trig) continue;
      const fresh = require('./store').loadAgent(a.id);
      fresh.lastCloudRunAt = Date.now();
      require('./store').saveAgent(fresh);
      cloudrun.run(fresh, trig, { onRun: (r) => onCloudRun(a.id, r) }).catch((e) => console.error(`cloud run ${a.id}: ${e.message}`));
      continue;
    }
    // Phone agents: wake the phone at each scheduled time.
    const triggers = (rec.package.manifest.triggers || []).filter((t) => t.type === 'schedule');
    if (!triggers.length) continue;
    const tzs = [...new Set(devices.list(a.ownerId).map((d) => d.tz || 'UTC'))];
    for (const tz of tzs) {
      const lp = localParts(tz, now);
      if (!lp) continue;
      for (const t of triggers) {
        if (t.at !== lp.hm) continue;
        if (t.days && t.days.length && !t.days.includes(lp.day)) continue;
        const key = `${a.id}:${tz}:${minuteKey}`;
        if (sent.has(key)) continue;
        sent.add(key);
        push.broadcast({
          title: `${a.icon || '⚡'} ${a.title}`,
          body: rec.channel === 'shadow' ? 'Time to run (shadow mode). Tap to run it now.' : 'Time to run. Tap to run it now.',
          url: `/runtime#run=${a.id}`, tag: `run:${a.id}`, telegram: false,
        }, [a.ownerId]).catch(() => {});
      }
    }
  }
  if (sent.size > 5000) sent.clear();
}

function start(opts = {}) {
  if (opts.onCloudRun) onCloudRun = opts.onCloudRun;
  const delay = 60000 - (Date.now() % 60000) + 500;
  setTimeout(() => { tick(); setInterval(tick, 60000); }, delay);
}

module.exports = { start, tick, localParts };
