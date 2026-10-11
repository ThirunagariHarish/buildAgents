// Learning Coach: spaced-repetition flashcards in the chat. Add cards in plain
// words ("learn: q = a", "add: hola - hello", a pasted list, "topic: ..."),
// say "quiz" and answer; each card is rescheduled with an SM-2-lite rule.
// A 09:00 nudge says how many cards are due and keeps the streak going.

const MAX_CARDS = 2000;
const LOG_DAYS = 60;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

async function run(ctx) {
  const today = ctx.local().date;
  const st = {
    today,
    cards: (await ctx.memory.get('cards')) || [],
    log: (await ctx.memory.get('log')) || [],
    newPerDay: Math.max(0, Math.min(200, Math.round(Number(ctx.settings.newPerDay)))) || 10,
  };
  if (ctx.trigger.type === 'schedule') return morning(ctx, st);
  st.quiz = await ctx.memory.get('quiz');
  return onMessage(ctx, st);
}

// ---------- dates and the schedule ----------

function addDays(d, n) {
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10);
}
function nice(d, today) {
  if (d <= today) return 'today';
  if (d === addDays(today, 1)) return 'tomorrow';
  const [, m, dd] = d.split('-').map(Number);
  return `${MON[m - 1]} ${dd}`;
}
function days(n) { return `${n} day${n === 1 ? '' : 's'}`; }

/** SM-2-lite: again → 1 day; good → 1 day, 3 days, then × ease (2.5 to start); hard and easy nudge the ease. */
function schedule(c, g, today) {
  let e = c.e || 250, r = c.r || 0, v;
  if (g === 'again') { e = Math.max(130, e - 20); v = 1; r = 0; c.l = (c.l || 0) + 1; }
  else if (g === 'hard') { e = Math.max(130, e - 15); v = r === 0 ? 1 : Math.max((c.v || 1) + 1, Math.round((c.v || 1) * 1.2)); r += 1; }
  else if (g === 'easy') { e = Math.min(350, e + 15); v = r === 0 ? 4 : r === 1 ? 6 : Math.round((c.v || 1) * (e / 100) * 1.3); r += 1; }
  else { v = r === 0 ? 1 : r === 1 ? 3 : Math.round((c.v || 1) * (e / 100)); r += 1; }
  c.v = Math.min(365, Math.max(1, v)); c.e = e; c.r = r; c.d = addDays(today, c.v);
  return c;
}

function todayLog(st) {
  let e = st.log.find((x) => x.d === st.today);
  if (!e) { e = { d: st.today, r: 0, c: 0, nw: 0 }; st.log.push(e); }
  st.log = st.log.filter((x) => x.d >= addDays(st.today, -LOG_DAYS));
  return e;
}

/** Cards to ask today: reviews that are due, then up to the day's allowance of new cards. */
function dueQueue(st, skip) {
  const sk = new Set(skip || []);
  const rev = st.cards.filter((c) => c.v > 0 && c.d <= st.today && !sk.has(c.i)).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.i - b.i));
  const used = (st.log.find((x) => x.d === st.today) || {}).nw || 0;
  const fresh = st.cards.filter((c) => !c.v && !sk.has(c.i)).slice(0, Math.max(0, st.newPerDay - used));
  return { list: rev.concat(fresh), rev: rev.length, fresh: fresh.length };
}

function streak(st) {
  const on = new Set(st.log.filter((x) => x.r > 0).map((x) => x.d));
  let d = on.has(st.today) ? st.today : addDays(st.today, -1), n = 0;
  while (on.has(d)) { n += 1; d = addDays(d, -1); }
  return n;
}

// ---------- the morning nudge ----------

async function morning(ctx, st) {
  if ((await ctx.memory.get('sent')) === st.today) return;
  const q = dueQueue(st);
  if (!q.list.length) return;   // nothing due: stay quiet
  const s = streak(st);
  const parts = [];
  if (q.rev) parts.push(`${q.rev} review${q.rev === 1 ? '' : 's'}`);
  if (q.fresh) parts.push(`${q.fresh} new`);
  const streakLine = s ? `🔥 Streak: ${days(s)}, a quick quiz keeps it going.` : (st.log.some((x) => x.r > 0) ? 'Your streak reset; one quiz today starts a new one.' : 'A few minutes a day is all it takes.');
  await ctx.notify({ title: `🧠 ${q.list.length} card${q.list.length === 1 ? '' : 's'} due today — say quiz`, body: `${parts.join(' + ')}. ${streakLine}` });
  await ctx.memory.set('sent', st.today);
}

