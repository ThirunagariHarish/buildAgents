// Scoring what the crowd and the press say.
//
// Best available first: FinBERT (ProsusAI/finbert, a Hugging Face model
// trained on financial text) through the local Python sidecar; otherwise a
// finance word list (in the spirit of Loughran–McDonald) plus market slang.
// StockTwits posts the author tagged Bullish/Bearish are counted as tagged.

const models = require('./models');

const POS = 'beat beats beating surge surges surged soar soars soared rally rallies rallied gain gains gained record strong stronger strength growth grow grows growing profit profitable upgrade upgraded outperform outperforms bullish bull boom booming breakout rebound recover recovery recovered optimism optimistic upside exceed exceeds exceeded robust accelerate accelerating expansion buy buying undervalued cheap moon mooning rocket calls ath higher highs rises rose rising jump jumps jumped win winning wins demand tailwind tailwinds resilient beat-and-raise raised raise raises dovish cut cuts easing stimulus approve approved approval'.split(' ');
const NEG = 'miss misses missed plunge plunges plunged crash crashes crashed collapse collapses collapsed tumble tumbles tumbled slump slumps slumped fall falls fell falling drop drops dropped decline declines declined weak weaker weakness loss losses losing downgrade downgraded underperform bearish bear bubble overvalued expensive selloff sell-off selling sell recession layoffs layoff fraud lawsuit probe investigation default defaults bankruptcy risk risks risky fear fears panic warning warns warned cuts-guidance downside slowdown slowing contraction puts dump dumping bagholder bagholders rug rugpull lower lows tariff tariffs inflation hawkish hike hikes tightening headwind headwinds concern concerns worry worries worried volatile volatility capitulation correction burst bursting deflate deflating'.split(' ');
const NEGATORS = new Set(['not', 'no', 'never', "isn't", "wasn't", "aren't", "don't", "doesn't", "won't", 'without', 'hardly']);
const P = new Set(POS), N = new Set(NEG);

/** -1..+1 for one text, by word list. */
function lexScore(text) {
  const words = String(text || '').toLowerCase().replace(/[$#@]/g, ' ').match(/[a-z][a-z'-]*/g) || [];
  let s = 0, hits = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    let v = P.has(w) ? 1 : N.has(w) ? -1 : 0;
    if (!v) continue;
    if (NEGATORS.has(words[i - 1]) || NEGATORS.has(words[i - 2])) v = -v;
    s += v; hits++;
  }
  if (/🚀|📈|🐂|💎/.test(text)) { s += 1; hits++; }
  if (/📉|🐻|🩸|💀/.test(text)) { s -= 1; hits++; }
  return hits ? Math.max(-1, Math.min(1, s / Math.sqrt(hits * 2))) : 0;
}

/**
 * Score a set of posts. Returns per-post scores and the totals:
 * { method, n, bull, bear, neutral, net (-1..1), posts: [{...post, s}] }.
 */
async function scorePosts(posts) {
  const texts = posts.map((p) => String(p.text || '').slice(0, 512));
  let scores = null, method = 'finance word list';
  if (texts.length && await models.available()) {
    try {
      const r = await models.call('sentiment', { texts });
      if (Array.isArray(r.scores) && r.scores.length === texts.length) { scores = r.scores; method = 'FinBERT (Hugging Face, ProsusAI/finbert)'; }
    } catch {}
  }
  if (!scores) scores = texts.map(lexScore);
  let bull = 0, bear = 0, neutral = 0, tagged = 0;
  const scored = posts.map((p, i) => {
    let s = scores[i];
    if (p.label === 'Bullish') { s = 1; tagged++; } else if (p.label === 'Bearish') { s = -1; tagged++; }
    if (s > 0.15) bull++; else if (s < -0.15) bear++; else neutral++;
    return { ...p, s: Math.round(s * 100) / 100 };
  });
  const net = bull + bear ? (bull - bear) / (bull + bear) : 0;
  return { method, n: posts.length, bull, bear, neutral, tagged, net, posts: scored };
}

module.exports = { lexScore, scorePosts };
