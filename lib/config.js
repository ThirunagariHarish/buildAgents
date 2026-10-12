// Run Scenario settings, from the environment (/etc/scenario.env on the server).
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const DATA = path.resolve(process.env.SC_DATA_DIR || path.join(ROOT, 'data'));
fs.mkdirSync(DATA, { recursive: true });

const DOMAIN = process.env.SC_DOMAIN || 'scenario.cashflowus.com';

module.exports = {
  ROOT,
  DATA,
  PORT: Number(process.env.SC_PORT || 3402),
  DOMAIN,
  BASE_URL: process.env.SC_PUBLIC_URL || `https://${DOMAIN}`,
  APP_NAME: 'Run Scenario',
  // Anyone can create an account by confirming their email (setting a password from the link).
  OPEN_SIGNUP: process.env.SC_OPEN_SIGNUP !== '0',
  // When the desk re-runs every scenario (UTC hour), after the US close.
  DAILY_HOUR_UTC: Number(process.env.SC_DAILY_HOUR_UTC || 22),
  // Models for the Claude analysts. The judge gets the strongest.
  MODEL_FAST: process.env.SC_MODEL_FAST || 'sonnet',
  MODEL_JUDGE: process.env.SC_MODEL_JUDGE || 'opus',
  // The Python sidecar with Hugging Face models (Chronos-Bolt, FinBERT), when installed.
  PYTHON: process.env.SC_PYTHON || path.join(ROOT, 'venv', 'bin', 'python'),
};
