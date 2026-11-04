import type { JobStep } from '@app/shared';
import type { JobRow } from '../db/schema.js';
import type { Logger } from '../lib/logger.js';

export interface StepContext {
  job: JobRow;
  /** Aborted on step timeout or worker shutdown. Long operations must respect it. */
  signal: AbortSignal;
  log: Logger;
  /** Report progress within the step, 0..1. */
  progress(fraction: number): Promise<void>;
  /** Add a user-visible line to the job timeline. */
  event(message: string, level?: 'info' | 'warn' | 'error'): Promise<void>;
}

/** Columns a step may checkpoint when it finishes. */
export type StepResult = Partial<Pick<JobRow, 'product' | 'analysis' | 'script' | 'provider'>>;

export interface PipelineStep {
  name: JobStep;
  /** Shown in the timeline when the step starts. */
  startMessage: string;
  /** Overall progress range this step covers, e.g. [10, 30]. */
  progressRange: readonly [number, number];
  timeoutMs: number;
  /** True when this step's checkpoint is already saved, so a retry skips it. */
  isDone(job: JobRow, hasOutputs: boolean): boolean;
  run(ctx: StepContext): Promise<StepResult | void>;
}
