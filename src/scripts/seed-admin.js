'use strict';

const bcrypt = require('bcrypt');
const config = require('../config');
const db = require('../database');
const { generateTemporaryPassword, generateCredentialTxt } = require('../services/credentialGenerator');

async function seedAdmin() {
  console.log('Checking for existing Administrator account...');

  const existingAdmin = db.prepare("SELECT id, username, email FROM users WHERE role = 'Admin' LIMIT 1").get();
  if (existingAdmin) {
    console.log(`Administrator account already exists: ${existingAdmin.username} (${existingAdmin.email}). No seed required.`);
    process.exit(0);
  }

  console.log('No administrator found. Bootstrapping initial Administrator account...');

  const username = config.initialAdmin.username;
  const email = config.initialAdmin.email;
  const fullName = config.initialAdmin.fullName;
  const password = config.initialAdmin.password || generateTemporaryPassword(16);

  const passwordHash = await bcrypt.hash(password, 12);

  const insert = db.prepare(`
    INSERT INTO users (
      username, email, full_name, designation, location,
      password_hash, role, status, tech_horizon_access,
      monthly_report_access, must_change_password
    ) VALUES (?, ?, ?, ?, ?, ?, 'Admin', 'Active', 1, 1, 1)
  `);

  const result = insert.run(
    username,
    email,
    fullName,
    'Lead Cloud Solutions Architect',
    'Mumbai, India',
    passwordHash
  );

  const newAdmin = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  const credentialTxt = generateCredentialTxt(newAdmin, password);

  console.log('\n================================================================');
  console.log('INITIAL ADMINISTRATOR BOOTSTRAP SUCCESSFUL');
  console.log('================================================================');
  console.log(`Username:           ${newAdmin.username}`);
  console.log(`Email:              ${newAdmin.email}`);
  console.log(`Temporary Password: ${password}`);
  console.log(`Role:               Admin`);
  console.log(`Portal URL:         ${config.portalUrl}/login`);
  console.log('================================================================');
  console.log('IMPORTANT: Record this password. Mandatory password change is');
  console.log('enforced on first login.');
  console.log('================================================================\n');

  process.exit(0);
}

seedAdmin().catch(err => {
  console.error('Admin bootstrap failed:', err);
  process.exit(1);
});