// ---------- reading cards from plain words ----------

function pair(line, noColon) {
  const s = String(line || '').replace(/^\s*(?:[-*•]|\d{1,3}[.)])\s+/, '').trim();
  if (!s) return null;
  const seps = [/\s*=\s*/, /\s*(?:->|→|⇒)\s*/, /\s+[-–—]\s+/, /\t+/, /\s*[–—]\s*/, /\s*:\s+/];
  for (const re of noColon ? seps.slice(0, -1) : seps) {
    const m = s.match(re);
    if (!m) continue;
    const q = s.slice(0, m.index).trim(), a = s.slice(m.index + m[0].length).trim();
    if (q && a && q.length <= 300 && a.length <= 300) return { q, a };
  }
  return null;
}

async function addCards(ctx, st, pairs) {
  const have = new Set(st.cards.map((c) => loose(c.q)));
  const added = [], dup = [];
  let id = st.cards.reduce((m, c) => Math.max(m, c.i), 0);
  for (const p of pairs) {
    if (have.has(loose(p.q))) { dup.push(p.q); continue; }
    if (st.cards.length >= MAX_CARDS) break;
    id += 1;
    const c = { i: id, q: p.q, a: p.a, d: st.today, v: 0, e: 250, r: 0, l: 0 };
    st.cards.push(c); have.add(loose(p.q)); added.push(c);
  }
  if (added.length) await ctx.memory.set('cards', st.cards);
  return { added, dup, full: st.cards.length >= MAX_CARDS && added.length < pairs.length - dup.length };
}

function addedText(st, r) {
  const q = dueQueue(st);
  if (!r.added.length) return r.dup.length ? `You already have ${r.dup.length === 1 ? `a card for "${r.dup[0]}"` : `all ${r.dup.length} of those`}. Say "cards" to see them.` : 'No cards added.';
  const n = st.cards.length;
  let s = r.added.length === 1
    ? `Added card ${n}: ${r.added[0].q} → ${r.added[0].a}.`
    : `Added ${r.added.length} cards: ${r.added.slice(0, 5).map((c) => `${c.q} → ${c.a}`).join('; ')}${r.added.length > 5 ? '; …' : ''}.`;
  if (r.dup.length) s += ` Skipped ${r.dup.length} you already had.`;
  if (r.full) s += ` You've hit ${MAX_CARDS} cards; delete some to add more.`;
  return `${s} ${n} card${n === 1 ? '' : 's'} in total, ${q.list.length} due today. Say "quiz" to practise.`;
}

// ---------- grading ----------

