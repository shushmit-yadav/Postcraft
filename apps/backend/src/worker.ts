import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { and, inArray, lt, sql } from 'drizzle-orm';
import { JOB_STEPS } from '@app/shared';
import { config } from './config.js';
import { db, pool } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { jobs, workerHeartbeats } from './db/schema.js';
import { logger } from './lib/logger.js';
import { runPipeline } from './pipeline/runner.js';
import { boss, GENERATE_QUEUE, QUEUE_POLICY, startQueue, type GenerateJobData } from './queue.js';

const workerId = `${os.hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
const log = logger.child({ workerId });

const HEARTBEAT_MS = 10_000;
const SWEEP_MS = 60_000;
/** An active job with no progress update for this long is considered stuck. */
const STALLED_AFTER_MINUTES = 20;

async function heartbeat() {
  await db
    .insert(workerHeartbeats)
    .values({ workerId, hostname: os.hostname(), lastSeenAt: new Date() })
    .onConflictDoUpdate({ target: workerHeartbeats.workerId, set: { lastSeenAt: new Date() } });
}

/**
 * Safety net: pg-boss already re-delivers jobs from crashed workers, but if a
 * job row is still "in progress" long after anything touched it, fail it so
 * the UI never spins forever. The user can retry it from the last checkpoint.
 */
async function sweepStalledJobs() {
  const stalled = await db
    .update(jobs)
    .set({
      status: 'failed',
      errorCode: 'STALLED',
      errorMessage: 'Generation stopped responding. Please retry.',
      errorRetryable: true,
    })
    .where(
      and(
        inArray(jobs.status, [...JOB_STEPS]),
        lt(jobs.updatedAt, sql`now() - make_interval(mins => ${STALLED_AFTER_MINUTES})`),
      ),
    )
    .returning({ id: jobs.id });
  if (stalled.length) log.warn({ jobIds: stalled.map((j) => j.id) }, 'marked stalled jobs as failed');
  await db
    .delete(workerHeartbeats)
    .where(lt(workerHeartbeats.lastSeenAt, sql`now() - interval '1 hour'`));
}

async function main() {
  await runMigrations();
  await startQueue();
  await heartbeat();

  const timers = [
    setInterval(() => heartbeat().catch((err) => log.error({ err }, 'heartbeat failed')), HEARTBEAT_MS),
    setInterval(() => sweepStalledJobs().catch((err) => log.error({ err }, 'sweep failed')), SWEEP_MS),
  ];

  await boss.work<GenerateJobData>(
    GENERATE_QUEUE,
    { localConcurrency: config.WORKER_CONCURRENCY, batchSize: 1, pollingIntervalSeconds: 1 },
    async ([job]) => {
      if (!job) return;
      await runPipeline(job.data.jobId, {
        attempt: job.retryCount,
        isLastAttempt: job.retryCount >= QUEUE_POLICY.retryLimit,
        signal: job.signal,
        log,
      });
    },
  );
  log.info({ concurrency: config.WORKER_CONCURRENCY }, 'worker started');

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, 'shutting down: finishing in-flight jobs');
    timers.forEach(clearInterval);
    // Graceful: stop fetching, wait for running jobs (up to 30s), then release.
    await boss.stop({ graceful: true, timeout: 30_000 });
    await db.delete(workerHeartbeats).where(sql`${workerHeartbeats.workerId} = ${workerId}`);
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  log.fatal({ err }, 'worker failed to start');
  process.exit(1);
});
