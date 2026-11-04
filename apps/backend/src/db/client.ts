import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { config } from '../config.js';
import * as schema from './schema.js';

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

export const db = drizzle(pool, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
