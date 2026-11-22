'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { generateTemporaryPassword, generateCredentialTxt } = require('../services/credentialGenerator');

const router = express.Router();

router.use(requireAuth, requireAdmin);

// Helper for audit logging
function recordAudit(userId, action, details, req) {
  try {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    db.prepare('INSERT INTO audit_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)')
      .run(userId, action, details, String(ip));
  } catch (err) {
    console.error('Audit log failure:', err);
  }
}

/**
 * GET /api/admin/users
 */
router.get('/users', (req, res) => {
  try {
    const users = db.prepare(`
      SELECT 
        id, username, email, full_name, designation, location,
        role, status, tech_horizon_access, monthly_report_access,
        must_change_password, created_at, updated_at
      FROM users
      ORDER BY created_at DESC
    `).all();

    return res.json({ ok: true, users });
  } catch (err) {
    console.error('List users error:', err);
    return res.status(500).json({ ok: false, error: 'Failed to retrieve team users.' });
  }
});

/**
 * POST /api/admin/users — Create User & Generate Ephemeral Credentials
 */
router.post('/users', async (req, res) => {
  const {
    username,
    email,
    full_name,
    designation = '',
    location = '',
    role = 'User',
    status = 'Active',
    tech_horizon_access = 1,
    monthly_report_access = 1
  } = req.body;

  if (!username || !email || !full_name) {
    return res.status(400).json({ ok: false, error: 'Username, email, and full name are required.' });
  }

  const cleanUsername = String(username).trim();
  const cleanEmail = String(email).trim().toLowerCase();
  const cleanFullName = String(full_name).trim();

  // Validate format
  if (!/^[a-zA-Z0-9._-]{3,30}$/.test(cleanUsername)) {
    return res.status(400).json({ 
      ok: false, 
      error: 'Username must be 3-30 characters (letters, numbers, dots, dashes, underscores).' 
    });
  }

  if (!cleanEmail.includes('@') || !cleanEmail.includes('.')) {
    return res.status(400).json({ ok: false, error: 'Please enter a valid corporate email address.' });
  }

  try {
    // Check for existing username or email
    const existing = db.prepare('SELECT id, username, email FROM users WHERE username = ? OR email = ?').get(cleanUsername, cleanEmail);
    if (existing) {
      if (existing.username.toLowerCase() === cleanUsername.toLowerCase()) {
        return res.status(409).json({ ok: false, error: 'A team member with this username already exists.' });
      }
      return res.status(409).json({ ok: false, error: 'A team member with this email address already exists.' });
    }

    // 1. Generate 16-character cryptographically secure temporary password
    const temporaryPassword = generateTemporaryPassword(16);

    // 2. Hash temporary password with bcrypt (12 rounds)
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);

    // 3. Insert user with must_change_password = 1
    const stmt = db.prepare(`
      INSERT INTO users (
        username, email, full_name, designation, location,
        password_hash, role, status, tech_horizon_access,
        monthly_report_access, must_change_password
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);

    const result = stmt.run(
      cleanUsername,
      cleanEmail,
      cleanFullName,
      String(designation).trim(),
      String(location).trim(),
      passwordHash,
      role === 'Admin' ? 'Admin' : 'User',
      status === 'Inactive' ? 'Inactive' : 'Active',
      tech_horizon_access ? 1 : 0,
      monthly_report_access ? 1 : 0
    );

    const newUser = db.prepare('SELECT id, username, email, full_name, designation, location, role, status, tech_horizon_access, monthly_report_access, created_at FROM users WHERE id = ?').get(result.lastInsertRowid);

    // 4. Generate downloadable TXT credential file in memory
    const credentialTxt = generateCredentialTxt(newUser, temporaryPassword);

    recordAudit(req.user.id, 'USER_CREATED', `Created user ${cleanUsername} (ID: ${newUser.id})`, req);

    return res.status(201).json({
      ok: true,
      message: `User ${cleanUsername} created successfully.`,
      user: newUser,
      temporaryPassword,
      credentialTxt
    });

  } catch (err) {
    console.error('Create user error:', err);
    return res.status(500).json({ ok: false, error: 'Failed to create user account.' });
  }
});

/**
 * PUT /api/admin/users/:id — Edit User Details & Permissions
 */
router.put('/users/:id', (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const {
    email,
    full_name,
    designation = '',
    location = '',
    role,
    status,
    tech_horizon_access,
    monthly_report_access
  } = req.body;

  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found.' });
    }

    // Safety: prevent demoting or disabling the only active administrator
    if (user.role === 'Admin' && (role === 'User' || status === 'Inactive')) {
      const adminCount = db.prepare("SELECT count(*) as c FROM users WHERE role = 'Admin' AND status = 'Active'").get().c;
      if (adminCount <= 1) {
        return res.status(400).json({ 
          ok: false, 
          error: 'Cannot demote or deactivate the sole active Administrator account.' 
        });
      }
    }

    const cleanEmail = email ? String(email).trim().toLowerCase() : user.email;
    const cleanFullName = full_name ? String(full_name).trim() : user.full_name;

    // Check email clash
    if (cleanEmail !== user.email) {
      const clash = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(cleanEmail, userId);
      if (clash) {
        return res.status(409).json({ ok: false, error: 'Email address already in use by another user.' });
      }
    }

    db.prepare(`
      UPDATE users SET
        email = ?,
        full_name = ?,
        designation = ?,
        location = ?,
        role = ?,
        status = ?,
        tech_horizon_access = ?,
        monthly_report_access = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      cleanEmail,
      cleanFullName,
      String(designation).trim(),
      String(location).trim(),
      role === 'Admin' ? 'Admin' : 'User',
      status === 'Inactive' ? 'Inactive' : 'Active',
      tech_horizon_access ? 1 : 0,
      monthly_report_access ? 1 : 0,
      userId
    );

    // If deactivated, revoke all active sessions immediately
    if (status === 'Inactive') {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    }

    recordAudit(req.user.id, 'USER_UPDATED', `Updated user ${user.username} (ID: ${userId})`, req);

    return res.json({ ok: true, message: 'User updated successfully.' });

  } catch (err) {
    console.error('Update user error:', err);
    return res.status(500).json({ ok: false, error: 'Failed to update user.' });
  }
});

