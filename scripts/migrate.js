import 'dotenv/config';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import pool, { withTransaction } from '../src/config/db.js';

const migrationsDir = new URL('../migrations/', import.meta.url);

try {
  if (!existsSync(migrationsDir)) {
    console.log('No migrations directory found, skipping.');
  } else {
    const files = (await readdir(migrationsDir)).filter(x => x.endsWith('.sql')).sort();
    if (files.length === 0) {
      console.log('No pending SQL migration files.');
    } else {
      await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
      for (const name of files) {
        await withTransaction(async db => {
          await db.query('SELECT pg_advisory_xact_lock(91827461)');
          if ((await db.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name])).rowCount) return;
          await db.query(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
          await db.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
          console.log(`Applied ${name}`);
        });
      }
    }
  }
} catch (error) {
  console.error('Migration failed:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
