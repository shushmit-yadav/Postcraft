import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { fromDrizzle } from 'pg-boss';
import {
  FORMATS,
  isTerminal,
  type CreateJobInput,
  type JobOutput,
  type JobView,
} from '@app/shared';
import { db, type Tx } from '../db/client.js';
import { assets, jobEvents, jobs, type JobRow } from '../db/schema.js';
import { AppError, conflict, notFound } from '../lib/errors.js';
import { boss, GENERATE_QUEUE, type GenerateJobData } from '../queue.js';
import { addEvent } from './events.js';
import { fileUrls } from '../storage/signing.js';

async function enqueue(tx: Tx, jobId: string) {
  // Same transaction as the job row: a job is never saved without being queued, or vice versa.
  await boss.send(GENERATE_QUEUE, { jobId } satisfies GenerateJobData, {
    db: fromDrizzle(tx, sql),
  });
}

export async function createJob(
  sessionId: string,
  input: CreateJobInput,
  idempotencyKey?: string,
): Promise<{ jobId: string; created: boolean }> {
  if (idempotencyKey) {
    const existing = await db.query.jobs.findFirst({
      columns: { id: true },
      where: and(eq(jobs.sessionId, sessionId), eq(jobs.idempotencyKey, idempotencyKey)),
    });
    if (existing) return { jobId: existing.id, created: false };
  }

  if (input.inputType !== 'url') {
    const asset = await db.query.assets.findFirst({
      where: and(eq(assets.id, input.assetId), eq(assets.sessionId, sessionId)),
    });
    const expected = input.inputType === 'image' ? 'source_image' : 'source_video';
    if (!asset || asset.kind !== expected) throw notFound('Uploaded file');
  }

  const jobId = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(jobs)
      .values({
        sessionId,
        inputType: input.inputType,
        inputUrl: input.inputType === 'url' ? input.url : null,
        inputAssetId: input.inputType === 'url' ? null : input.assetId,
        platform: input.platform,
        formatId: input.formatId,
        options: input.options,
        idempotencyKey: idempotencyKey ?? null,
      })
      .returning({ id: jobs.id });
    if (!row) throw new Error('insert returned no row');
    await addEvent(row.id, 'queued', 'Job created and queued', 'info', tx);
    await enqueue(tx, row.id);
    return row.id;
  });

  return { jobId, created: true };
}

async function getOwnedJob(jobId: string, sessionId: string): Promise<JobRow> {
  const job = await db.query.jobs.findFirst({
    where: and(eq(jobs.id, jobId), eq(jobs.sessionId, sessionId)),
  });
  if (!job) throw notFound('Job');
  return job;
}

export async function getJobView(jobId: string, sessionId: string): Promise<JobView> {
  const job = await getOwnedJob(jobId, sessionId);
  const [events, outputs] = await Promise.all([
    db.select().from(jobEvents).where(eq(jobEvents.jobId, jobId)).orderBy(asc(jobEvents.id)),
    db
      .select()
      .from(assets)
      .where(
        and(
          eq(assets.jobId, jobId),
          inArray(assets.kind, ['output_video', 'output_image', 'thumbnail']),
        ),
      )
      .orderBy(asc(assets.createdAt)),
  ]);

  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    inputType: job.inputType,
    inputUrl: job.inputUrl,
    platform: job.platform as JobView['platform'],
    formatId: job.formatId as JobView['formatId'],
    provider: job.provider ?? null,
    script: job.script ?? null,
    error: job.errorCode
      ? {
          code: job.errorCode,
          message: job.errorMessage ?? 'Generation failed',
          retryable: job.errorRetryable ?? false,
        }
      : null,
    attempts: job.attempts,
    events: events.map((e) => ({
      id: e.id,
      step: e.step,
      level: e.level,
      message: e.message,
      createdAt: e.createdAt.toISOString(),
    })),
    outputs: outputs.map(
      (a): JobOutput => ({
        id: a.id,
        kind: a.kind as JobOutput['kind'],
        mime: a.mime,
        width: a.width,
        height: a.height,
        durationMs: a.durationMs,
        bytes: a.bytes,
        ...fileUrls(a.storageKey, downloadName(job, a.mime)),
      }),
    ),
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
  };
}

function downloadName(job: JobRow, mime: string) {
  const format = FORMATS[job.formatId as keyof typeof FORMATS];
  const ext = mime === 'video/mp4' ? 'mp4' : mime === 'image/png' ? 'png' : 'jpg';
  return `${format?.platform ?? 'post'}-${job.formatId}-${job.id.slice(0, 8)}.${ext}`;
}

/** Re-queues a failed or cancelled job. Completed steps are skipped thanks to checkpoints. */
export async function retryJob(jobId: string, sessionId: string) {
  const job = await getOwnedJob(jobId, sessionId);
  if (job.status !== 'failed' && job.status !== 'cancelled') {
    throw conflict('Only failed or cancelled jobs can be retried');
  }
  await db.transaction(async (tx) => {
    await tx
      .update(jobs)
      .set({ status: 'queued', errorCode: null, errorMessage: null, errorRetryable: null })
      .where(eq(jobs.id, jobId));
    await addEvent(jobId, 'queued', 'Retry requested: resuming from the last completed step', 'info', tx);
    await enqueue(tx, jobId);
  });
}

export async function cancelJob(jobId: string, sessionId: string) {
  const job = await getOwnedJob(jobId, sessionId);
  if (isTerminal(job.status)) throw conflict(`Job is already ${job.status}`);
  await db.update(jobs).set({ status: 'cancelled' }).where(eq(jobs.id, jobId));
  await addEvent(jobId, 'cancelled', 'Cancelled by user', 'warn');
}

export const assertJobStatus = (job: JobRow, allowed: JobRow['status'][]) => {
  if (!allowed.includes(job.status)) {
    throw new AppError('INVALID_STATE', `Job is ${job.status}`, { status: 409 });
  }
};
