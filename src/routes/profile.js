'use strict';

const express = require('express');
const db = require('../database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

/**
 * GET /api/profile
 */
router.get('/', (req, res) => {
  try {
    const user = db.prepare(`
      SELECT 
        id, username, email, full_name, designation, location,
        role, status, tech_horizon_access, monthly_report_access,
        must_change_password, created_at, updated_at
      FROM users WHERE id = ?
    `).get(req.user.id);

    if (!user) {
      return res.status(404).json({ ok: false, error: 'User profile not found.' });
    }

    return res.json({ ok: true, user });
  } catch (err) {
    console.error('Profile fetch error:', err);
    return res.status(500).json({ ok: false, error: 'Failed to retrieve profile.' });
  }
});

/**
 * PUT /api/profile
 */
router.put('/', (req, res) => {
  const { full_name, designation = '', location = '' } = req.body;

  if (!full_name || !String(full_name).trim()) {
    return res.status(400).json({ ok: false, error: 'Full name cannot be blank.' });
  }

  try {
    db.prepare(`
      UPDATE users SET
        full_name = ?,
        designation = ?,
        location = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      String(full_name).trim(),
      String(designation).trim(),
      String(location).trim(),
      req.user.id
    );

    return res.json({ ok: true, message: 'Profile updated successfully.' });
  } catch (err) {
    console.error('Profile update error:', err);
    return res.status(500).json({ ok: false, error: 'Failed to update profile.' });
  }
});

module.exports = router;
