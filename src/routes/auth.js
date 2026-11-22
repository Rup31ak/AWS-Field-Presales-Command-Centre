'use strict';

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const db = require('../database');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Helper to record audit log events
function recordAudit(userId, action, details, req) {
  try {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const stmt = db.prepare('INSERT INTO audit_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)');
    stmt.run(userId, action, details, String(ip));
  } catch (err) {
    console.error('Audit log failure:', err);
  }
}

/**
 * POST /api/auth/login
 */
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ ok: false, error: 'Username and password are required.' });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(username.trim(), username.trim());
    
    if (!user) {
      recordAudit(null, 'LOGIN_FAILED', `Invalid user attempt: ${username.slice(0, 50)}`, req);
      return res.status(401).json({ ok: false, error: 'Invalid username or password.' });
    }

    if (user.status !== 'Active') {
      recordAudit(user.id, 'LOGIN_BLOCKED', 'Account inactive or suspended', req);
      return res.status(403).json({ ok: false, error: 'Your account is currently inactive. Contact your administrator.' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      recordAudit(user.id, 'LOGIN_FAILED', 'Incorrect password entered', req);
      return res.status(401).json({ ok: false, error: 'Invalid username or password.' });
    }

    // Generate cryptographically secure random session token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const expiresAt = new Date(Date.now() + config.sessionMaxAgeHours * 3600 * 1000).toISOString();
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const userAgent = req.headers['user-agent'] || '';

    // Insert session into SQLite
    const insertSession = db.prepare(`
      INSERT INTO sessions (token_hash, user_id, ip_address, user_agent, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertSession.run(tokenHash, user.id, String(ip), String(userAgent), expiresAt);

    // Set HTTP-only secure cookie
    res.cookie('cmdctr_session', rawToken, {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: 'lax',
      maxAge: config.sessionMaxAgeHours * 3600 * 1000,
      path: '/'
    });

    recordAudit(user.id, 'LOGIN_SUCCESS', 'Successful team login', req);

    return res.json({
      ok: true,
      mustChangePassword: user.must_change_password === 1,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
        designation: user.designation,
        location: user.location,
        techHorizonAccess: user.tech_horizon_access === 1,
        monthlyReportAccess: user.monthly_report_access === 1
      }
    });

  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ ok: false, error: 'Internal authentication error. Please try again.' });
  }
});

/**
 * POST /api/auth/logout
 */
router.post('/logout', (req, res) => {
  const token = req.cookies && req.cookies.cmdctr_session;
  if (token) {
    try {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
      if (req.user) {
        recordAudit(req.user.id, 'LOGOUT', 'User logged out', req);
      }
    } catch (err) {
      console.error('Logout error:', err);
    }
  }

  res.clearCookie('cmdctr_session', { path: '/' });
  return res.json({ ok: true });
});

/**
 * POST /api/auth/change-password
 */
router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;

  if (!currentPassword || !newPassword || !confirmPassword) {
    return res.status(400).json({ ok: false, error: 'All password fields are required.' });
  }

  if (newPassword !== confirmPassword) {
    return res.status(400).json({ ok: false, error: 'New password and confirmation do not match.' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ ok: false, error: 'New password must be at least 8 characters long.' });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found.' });
    }

    const match = await bcrypt.compare(currentPassword, user.password_hash);
    if (!match) {
      return res.status(401).json({ ok: false, error: 'Current password is incorrect.' });
    }

    // Check if new password is identical to old password
    const isSame = await bcrypt.compare(newPassword, user.password_hash);
    if (isSame) {
      return res.status(400).json({ ok: false, error: 'New password must be different from current password.' });
    }

    // Hash new password using 12 rounds
    const newHash = await bcrypt.hash(newPassword, 12);

    db.prepare(`
      UPDATE users 
      SET password_hash = ?, must_change_password = 0, updated_at = datetime('now')
      WHERE id = ?
    `).run(newHash, user.id);

    recordAudit(user.id, 'PASSWORD_CHANGED', 'User updated password', req);

    return res.json({ ok: true, message: 'Password updated successfully.' });

  } catch (err) {
    console.error('Password change error:', err);
    return res.status(500).json({ ok: false, error: 'Failed to update password.' });
  }
});

/**
 * GET /api/auth/verify (Used by Nginx auth_request subrequests)
 */
router.get('/verify', (req, res) => {
  if (req.user) {
    res.setHeader('X-User-Id', String(req.user.id));
    res.setHeader('X-User-Name', req.user.username);
    res.setHeader('X-User-Role', req.user.role);
    res.setHeader('X-Tech-Horizon-Access', String(req.user.tech_horizon_access));
    res.setHeader('X-Monthly-Report-Access', String(req.user.monthly_report_access));
    return res.status(200).send('OK');
  }
  return res.status(401).send('Unauthorized');
});

module.exports = router;
