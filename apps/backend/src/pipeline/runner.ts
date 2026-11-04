import { and, eq, inArray, sql } from 'drizzle-orm';
import { isTerminal } from '@app/shared';
import { db } from '../db/client.js';
import { assets, jobs, type JobRow } from '../db/schema.js';
import { AppError, toAppError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import { addEvent, setProgress } from '../jobs/events.js';
import { PIPELINE } from './steps.js';
import type { PipelineStep } from './types.js';

export interface RunOptions {
  /** 0 for the first attempt. */
  attempt: number;
  /** When true, a retryable error fails the job instead of being retried. */
  isLastAttempt: boolean;
  /** Aborted when the worker is shutting down. */
  signal: AbortSignal;
  log: Logger;
}

async function loadJob(jobId: string) {
  return db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
}

async function hasOutputs(jobId: string) {
  const row = await db
    .select({ id: assets.id })
    .from(assets)
    .where(and(eq(assets.jobId, jobId), inArray(assets.kind, ['output_video', 'output_image'])))
    .limit(1);
  return row.length > 0;
}

/** Thrown inside the runner to stop work on a job that was cancelled meanwhile. */
class JobCancelled extends Error {}

/**
 * Runs a job's pipeline from its last checkpoint.
 *
 * - Each step saves its result before the next starts. A retry or a new worker
 *   picks up from the first unfinished step instead of starting over.
 * - Retryable errors are re-thrown so pg-boss retries with backoff.
 *   Terminal errors (or the last attempt) mark the job failed with a user-facing message.
 * - Returning normally tells pg-boss the queue job is done.
 */
export async function runPipeline(jobId: string, opts: RunOptions): Promise<void> {
  const log = opts.log.child({ jobId, attempt: opts.attempt });
  const initial = await loadJob(jobId);
  if (!initial) {
    log.warn('job row not found; dropping queue message');
    return;
  }
  if (isTerminal(initial.status)) {
    log.info({ status: initial.status }, 'job already finished; skipping');
    return;
  }
  if (initial.status === 'awaiting_review' && !initial.scriptApprovedAt) return;

  await db
    .update(jobs)
    .set({ attempts: sql`${jobs.attempts} + 1` })
    .where(eq(jobs.id, jobId));
  if (opts.attempt > 0) await addEvent(jobId, 'retry', `Retry attempt ${opts.attempt}`, 'warn');

  let current: PipelineStep | undefined;
  try {
    for (const step of PIPELINE) {
      const job = await loadJob(jobId);
      if (!job || job.status === 'cancelled') throw new JobCancelled();
      if (step.isDone(job, await hasOutputs(jobId))) continue;

      if (step.name === 'rendering' && job.options.reviewBeforeRender && !job.scriptApprovedAt) {
        await db
          .update(jobs)
          .set({ status: 'awaiting_review', progress: step.progressRange[0] })
          .where(eq(jobs.id, jobId));
        await addEvent(jobId, 'awaiting_review', 'Script ready: review and edit it, then render');
        log.info('paused for script review');
        return;
      }

      current = step;
      await runStep(step, job, opts.signal, log);
    }

    await db
      .update(jobs)
      .set({ status: 'completed', progress: 100, completedAt: new Date() })
      .where(eq(jobs.id, jobId));
    await addEvent(jobId, 'completed', 'Your content is ready');
    log.info('job completed');
  } catch (err) {
    if (err instanceof JobCancelled) {
      log.info('job cancelled; stopping');
      return;
    }
    const appErr = toAppError(err);
    const stepName = current?.name ?? 'pipeline';
    log.error({ err, code: appErr.code, step: stepName }, 'step failed');

    if (appErr.retryable && !opts.isLastAttempt && !opts.signal.aborted) {
      await addEvent(jobId, stepName, `${appErr.userMessage} Retrying automatically…`, 'warn');
      throw err; // pg-boss schedules the retry with backoff
    }
    if (opts.signal.aborted && appErr.retryable) {
      // Worker is shutting down: leave the job for the next worker.
      await addEvent(jobId, stepName, 'Worker restarting: the job will resume shortly', 'warn');
      throw err;
    }
    await markFailed(jobId, stepName, appErr);
  }
}

async function runStep(step: PipelineStep, job: JobRow, workerSignal: AbortSignal, log: Logger) {
  const [from, to] = step.progressRange;
  await db.update(jobs).set({ status: step.name, progress: from }).where(eq(jobs.id, job.id));
  await addEvent(job.id, step.name, step.startMessage);

  const signal = AbortSignal.any([workerSignal, AbortSignal.timeout(step.timeoutMs)]);
  const stepLog = log.child({ step: step.name });
  const started = Date.now();

  const result = await abortable(
    step.run({
      job,
      signal,
      log: stepLog,
      progress: (f) => setProgress(job.id, from + (to - from) * Math.min(Math.max(f, 0), 1)),
      event: (message, level = 'info') => addEvent(job.id, step.name, message, level),
    }),
    signal,
  );

  await db
    .update(jobs)
    .set({ ...(result ?? {}), progress: to })
    .where(eq(jobs.id, job.id));
  stepLog.info({ ms: Date.now() - started }, 'step finished');
}

/** Rejects as soon as the signal aborts, even if the step ignores it. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

async function markFailed(jobId: string, step: string, err: AppError) {
  await db
    .update(jobs)
    .set({
      status: 'failed',
      errorCode: err.code,
      errorMessage: err.userMessage,
      errorRetryable: err.retryable,
    })
    .where(eq(jobs.id, jobId));
  await addEvent(jobId, step, err.userMessage, 'error');
}
