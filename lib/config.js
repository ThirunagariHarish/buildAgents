// Jot settings, from the environment (/etc/jot.env on the server).
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.resolve(process.env.JT_DATA_DIR || path.join(ROOT, 'data'));
const DOMAIN = process.env.JT_DOMAIN || 'jot.cashflowus.com';
module.exports = {
  ROOT, DATA,
  PORT: Number(process.env.JT_PORT || 3404),
  DOMAIN,
  BASE_URL: process.env.JT_PUBLIC_URL || `https://${DOMAIN}`,
  APP_NAME: 'Jot',
  // Who can create an account: 'open' (anyone confirms their email), 'invite'
  // (administrators invite people) or 'paid' (after a Stripe purchase). The
  // owner changes this in Admin; this is only the starting value.
  ACCESS: process.env.JT_ACCESS || 'open',
  OPEN_SIGNUP: process.env.JT_OPEN_SIGNUP !== '0',
  SCHEDULE: process.env.JT_SCHEDULE !== '0',
};
