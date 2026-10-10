async function run(ctx) {
  const message = String(ctx.settings.message || '').trim();
  if (!message) {
    await ctx.notify({ title: 'Nothing to post', body: 'Add the message to post under Settings.' });
    return;
  }
  // Slack and Teams read "text"; Discord reads "content".
  const r = await ctx.webhook.send('hook', { text: message, content: message });
  ctx.log(r.held ? 'held: shadow mode or snoozed' : `posted: ${r.sent ? 'yes' : 'no'} (status ${r.status})`);
  // Held (shadow mode, snoozed) is expected; anything else that didn't send is worth telling.
  if (!r.sent && !r.held) {
    const why = r.status ? `The channel answered ${r.status}.` : 'The channel could not be reached.';
    await ctx.notify({ title: 'The post did not go through', body: `${why} Check the webhook address under Settings.` });
  }
}
