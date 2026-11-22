'use strict';

const crypto = require('crypto');
const db = require('../database');

/**
 * Extracts and authenticates session cookie on every incoming request.
 */
function authenticate(req, res, next) {
  const token = req.cookies && req.cookies.cmdctr_session;
  req.user = null;

  if (!token || typeof token !== 'string') {
    return next();
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const query = `
    SELECT 
      u.id, u.username, u.email, u.full_name, u.designation, u.location,
      u.role, u.status, u.tech_horizon_access, u.monthly_report_access,
      u.must_change_password, s.expires_at
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND u.status = 'Active'
  `;

  try {
    const row = db.prepare(query).get(tokenHash);
    if (row) {
      req.user = row;
    }
  } catch (err) {
    console.error('Session lookup error:', err);
  }

  next();
}

/**
 * Rejects unauthenticated requests with redirect or 401.
 */
function requireAuth(req, res, next) {
  if (!req.user) {
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json')) || req.path.startsWith('/api/')) {
      return res.status(401).json({ ok: false, error: 'Authentication required. Please log in.' });
    }
    const redirectUrl = req.originalUrl && req.originalUrl !== '/' ? `?redirect=${encodeURIComponent(req.originalUrl)}` : '';
    return res.redirect(`/login${redirectUrl}`);
  }

  // Enforce first-login mandatory password change
  if (req.user.must_change_password === 1) {
    const fullPath = (req.originalUrl ? req.originalUrl.split('?')[0] : (req.baseUrl || '') + (req.path || '')).toLowerCase();
    const allowedPrefixes = ['/profile', '/api/profile', '/api/auth/change-password', '/api/auth/logout', '/css/', '/assets/'];
    const isAllowed = allowedPrefixes.some(p => fullPath === p || fullPath.startsWith(p));
    if (!isAllowed) {
      if (req.xhr || fullPath.startsWith('/api/')) {
        return res.status(403).json({ 
          ok: false, 
          mustChangePassword: true, 
          error: 'Mandatory password change required before accessing portal applications.' 
        });
      }
      return res.redirect('/profile?must_change=1');
    }
  }

  next();
}

/**
 * Enforces Administrator role check.
 */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'Admin') {
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.status(403).json({ ok: false, error: 'Administrator privileges required.' });
    }
    return res.status(403).send(`
      <!DOCTYPE html>
      <html>
      <head><title>403 Forbidden</title><style>body{font-family:sans-serif;padding:40px;text-align:center;color:#14301F}h1{color:#B3261E}</style></head>
      <body>
        <h1>403 — Access Denied</h1>
        <p>You do not have administrative privileges to access this area.</p>
        <p><a href="/">Return to Command Centre Launchpad</a></p>
      </body>
      </html>
    `);
  }
  next();
}

/**
 * Enforces application-level access permission (Tech Horizon or Monthly Report).
 */
function requireAppAccess(appKey) {
  return function(req, res, next) {
    if (!req.user) {
      return res.redirect('/login');
    }

    if (appKey === 'tech_horizon' && req.user.tech_horizon_access !== 1) {
      return res.status(403).send(`
        <!DOCTYPE html>
        <html>
        <head><title>403 Access Denied</title><style>body{font-family:sans-serif;padding:40px;text-align:center;color:#14301F}h1{color:#B3261E}</style></head>
        <body>
          <h1>403 — Access Restricted</h1>
          <p>Your account does not currently have permission to access <b>AWS Tech Horizon</b>.</p>
          <p>Please contact your presales administrator to request access.</p>
          <p><a href="/">Return to Command Centre Launchpad</a></p>
        </body>
        </html>
      `);
    }

    if (appKey === 'monthly_report' && req.user.monthly_report_access !== 1) {
      return res.status(403).send(`
        <!DOCTYPE html>
        <html>
        <head><title>403 Access Denied</title><style>body{font-family:sans-serif;padding:40px;text-align:center;color:#14301F}h1{color:#B3261E}</style></head>
        <body>
          <h1>403 — Access Restricted</h1>
          <p>Your account does not currently have permission to access the <b>Monthly Report Generator</b>.</p>
          <p>Please contact your presales administrator to request access.</p>
          <p><a href="/">Return to Command Centre Launchpad</a></p>
        </body>
        </html>
      `);
    }

    next();
  };
}

module.exports = {
  authenticate,
  requireAuth,
  requireAdmin,
  requireAppAccess
};
