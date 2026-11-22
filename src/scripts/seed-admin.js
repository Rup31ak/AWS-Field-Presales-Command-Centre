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

  const username = config.initialAdmin.username || 'Rupak';
  const email = config.initialAdmin.email || 'rupak@redington.com';
  const fullName = config.initialAdmin.fullName || 'Rupak';
  const password = config.initialAdmin.password || 'Admin@Presales2026!';

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
    'Chennai / Mumbai, India',
    passwordHash
  );

  const newAdmin = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  const credentialTxt = generateCredentialTxt(newAdmin, password);

  console.log('\n================================================================');
  console.log('  INITIAL ADMINISTRATOR BOOTSTRAP COMPLETE');
  console.log('================================================================');
  console.log(`  Portal URL:            ${config.portalUrl}/login`);
  console.log(`  Administrator Username: ${newAdmin.username}`);
  console.log(`  Administrator Password: ${password}`);
  console.log(`  Account Role:          ${newAdmin.role}`);
  console.log(`  Corporate Email:       ${newAdmin.email}`);
  console.log('----------------------------------------------------------------');
  console.log('  MANDATORY ACTION:');
  console.log('  First-login password change is ENABLED. You will be prompted');
  console.log('  to set your new personal password upon signing in.');
  console.log('================================================================\n');

  process.exit(0);
}

seedAdmin().catch(err => {
  console.error('Admin bootstrap failed:', err);
  process.exit(1);
});
