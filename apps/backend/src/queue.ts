import { PgBoss } from 'pg-boss';
import { config } from './config.js';
import { logger } from './lib/logger.js';

export const GENERATE_QUEUE = 'generate-content';

/**
 * Retry policy lives on the queue: retryable failures are retried with
 * exponential backoff (5s, 10s, 20s). Heartbeats let pg-boss notice a worker
 * that died mid-job and hand the job to another worker.
 */
export const QUEUE_POLICY = {
  retryLimit: 3,
  retryDelay: 5,
  retryBackoff: true,
  retryDelayMax: 60,
  expireInSeconds: 15 * 60,
  heartbeatSeconds: 15,
} as const;

export interface GenerateJobData {
  jobId: string;
}

export const boss = new PgBoss({
  connectionString: config.DATABASE_URL,
  max: 4,
  // How often pg-boss looks for jobs whose worker stopped heartbeating (default 60s).
  // Lower = faster recovery after a crash, at the cost of one cheap query every 10s.
  superviseIntervalSeconds: 10,
});
boss.on('error', (err) => logger.error({ err }, 'pg-boss error'));

let started: Promise<unknown> | undefined;

/** Starts pg-boss once (it installs/migrates its own schema) and ensures our queue exists. */
export function startQueue() {
  started ??= (async () => {
    await boss.start();
    // Create on first run; afterwards keep the stored policy in sync with the code.
    if (await boss.getQueue(GENERATE_QUEUE)) await boss.updateQueue(GENERATE_QUEUE, QUEUE_POLICY);
    else await boss.createQueue(GENERATE_QUEUE, QUEUE_POLICY);
  })();
  return started;
}
