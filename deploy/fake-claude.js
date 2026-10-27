#!/usr/bin/env node
// A stand-in for `claude -p` in tests, answering in the CLI's stream-json format.
let input = '';
process.stdin.on('data', (d) => (input += d)).on('end', () => {
  const sys = process.argv[process.argv.indexOf('--append-system-prompt') + 1] || '';
  let text = 'OK';
  if (/You file short personal notes/.test(sys)) text = JSON.stringify({ tags: ['Ideas', '#product'] });
  else if (/You answer questions for one person/.test(sys)) {
    const k = (input.match(/\[(\d+)\][^\n]*annual plan/) || [])[1] || '1';
    text = `You decided on an annual plan with two months free [${k}]. Also see [99].`;
  }
  process.stdout.write(`${JSON.stringify({ type: 'result', result: text, total_cost_usd: 0, is_error: false })}\n`);
});
