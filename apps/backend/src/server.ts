import { buildApp } from './app.js';
import { config } from './config.js';
import { pool } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { boss, startQueue } from './queue.js';

async function main() {
  await runMigrations();
  await startQueue(); // the API only enqueues; workers process
  const app = await buildApp();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await boss.stop({ graceful: false });
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.PORT, host: config.HOST });
}

main().catch((err) => {
  console.error('API failed to start', err);
  process.exit(1);
});
