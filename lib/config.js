// Pocket Box settings, from the environment (/etc/pocketbox.env on the server).
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const DATA = path.resolve(process.env.PB_DATA_DIR || path.join(ROOT, 'data'));
fs.mkdirSync(DATA, { recursive: true });

const DOMAIN = process.env.PB_DOMAIN || 'agents.cashflowus.com';

module.exports = {
  ROOT,
  DATA,
  PORT: Number(process.env.PB_PORT || 3401),
  DOMAIN,
  BASE_URL: process.env.PB_PUBLIC_URL || `https://${DOMAIN}`,
  APP_NAME: 'Pocket Box',
  // The owner's daily cap on hand-offs from phones to the Studio (Claude Code on the Max plan).
  HANDOFF_DAILY_CAP: Number(process.env.PB_HANDOFF_DAILY_CAP || 40),
};
