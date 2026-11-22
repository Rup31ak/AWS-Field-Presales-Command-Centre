'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const { requireAuth, requireAdmin, requireAppAccess } = require('../middleware/auth');

const router = express.Router();
const viewsDir = path.resolve(__dirname, '..', '..', 'views');

/**
 * GET /login
 */
router.get('/login', (req, res) => {
  if (req.user && req.user.must_change_password !== 1) {
    return res.redirect('/');
  }
  res.sendFile(path.join(viewsDir, 'login.html'));
});

/**
 * GET / — Unified Command Centre Launchpad
 */
router.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(viewsDir, 'dashboard.html'));
});

/**
 * GET /admin — User Management & Admin Console
 */
router.get('/admin', requireAuth, requireAdmin, (req, res) => {
  res.sendFile(path.join(viewsDir, 'admin.html'));
});

/**
 * GET /profile — User Profile & Password Change
 */
router.get('/profile', requireAuth, (req, res) => {
  res.sendFile(path.join(viewsDir, 'profile.html'));
});

/**
 * GET /tech-horizon — Launch Route to Standalone AWS Tech Horizon
 */
router.get('/tech-horizon', (req, res) => {
  // Redirects directly to the standalone AWS Tech Horizon running at http://13.235.2.205/
  res.redirect('http://13.235.2.205/');
});

/**
 * GET /monthly-report — Protected Launch Route for Monthly Report Generator
 */
router.get('/monthly-report', requireAuth, requireAppAccess('monthly_report'), (req, res) => {
  // Reserved route for Monthly Report Generator (assets supplied separately by user)
  const reportPath = path.resolve(__dirname, '..', '..', 'monthly-report', 'index.html');
  if (fs.existsSync(reportPath)) {
    return res.sendFile(reportPath);
  }
  return res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8"><title>Monthly Report Generator — Coming Soon</title>
      <style>
        body { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #F9FCF7; color: #14301F; padding: 60px 20px; text-align: center; }
        .card { max-width: 600px; margin: 0 auto; background: #fff; padding: 40px; border-radius: 16px; border: 1px solid #D3E6D9; box-shadow: 0 10px 30px rgba(11,107,66,0.06); }
        h1 { color: #0B6B42; font-size: 26px; margin-bottom: 12px; }
        p { color: #5A7665; line-height: 1.6; margin-bottom: 24px; }
        a { display: inline-block; padding: 10px 22px; background: #0B6B42; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600; }
        a:hover { background: #0B4D31; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>Monthly Report Generator</h1>
        <p>This application module is reserved and protected by the Command Centre authentication gateway. The static HTML/CSS/JS application assets will be placed here upon delivery.</p>
        <a href="/">← Return to Command Centre Launchpad</a>
      </div>
    </body>
    </html>
  `);
});

module.exports = router;
