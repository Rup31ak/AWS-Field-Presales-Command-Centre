'use strict';

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const config = require('./config');
const db = require('./database');
const { authenticate } = require('./middleware/auth');

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const profileRoutes = require('./routes/profile');
const viewRoutes = require('./routes/views');

const app = express();

// Trust reverse proxy (Nginx)
app.set('trust proxy', 1);

// Security Headers (Zero-dependency helmet alternative)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Standard Body & Cookie Parsing
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());

// Global Session Authentication Middleware
app.use(authenticate);

// Static Assets (CSS, JS, Logos)
app.use(express.static(path.resolve(__dirname, '..', 'public')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/profile', profileRoutes);

// View Routes
app.use('/', viewRoutes);

// 404 Handler
app.use((req, res) => {
  if (req.xhr || req.path.startsWith('/api/')) {
    return res.status(404).json({ ok: false, error: 'API endpoint not found.' });
  }
  res.status(404).send(`
    <!DOCTYPE html>
    <html lang="en">
    <head><meta charset="utf-8"><title>404 — Not Found</title>
    <style>body{font-family:sans-serif;padding:60px 20px;text-align:center;color:#14301F;background:#F9FCF7}h1{color:#0B6B42}a{color:#0B6B42;text-decoration:none;font-weight:600}</style></head>
    <body>
      <h1>404 — Page Not Found</h1>
      <p>The requested page does not exist in the AWS Field Presales Command Centre.</p>
      <p><a href="/">Return to Command Centre Launchpad</a></p>
    </body>
    </html>
  `);
});

// 500 Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  if (res.headersSent) {
    return next(err);
  }
  if (req.xhr || req.path.startsWith('/api/')) {
    return res.status(500).json({ ok: false, error: 'Internal server error occurred.' });
  }
  res.status(500).send(`
    <!DOCTYPE html>
    <html lang="en">
    <head><meta charset="utf-8"><title>500 — Server Error</title>
    <style>body{font-family:sans-serif;padding:60px 20px;text-align:center;color:#14301F;background:#F9FCF7}h1{color:#B3261E}a{color:#0B6B42;text-decoration:none;font-weight:600}</style></head>
    <body>
      <h1>500 — Server Error</h1>
      <p>An unexpected error occurred. Please try again or contact the administrator.</p>
      <p><a href="/">Return to Command Centre Launchpad</a></p>
    </body>
    </html>
  `);
});

// Start Server
const server = app.listen(config.port, config.host, () => {
  console.log(`================================================================`);
  console.log(`AWS Field Presales Command Centre`);
  console.log(`Environment: ${config.nodeEnv}`);
  console.log(`Listening on: http://${config.host}:${config.port}`);
  console.log(`Database:    ${config.dbPath}`);
  console.log(`================================================================`);
});

// Graceful Shutdown
function handleShutdown(signal) {
  console.log(`\nReceived ${signal}. Shutting down gracefully...`);
  server.close(() => {
    try {
      db.close();
      console.log('Database connection closed cleanly.');
    } catch (e) {
      console.error('Error closing database:', e);
    }
    process.exit(0);
  });
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

module.exports = app;
