// Reinvent settings, from the environment (/etc/reinvent.env on the server).
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const DATA = path.resolve(process.env.RV_DATA_DIR || path.join(ROOT, 'data'));
fs.mkdirSync(DATA, { recursive: true });

const DOMAIN = process.env.RV_DOMAIN || 'reinvent.cashflowus.com';

module.exports = {
  ROOT,
  DATA,
  PORT: Number(process.env.RV_PORT || 3403),
  DOMAIN,
  BASE_URL: process.env.RV_PUBLIC_URL || `https://${DOMAIN}`,
  APP_NAME: 'Reinvent',
  // Anyone can create an account by confirming their email (setting a password from the link).
  OPEN_SIGNUP: process.env.RV_OPEN_SIGNUP !== '0',
  // Tests and local runs can turn the research schedule off.
  SCHEDULE: process.env.RV_SCHEDULE !== '0',
};
