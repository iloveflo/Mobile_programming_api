import 'dotenv/config';
import bcrypt from 'bcryptjs';
import pool from '../src/config/db.js';
try {
  // Only repair the documented plaintext demo password, never reset a user's changed password.
  const hash = await bcrypt.hash('123456', 10);
  const result = await pool.query("UPDATE users SET password_hash=$1 WHERE email='dev@test.com' AND password_hash='123456'", [hash]);
  console.log(`Repaired ${result.rowCount} demo account(s).`);
} finally { await pool.end(); }
