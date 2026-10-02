// Gives a new idea a short title, the way Claude names a new chat.

const { askClaude } = require('./claude');

async function generateTitle(text) {
  const res = await askClaude({
    model: 'haiku',
    system: 'You name ideas. Reply with the title only: 2 to 6 words, Title Case, no quotes, no trailing punctuation.',
    prompt: `Write a short title for this idea:\n\n${text.slice(0, 4000)}`,
  });
  const title = res.text.split('\n')[0].replace(/^["'#*\s]+|["'*.\s]+$/g, '').trim();
  if (!title || title.length > 80) throw new Error('unusable title');
  return title;
}

module.exports = { generateTitle };