/**
 * POST /api/admin/users/:id/reset-password — Generate New Temporary Password
 */
router.post('/users/:id/reset-password', async (req, res) => {
  const userId = parseInt(req.params.id, 10);

  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found.' });
    }

    // 1. Generate new 16-character temporary password
    const temporaryPassword = generateTemporaryPassword(16);

    // 2. Hash with bcrypt (12 rounds)
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);

    // 3. Update password and set must_change_password = 1
    db.prepare(`
      UPDATE users 
      SET password_hash = ?, must_change_password = 1, updated_at = datetime('now')
      WHERE id = ?
    `).run(passwordHash, userId);

    // 4. Invalidate all existing sessions for this user
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);

    // 5. Generate downloadable TXT file
    const credentialTxt = generateCredentialTxt(user, temporaryPassword);

    recordAudit(req.user.id, 'PASSWORD_RESET', `Reset temporary password for ${user.username}`, req);

    return res.json({
      ok: true,
      message: `Password reset successfully for ${user.username}.`,
      temporaryPassword,
      credentialTxt
    });

  } catch (err) {
    console.error('Password reset error:', err);
    return res.status(500).json({ ok: false, error: 'Failed to reset user password.' });
  }
});

/**
 * DELETE /api/admin/users/:id
 */
router.delete('/users/:id', (req, res) => {
  const userId = parseInt(req.params.id, 10);

  if (userId === req.user.id) {
    return res.status(400).json({ ok: false, error: 'You cannot delete your own account.' });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found.' });
    }

    if (user.role === 'Admin') {
      const adminCount = db.prepare("SELECT count(*) as c FROM users WHERE role = 'Admin'").get().c;
      if (adminCount <= 1) {
        return res.status(400).json({ ok: false, error: 'Cannot delete the sole Administrator account.' });
      }
    }

    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);

    recordAudit(req.user.id, 'USER_DELETED', `Deleted user ${user.username} (ID: ${userId})`, req);

    return res.json({ ok: true, message: `User ${user.username} deleted successfully.` });

  } catch (err) {
    console.error('Delete user error:', err);
    return res.status(500).json({ ok: false, error: 'Failed to delete user account.' });
  }
});

/**
 * GET /api/admin/audit-log
 */
router.get('/audit-log', (req, res) => {
  try {
    const logs = db.prepare(`
      SELECT 
        a.id, a.user_id, u.username, a.action, a.details, a.ip_address, a.timestamp
      FROM audit_log a
      LEFT JOIN users u ON a.user_id = u.id
      ORDER BY a.id DESC
      LIMIT 100
    `).all();

    return res.json({ ok: true, logs });
  } catch (err) {
    console.error('Audit log fetch error:', err);
    return res.status(500).json({ ok: false, error: 'Failed to load audit logs.' });
  }
});

module.exports = router;
