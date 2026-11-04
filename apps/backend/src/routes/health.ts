import type { FastifyPluginAsync } from 'fastify';
import { gt, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { workerHeartbeats } from '../db/schema.js';
import { config } from '../config.js';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', { config: { rateLimit: false } }, async (_req, reply) => {
    let database = false;
    let workers = 0;
    try {
      await db.execute(sql`select 1`);
      database = true;
      const live = await db
        .select({ id: workerHeartbeats.workerId })
        .from(workerHeartbeats)
        .where(gt(workerHeartbeats.lastSeenAt, sql`now() - interval '30 seconds'`));
      workers = live.length;
    } catch (err) {
      app.log.error({ err }, 'health check failed');
    }
    const ok = database;
    return reply.code(ok ? 200 : 503).send({
      status: ok ? 'ok' : 'degraded',
      database,
      workers,
      contentProvider: config.ANTHROPIC_API_KEY ? 'claude' : 'mock',
    });
  });
};
