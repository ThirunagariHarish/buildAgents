# Pocket Box agent contract

An agent is three things in this repository. Pocket Box signs them into a package and installs it on the owner's phone.

## agent.json

```json
{
  "id": "morning-brief",
  "name": "Morning brief",
  "icon": "☀️",
  "description": "Every weekday at 7, tells you what your day looks like and what to prepare.",
  "version": "1.0.0",
  "permissions": ["notify", "memory", "http"],
  "http": { "allow": ["calendar.google.com"] },
  "triggers": [
    { "type": "schedule", "at": "07:00", "days": ["mon", "tue", "wed", "thu", "fri"] },
    { "type": "manual", "label": "Brief me now" }
  ],
  "settings": [
    { "key": "icsUrl", "label": "Your calendar's secret iCal address", "type": "secret" }
  ],
  "budget": { "steps": 20, "handoffsPerRun": 0 }
}
```

- `permissions`: only what the code uses. `notify`, `memory`, `location`, `http` (with `http.allow` host names), `model`, `handoff`.
- `triggers`: `schedule` (`at` "HH:MM" in the phone's time zone, optional `days`), `interval` (`minutes`, 15 to 1440), `manual` (a button, optional `label`), `open` (each time the Runtime opens).
- `settings`: values the owner types once in the Studio (`text`, `url`, `number`, `secret`, `time`). The code reads them as `ctx.settings.<key>`. Never hard-code personal data.
- `budget.steps`: the most ctx calls one run may make (default 30). `budget.handoffsPerRun` (default 1).

## agent.js

Define one top-level function. No imports, no globals, no network except through `ctx`.

```js
async function run(ctx) {
  const today = ctx.now().slice(0, 10);
  if ((await ctx.memory.get('lastBrief')) === today) return;      // once a day
  const r = await ctx.http.get(ctx.settings.icsUrl);
  if (r.status !== 200) { await ctx.notify({ title: 'Morning brief', body: 'I could not read your calendar this morning.' }); return; }
  const events = parseIcs(r.text, today);
  await ctx.notify({ title: `${events.length} things today`, body: events.map((e) => `${e.time} ${e.title}`).join('\n') || 'Nothing on the calendar.' });
  await ctx.memory.set('lastBrief', today);
}
function parseIcs(text, day) { /* plain JavaScript helpers are fine */ return []; }
```

`ctx` gives you:

| Call | Needs | Returns |
| --- | --- | --- |
| `ctx.trigger` | | `{ type, ... }` that started this run |
| `ctx.settings` | | the owner's values for `settings` |
| `ctx.now()` | | the current time, ISO string |
| `ctx.log(...)` | | writes to the run history |
| `await ctx.memory.get(key)` / `set(key, value)` | `memory` | JSON values, kept on the phone |
| `await ctx.notify({ title, body })` | `notify` | shows a notification (in shadow mode it is only recorded) |
| `await ctx.http.get(url)` | `http` | `{ status, text }`, https only, hosts in `http.allow` |
| `await ctx.location.current()` | `location` | `{ lat, lon }` or `null` |
| `await ctx.model.generate(prompt, { maxWords })` | `model` | text, or `null` when no model is available: always handle `null` |
| `await ctx.handoff(prompt)` | `handoff` | text from the owner's Studio, or `null`; use only for hard reasoning |

Rules: prefer plain code and rules over models. Handle every failure (no network, empty data, `null` model) with a clear message or by doing nothing. Never notify the same thing twice: use memory. Keep runs short.

## evals/*.json

At least three scenarios: a normal run, an edge case, and a failure the agent must handle.

```json
{
  "name": "Two meetings on a weekday",
  "trigger": { "type": "schedule" },
  "now": "2026-10-12T07:00:00.000Z",
  "settings": { "icsUrl": "https://calendar.google.com/calendar/ical/x/basic.ics" },
  "memory": {},
  "http": { "https://calendar.google.com/calendar/ical/x/basic.ics": { "status": 200, "text": "BEGIN:VCALENDAR..." } },
  "model": ["canned model answer"],
  "handoff": [],
  "location": { "lat": 17.38, "lon": 78.48 },
  "expect": {
    "notify": { "count": 1, "titleIncludes": ["2 things"], "bodyIncludes": ["Standup"] },
    "memory": { "lastBrief": "2026-10-12" },
    "maxSteps": 6
  }
}
```

`expect` may check: `error` (false, true or a substring), `notify` (`count`, `min`, `max`, `titleIncludes`, `bodyIncludes`, `bodyExcludes`), `memory` (exact values or `{ "exists": true }`), `maxSteps`, `http.max`, `handoff.max`, `allowUnmocked`. A web read with no fixture fails the scenario.

Check your work with:

```
node agentkit/evals.js
```
