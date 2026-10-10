// Wakes agents on their schedule. Phones do not run anything constantly, so
// at each scheduled minute (in each paired phone's time zone) the Studio sends
// a push; tapping it, or the next time the Runtime opens, runs the agent.

const { listAgents } = require('./store');
const devices = require('./devices');
const packages = require('./packages');
const push = require('./push');

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const sent = new Set();

function localParts(tz, d = new Date()) {
  try {
    const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }).formatToParts(d);
    const get = (t) => f.find((p) => p.type === t)?.value;
    return { hm: `${get('hour')}:${get('minute')}`, day: String(get('weekday')).slice(0, 3).toLowerCase() };
  } catch { return null; }
}

function tick() {
  const now = new Date();
  const minuteKey = now.toISOString().slice(0, 16);
  for (const a of listAgents()) {
    if (!a.release) continue;
    const rec = packages.load(a.id);
    if (!rec || rec.channel === 'off') continue;
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

function start() {
  const delay = 60000 - (Date.now() % 60000) + 500;
  setTimeout(() => { tick(); setInterval(tick, 60000); }, delay);
}

module.exports = { start, tick, localParts };
