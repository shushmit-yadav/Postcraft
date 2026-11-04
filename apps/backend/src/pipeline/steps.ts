import { setTimeout as sleep } from 'node:timers/promises';
import { STEP_PROGRESS } from '@app/shared';
import type { PipelineStep } from './types.js';

/**
 * Pipeline definition, in order.
 *
 * DAY 1: the steps below are placeholders that simulate work, so the job
 * system (queue, checkpoints, retries, status UI) can be built and tested end
 * to end first. Day 2 replaces them with the real scraper, content provider
 * and FFmpeg renderer, without changing the runner.
 */
export const PIPELINE: PipelineStep[] = [
  {
    name: 'ingesting',
    startMessage: 'Fetching product details',
    progressRange: STEP_PROGRESS.ingesting,
    timeoutMs: 30_000,
    isDone: (job) => job.product !== null,
    async run({ job, signal }) {
      await sleep(800, undefined, { signal });
      const title = job.inputUrl ? new URL(job.inputUrl).hostname : 'Uploaded product';
      return { product: { title, imageAssetIds: [] } };
    },
  },
  {
    name: 'analyzing',
    startMessage: 'Analyzing the product',
    progressRange: STEP_PROGRESS.analyzing,
    timeoutMs: 60_000,
    isDone: (job) => job.analysis !== null,
    async run({ signal }) {
      await sleep(800, undefined, { signal });
      return {
        analysis: { category: 'general', sellingPoints: [], audience: 'shoppers', heroImageIndex: 0 },
      };
    },
  },
  {
    name: 'scripting',
    startMessage: 'Writing the script and caption',
    progressRange: STEP_PROGRESS.scripting,
    timeoutMs: 60_000,
    isDone: (job) => job.script !== null,
    async run({ job, signal }) {
      await sleep(800, undefined, { signal });
      const title = job.product?.title ?? 'this product';
      return {
        provider: 'mock',
        script: {
          hook: `You need to see ${title}`,
          scenes: [{ text: `Meet ${title}`, imageIndex: 0, durationSec: 3 }],
          cta: 'Shop now',
          caption: `Check out ${title}!`,
          hashtags: ['#shopping'],
        },
      };
    },
  },
  {
    name: 'rendering',
    startMessage: 'Rendering your content',
    progressRange: STEP_PROGRESS.rendering,
    timeoutMs: 5 * 60_000,
    isDone: (_job, hasOutputs) => hasOutputs,
    async run({ signal, progress }) {
      for (let i = 1; i <= 4; i++) {
        await sleep(500, undefined, { signal });
        await progress(i / 4);
      }
    },
  },
  {
    name: 'finalizing',
    startMessage: 'Verifying output against platform format rules',
    progressRange: STEP_PROGRESS.finalizing,
    timeoutMs: 30_000,
    isDone: () => false,
    async run({ signal }) {
      await sleep(300, undefined, { signal });
    },
  },
];
