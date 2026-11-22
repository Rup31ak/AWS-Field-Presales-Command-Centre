'use strict';

const path = require('path');
const fs = require('fs');

// Simple zero-dependency .env loader for lightweight environments
function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx !== -1) {
        const key = line.slice(0, eqIdx).trim();
        let val = line.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
    }
  }
}

loadEnv();

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '127.0.0.1',
  nodeEnv: process.env.NODE_ENV || 'production',
  portalUrl: (process.env.PORTAL_URL || 'https://13.235.2.205').replace(/\/+$/, ''),
  dbPath: process.env.DB_PATH || path.resolve(process.cwd(), 'data', 'command_centre.db'),
  sessionSecret: process.env.SESSION_SECRET || 'dev_insecure_secret_replace_in_production',
  sessionMaxAgeHours: parseInt(process.env.SESSION_MAX_AGE_HOURS || '24', 10),
  cookieSecure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
  initialAdmin: {
    username: process.env.INITIAL_ADMIN_USERNAME || 'Rupak',
    email: process.env.INITIAL_ADMIN_EMAIL || 'rupak@redington.com',
    fullName: process.env.INITIAL_ADMIN_NAME || 'Rupak',
    password: process.env.INITIAL_ADMIN_PASSWORD || 'Admin@Presales2026!'
  }
};

module.exports = config;
