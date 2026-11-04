import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './client.js';
import { logger } from '../lib/logger.js';

const MIGRATION_LOCK_ID = 727_001;
const here = path.dirname(fileURLToPath(import.meta.url));
/** src/db (tsx) → apps/backend/drizzle; dist/ (bundled) → apps/backend/drizzle too. */
const candidates = [path.resolve(here, '../../drizzle'), path.resolve(here, '../drizzle')];

/**
 * Applies pending migrations. Guarded by a Postgres advisory lock so the API
 * and worker can both start at the same time without racing.
 */
export async function runMigrations() {
  const { existsSync } = await import('node:fs');
  const migrationsFolder = candidates.find((p) => existsSync(p));
  if (!migrationsFolder) throw new Error(`Migrations folder not found (looked in ${candidates.join(', ')})`);

  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await migrate(db, { migrationsFolder });
    logger.info('database migrations up to date');
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
    client.release();
  }
}

// Allow `npm run db:migrate`.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runMigrations()
    .then(() => pool.end())
    .catch((err) => {
      logger.error(err, 'migration failed');
      process.exit(1);
    });
}
