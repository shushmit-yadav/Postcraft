import { eq } from 'drizzle-orm';
import { db, type Tx } from '../db/client.js';
import { jobEvents, jobs } from '../db/schema.js';
import type { JobStatus } from '@app/shared';

type Executor = typeof db | Tx;

/** Appends a line to the job's timeline (shown in the UI). */
export async function addEvent(
  jobId: string,
  step: string,
  message: string,
  level: 'info' | 'warn' | 'error' = 'info',
  exec: Executor = db,
) {
  await exec.insert(jobEvents).values({ jobId, step, message, level });
}

export async function setStatus(jobId: string, status: JobStatus, progress?: number) {
  await db
    .update(jobs)
    .set({ status, ...(progress === undefined ? {} : { progress }) })
    .where(eq(jobs.id, jobId));
}

export async function setProgress(jobId: string, progress: number) {
  await db.update(jobs).set({ progress: Math.round(progress) }).where(eq(jobs.id, jobId));
}