function strict(s) { return String(s || '').toLowerCase().normalize('NFC').replace(/\([^)]*\)/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim().replace(/^(the|a|an|to) /, ''); }
function loose(s) { return strict(String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')); }
function lev(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 3) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
function alternatives(a) {
  const out = [a];
  for (const p of String(a).split(/\s*(?:\/|;|,|\bor\b)\s*/i)) if (p.trim()) out.push(p);
  return out;
}
/** exact | accent | typo | wrong */
function grade(answer, card) {
  const us = strict(answer), ul = loose(answer);
  if (!ul) return 'wrong';
  let best = 'wrong';
  for (const alt of alternatives(card.a)) {
    const as = strict(alt), al = loose(alt);
    if (!al) continue;
    if (us === as) return 'exact';
    if (ul === al) { best = 'accent'; continue; }
    if (al.length >= 4 && (` ${ul} `).includes(` ${al} `) && ul.split(' ').length <= al.split(' ').length + 3) { if (best === 'wrong') best = 'accent'; continue; }
    const tol = al.length <= 4 ? 0 : al.length <= 8 ? 1 : 2;
    if (best === 'wrong' && lev(ul, al) <= tol) best = 'typo';
  }
  return best;
}

// ---------- the quiz ----------

function ask(st, quiz, first) {
  const q = dueQueue(st, quiz.sk);
  const c = q.list.find((x) => x.i !== quiz.c) || q.list[0];
  if (!c) return null;
  quiz.c = c.i;
  const left = q.list.length;
  return `❓ ${c.q}${c.v ? '' : ' (new)'}\n${left} left today.${first ? ' Reply with the answer, or say show, skip or stop.' : ''}`;
}

function finish(st, quiz) {
  const pct = quiz.n ? Math.round((quiz.ok / quiz.n) * 100) : 0;
  const q = dueQueue(st);
  const next = st.cards.filter((c) => c.v > 0).map((c) => c.d).sort()[0];
  const s = streak(st);
  return `🎉 Done for today: ${quiz.n} reviewed, ${quiz.ok} correct (${pct}%).${s ? ` 🔥 Streak: ${days(s)}.` : ''}${q.list.length ? ` ${q.list.length} skipped card${q.list.length === 1 ? ' is' : 's are'} still due.` : next ? ` Next review ${nice(next, st.today)}.` : ''}`;
}

const GRADE_WORD = { exact: 'good', accent: 'good', typo: 'hard', wrong: 'again' };

async function answer(ctx, st, card, text, forced) {
  const quiz = st.quiz;
  const g = forced || grade(text, card);
  const was = { d: card.d, v: card.v, e: card.e, r: card.r, l: card.l };
  const isNew = !card.v;
  const ok = g !== 'wrong' && g !== 'shown';
  schedule(card, ok ? GRADE_WORD[g] : 'again', st.today);
  const lg = todayLog(st);
  lg.r += 1; if (ok) lg.c += 1; if (isNew) lg.nw += 1;
  quiz.n = (quiz.n || 0) + 1; if (ok) quiz.ok = (quiz.ok || 0) + 1;
  quiz.last = { i: card.i, p: was, ok, g: ok ? GRADE_WORD[g] : 'again' };
  let head;
  if (g === 'exact') head = `✅ Right: ${card.a}.`;
  else if (g === 'accent') head = `✅ Right: ${card.a} (note the exact spelling).`;
  else if (g === 'typo') head = `✅ Almost: ${card.a} (you wrote "${String(text).trim().slice(0, 60)}").`;
  else if (g === 'shown') head = `👀 ${card.q} → ${card.a}.`;
  else head = `❌ It's ${card.a} (you wrote "${String(text).trim().slice(0, 60)}").`;
  head += ` Next time: ${nice(card.d, st.today)}${card.v > 1 ? `, in ${days(card.v)}` : ''}.${ok ? ' Say easy or hard to change that.' : ''}`;
  const next = ask(st, quiz, false);
  await ctx.memory.set('cards', st.cards);
  await ctx.memory.set('log', st.log);
  if (!next) { await ctx.memory.set('quiz', null); return ctx.reply(`${head}\n\n${finish(st, quiz)}`); }
  await ctx.memory.set('quiz', quiz);
  return ctx.reply(`${head}\n\n${next}`);
}

async function regrade(ctx, st, g) {
  const quiz = st.quiz, last = quiz.last;
  const card = st.cards.find((c) => c.i === last.i);
  if (!card) return false;
  Object.assign(card, last.p);
  schedule(card, g, st.today);
  const ok = g !== 'again';
  const lg = todayLog(st);
  if (ok && !last.ok) { lg.c += 1; quiz.ok = (quiz.ok || 0) + 1; }
  if (!ok && last.ok) { lg.c = Math.max(0, lg.c - 1); quiz.ok = Math.max(0, (quiz.ok || 0) - 1); }
  quiz.last = { ...last, ok, g };
  await ctx.memory.set('cards', st.cards);
  await ctx.memory.set('log', st.log);
  await ctx.memory.set('quiz', quiz);
  const cur = st.cards.find((c) => c.i === quiz.c);
  await ctx.reply(`Marked "${card.q}" as ${g}: next time ${nice(card.d, st.today)}, in ${days(card.v)}.${cur ? `\n\nStill waiting on: ❓ ${cur.q}` : ''}`);
  return true;
}

// ---------- talking to it ----------

const HELP = 'I\'m your spaced-repetition coach. Say:\n'
  + '• "learn: capital of australia = canberra" or "add: hola - hello" to add a card\n'
  + '• paste a list, one "word - meaning" or "question = answer" per line\n'
  + '• "topic: 10 cards on spanish greetings" and I\'ll draft cards\n'
  + '• "quiz" to practise what\'s due; then answer, or say show, skip or stop\n'
  + '• "stats", "cards" (your list), "delete 3"\n'
  + 'Each morning I tell you how many cards are due.';

const RE = {
  help: /^(help|\?|what can you do|commands|menu|how does this work)\b/,
  stop: /^(stop|quit|end|exit|done|enough|finish)\b/,
  skip: /^(skip|pass|next|later)\b/,
  show: /^(show|reveal|show me|answer|i don'?t know|idk|dunno|no idea|give up|\?\?+)$/,
  quiz: /^(quiz|quiz me|review|start|study|practi[cs]e|test me|go|let'?s go)\b/,
  stats: /^(stats|statistics|progress|streak|score|how am i doing)\b/,
  cards: /^(cards|list|my cards|show cards|show my cards|deck|all cards)\b/,
  del: /^(?:delete|remove|del|drop)\s+(?:card\s+)?#?(\d+|last)\.?$/,
  grade: /^(easy|hard|again|good)$/,
};

async function onMessage(ctx, st) {
  const raw = String((ctx.input && ctx.input.text) || '').trim();
  const text = raw.toLowerCase();
  const quiz = st.quiz && st.cards.some((c) => c.i === st.quiz.c) ? st.quiz : null;
  st.quiz = quiz;

  if (quiz) {
    const card = st.cards.find((c) => c.i === quiz.c);
    if (strict(raw) && strict(raw) === strict(card.a)) return answer(ctx, st, card, raw);
    if (RE.stop.test(text)) {
      await ctx.memory.set('quiz', null);
      const left = dueQueue(st).list.length;
      return ctx.reply(`Stopped. This round: ${quiz.n || 0} reviewed, ${quiz.ok || 0} correct. ${left} still due today; say "quiz" to carry on.`);
    }
    if (RE.skip.test(text)) {
      quiz.sk = (quiz.sk || []).concat(card.i).slice(-200);
      const next = ask(st, quiz, false);
      if (!next) { await ctx.memory.set('quiz', null); return ctx.reply(`Skipped "${card.q}" (still due).\n\n${finish(st, quiz)}`); }
      await ctx.memory.set('quiz', quiz);
      return ctx.reply(`Skipped; it stays due.\n\n${next}`);
    }
    if (RE.show.test(text)) return answer(ctx, st, card, raw, 'shown');
    if (RE.grade.test(text) && quiz.last && (await regrade(ctx, st, text))) return;
    if (RE.help.test(text)) return ctx.reply(`${HELP}\n\nQuiz in progress: ❓ ${card.q}`);
    if (RE.quiz.test(text) && text.split(' ').length <= 2) return ctx.reply(`❓ ${card.q}\nReply with the answer, or say show, skip or stop.`);
    if (!(RE.stats.test(text) || RE.cards.test(text) || RE.del.test(text) || /^(learn|add|topic)\s*:/.test(text))) return answer(ctx, st, card, raw);
  }

  if (!text || RE.help.test(text)) return ctx.reply(`${HELP}\n\nYou have ${st.cards.length} card${st.cards.length === 1 ? '' : 's'}, ${dueQueue(st).list.length} due today.`);

  if (RE.quiz.test(text) && text.split(' ').length <= 3) {
    if (!st.cards.length) return ctx.reply('No cards yet. Add one: "learn: capital of australia = canberra", or "topic: 10 cards on spanish greetings".');
    const qz = { c: null, n: 0, ok: 0, sk: [] };
    const first = ask(st, qz, true);
    if (!first) {
      const next = st.cards.filter((c) => c.v > 0).map((c) => c.d).sort()[0];
      return ctx.reply(`Nothing due right now. 🎉 ${next ? `Next review ${nice(next, st.today)}.` : ''} You have ${st.cards.length} card${st.cards.length === 1 ? '' : 's'}; add more with "learn: question = answer".`);
    }
    await ctx.memory.set('quiz', qz);
    return ctx.reply(first);
  }

  if (RE.stop.test(text) || RE.skip.test(text) || RE.show.test(text)) return ctx.reply('No quiz running. Say "quiz" to start one.');

  if (RE.stats.test(text)) {
    const q = dueQueue(st);
    const learned = st.cards.filter((c) => (c.r || 0) >= 2).length;
    const wk = st.log.filter((x) => x.d > addDays(st.today, -7));
    const r = wk.reduce((s, x) => s + x.r, 0), c = wk.reduce((s, x) => s + x.c, 0);
    const s = streak(st);
    return ctx.reply(`📊 ${st.cards.length} cards · ${q.list.length} due today · ${learned} learned (recalled 2+ times in a row) · 🔥 streak ${days(s)} · accuracy last 7 days: ${r ? `${Math.round((c / r) * 100)}% (${c} of ${r})` : 'no reviews yet'}.`);
  }

  if (RE.cards.test(text)) {
    if (!st.cards.length) return ctx.reply('No cards yet. Add one: "learn: capital of australia = canberra".');
    const lines = st.cards.slice(0, 20).map((c, i) => `${i + 1}. ${c.q} = ${c.a} (${c.v ? `due ${nice(c.d, st.today)}` : 'new'})`);
    const more = st.cards.length > 20 ? `\n…and ${st.cards.length - 20} more.` : '';
    return ctx.reply(`Your cards (${st.cards.length}):\n${lines.join('\n')}${more}\nSay "delete 3" to remove one.`);
  }

  let m = text.match(RE.del);
  if (m) {
    const n = m[1] === 'last' ? st.cards.length : Number(m[1]);
    if (!st.cards.length) return ctx.reply('There are no cards to delete.');
    if (!(n >= 1 && n <= st.cards.length)) return ctx.reply(`There's no card ${m[1]}. You have ${st.cards.length}; say "cards" to see their numbers.`);
    const [gone] = st.cards.splice(n - 1, 1);
    await ctx.memory.set('cards', st.cards);
    if (quiz && quiz.c === gone.i) await ctx.memory.set('quiz', null);
    return ctx.reply(`Deleted card ${n}: ${gone.q} = ${gone.a}. ${st.cards.length} card${st.cards.length === 1 ? '' : 's'} left.`);
  }

  m = raw.match(/^(?:topic|make|generate|create)\s*:?\s*([\s\S]+)$/i);
  if (m && /^(topic\b|make|generate|create)/i.test(raw) && (/^topic/i.test(raw) || /\bcards?\b/i.test(raw))) return topic(ctx, st, m[1]);

  // Cards: "learn: q = a", "add: hola - hello", or a pasted list.
  m = raw.match(/^(?:learn|add|new card|card|remember)\s*:?\s*([\s\S]+)$/i);
  const body = m ? m[1] : raw;
  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/:\s*$/.test(l));   // drop headers like "Spanish words:"
  const pairs = lines.map((l) => pair(l, !m && lines.length === 1)).filter(Boolean);
  const okList = m ? pairs.length > 0 : lines.length > 1 ? pairs.length >= Math.ceil(lines.length / 2) : pairs.length === 1;
  if (okList) {
    const r = await addCards(ctx, st, pairs);
    const bad = lines.length - pairs.length;
    return ctx.reply(`${addedText(st, r)}${bad > 0 ? ` (${bad} line${bad === 1 ? '' : 's'} had no "=" or " - " and ${bad === 1 ? 'was' : 'were'} left out.)` : ''}`);
  }
  if (m) return ctx.reply(`I need the answer too: "learn: ${body.split('\n')[0].slice(0, 50)} = …" (or use " - " between the two sides).`);

  return ctx.reply(`I didn't understand "${raw.slice(0, 60)}". To add a card write "learn: question = answer" or "add: hola - hello"; say "quiz" to practise, "stats" for progress, or "help".`);
}

async function topic(ctx, st, ask0) {
  const s = ask0.trim();
  const nm = s.match(/\b(\d{1,2})\b/);
  const n = Math.max(3, Math.min(20, nm ? Number(nm[1]) : 10));
  const subj = (s.match(/\b(?:on|about|for|of)\s+([\s\S]+)$/i) || [null, s.replace(/\b\d{1,2}\s*(cards?|questions?|words?)?\b/i, '')])[1].trim().replace(/[.?!]+$/, '');
  if (!subj) return ctx.reply('Which topic? e.g. "topic: 10 cards on spanish greetings".');
  const out = await ctx.model.generate(`Write exactly ${n} flashcards to help someone memorise: ${subj}.\nOne card per line, in the form: question = answer\nKeep answers short (a word or a short phrase). No numbering, no blank lines, no other text.`, { maxWords: n * 18 });
  if (out == null) return ctx.reply(`I can't make cards right now (no language model is available). Add them yourself: "learn: hola = hello", or paste a list with one "word - meaning" per line.`);
  const pairs = String(out).split(/\r?\n/).map((l) => l.replace(/^\s*(?:q(?:uestion)?\s*[:.]\s*)/i, '')).map(pair).filter(Boolean).slice(0, n);
  if (!pairs.length) return ctx.reply(`I couldn't turn that into cards this time. Add them yourself: "learn: question = answer", or try "topic: ${n} cards on ${subj}" again.`);
  const r = await addCards(ctx, st, pairs);
  return ctx.reply(`Drafted from "${subj}" (check them; delete any that are off). ${addedText(st, r)}`);
}
