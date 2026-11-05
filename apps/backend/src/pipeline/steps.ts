import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { FORMATS, STEP_PROGRESS, type OutputFormat } from '@app/shared';
import { db } from '../db/client.js';
import { assets, type JobRow } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { formatPrice } from '../lib/price.js';
import { getContentProvider } from '../providers/content/index.js';
import { probe } from '../render/ffmpeg.js';
import { renderImage } from '../render/image.js';
import { INTRO_SECONDS, OUTRO_SECONDS, renderVideo } from '../render/video.js';
import { storage } from '../storage/index.js';
import { ingestFromUrl } from './ingest/index.js';
import type { PipelineStep } from './types.js';

const formatOf = (job: JobRow): OutputFormat => {
  const f = FORMATS[job.formatId as keyof typeof FORMATS];
  if (!f) throw new AppError('UNKNOWN_FORMAT', `Unknown format ${job.formatId}`);
  return f;
};

/** Local paths of the job's product images, in the order chosen by the ingest step. */
async function sourceImagePaths(job: JobRow): Promise<string[]> {
  const ids = job.product?.imageAssetIds ?? [];
  if (ids.length === 0) throw new AppError('NO_PRODUCT_IMAGES', 'No product images are available for this job.');
  const rows = await db.select().from(assets).where(inArray(assets.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return Promise.all(
    ids.map((id) => {
      const row = byId.get(id);
      if (!row) throw new AppError('SOURCE_MISSING', 'A product image is missing. Please retry.', { retryable: false });
      return storage.localPath(row.storageKey);
    }),
  );
}

/** Pipeline definition, in order. Each step checkpoints its result so retries resume. */
export const PIPELINE: PipelineStep[] = [
  {
    name: 'ingesting',
    startMessage: 'Fetching product details',
    progressRange: STEP_PROGRESS.ingesting,
    timeoutMs: 90_000,
    isDone: (job) => job.product !== null,
    async run(ctx) {
      // Image jobs are created with their product already set, so only video reaches this.
      if (ctx.job.inputType !== 'url') {
        throw new AppError('INPUT_NOT_SUPPORTED_YET', 'Video upload is coming soon. Use a product URL or an image.');
      }
      return { product: await ingestFromUrl(ctx) };
    },
  },
  {
    name: 'analyzing',
    startMessage: 'Analyzing the product',
    progressRange: STEP_PROGRESS.analyzing,
    timeoutMs: 90_000,
    isDone: (job) => job.analysis !== null,
    async run({ job, signal, event }) {
      const provider = getContentProvider();
      const analysis = await provider.analyze({ product: job.product!, imagePaths: await sourceImagePaths(job), signal });
      await event(`Category: ${analysis.category}. Audience: ${analysis.audience}`);
      return { analysis, provider: provider.name };
    },
  },
  {
    name: 'scripting',
    startMessage: 'Writing the script and caption',
    progressRange: STEP_PROGRESS.scripting,
    timeoutMs: 90_000,
    isDone: (job) => job.script !== null,
    async run({ job, signal }) {
      const provider = getContentProvider();
      const format = formatOf(job);
      const sceneSeconds = format.kind === 'video' ? Math.max(3, format.targetSeconds - INTRO_SECONDS - OUTRO_SECONDS) : 5;
      const script = await provider.writeScript({
        product: job.product!,
        analysis: job.analysis!,
        format,
        tone: job.options.tone,
        imageCount: job.product!.imageAssetIds.length,
        sceneSeconds,
        signal,
      });
      return { script, provider: provider.name };
    },
  },
  {
    name: 'rendering',
    startMessage: 'Rendering your content',
    progressRange: STEP_PROGRESS.rendering,
    timeoutMs: 5 * 60_000,
    isDone: (_job, hasOutputs) => hasOutputs,
    async run({ job, signal, progress, event, log }) {
      const format = formatOf(job);
      const imagePaths = await sourceImagePaths(job);
      const product = job.product!;
      const script = job.script!;
      const price = formatPrice(product.price, product.currency);
      const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `postcraft-${job.id.slice(0, 8)}-`));
      const started = Date.now();

      try {
        const files: { path: string; kind: 'output_video' | 'output_image' | 'thumbnail'; mime: string; ext: string; durationMs?: number; width: number; height: number }[] = [];
        if (format.kind === 'video') {
          const out = await renderVideo({
            format,
            script,
            title: product.title,
            brand: product.brand,
            price,
            heroIndex: job.analysis?.heroImageIndex ?? 0,
            imagePaths,
            workDir,
            signal,
            onProgress: progress,
          });
          files.push({ path: out.outputPath, kind: 'output_video', mime: 'video/mp4', ext: 'mp4', durationMs: Math.round(out.durationSec * 1000), width: format.width, height: format.height });
          files.push({ path: out.thumbnailPath, kind: 'thumbnail', mime: 'image/jpeg', ext: 'jpg', width: format.width, height: format.height });
        } else {
          const heroPath = imagePaths[(job.analysis?.heroImageIndex ?? 0) % imagePaths.length]!;
          const out = await renderImage({ format, script, brand: product.brand, price, heroPath, workDir });
          files.push({ path: out.outputPath, kind: 'output_image', mime: 'image/png', ext: 'png', width: format.width, height: format.height });
        }
        log.info({ ms: Date.now() - started }, 'render finished');
        await event(`Rendered in ${((Date.now() - started) / 1000).toFixed(1)}s`);

        // Upload every file first, then record them in one transaction: the job either has
        // all of its outputs or none (so the "rendering done" checkpoint is never half true).
        const stored = await Promise.all(
          files.map(async (f) => {
            const key = `jobs/${job.id}/${f.kind.replace('_', '-')}-${randomUUID()}.${f.ext}`;
            const { bytes } = await storage.put(key, await fs.readFile(f.path));
            return { ...f, key, bytes };
          }),
        );
        await db.transaction(async (tx) => {
          for (const f of stored) {
            await tx.insert(assets).values({
              sessionId: job.sessionId,
              jobId: job.id,
              kind: f.kind,
              storageKey: f.key,
              mime: f.mime,
              bytes: f.bytes,
              width: f.width,
              height: f.height,
              durationMs: f.durationMs ?? null,
            });
          }
        });
      } finally {
        await fs.rm(workDir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'finalizing',
    startMessage: 'Verifying output against platform format rules',
    progressRange: STEP_PROGRESS.finalizing,
    timeoutMs: 60_000,
    isDone: () => false,
    async run({ job, signal, event }) {
      const format = formatOf(job);
      const outputs = await db
        .select()
        .from(assets)
        .where(and(eq(assets.jobId, job.id), inArray(assets.kind, ['output_video', 'output_image'])));
      for (const out of outputs) {
        const summary = await verifyOutput(await storage.localPath(out.storageKey), format, signal);
        await event(`Verified: ${summary}`);
      }
    },
  },
];

/** Checks the produced file actually meets the platform format rules. */
async function verifyOutput(filePath: string, format: OutputFormat, signal: AbortSignal): Promise<string> {
  const fail = (what: string) =>
    new AppError('FORMAT_CHECK_FAILED', 'The generated file did not meet the platform format rules.', {
      status: 500,
      internalMessage: what,
    });

  if (format.kind === 'image') {
    const meta = await import('sharp').then((m) => m.default(filePath).metadata());
    if (meta.width !== format.width || meta.height !== format.height) throw fail(`image is ${meta.width}x${meta.height}`);
    return `${meta.width}×${meta.height} ${meta.format?.toUpperCase()} (${format.aspectRatio})`;
  }

  const p = await probe(filePath, signal);
  if (p.width !== format.width || p.height !== format.height) throw fail(`video is ${p.width}x${p.height}`);
  if (p.codec !== 'h264' || p.pixFmt !== 'yuv420p') throw fail(`codec ${p.codec}/${p.pixFmt}`);
  if (!p.durationSec || p.durationSec > format.maxSeconds + 0.5) throw fail(`duration ${p.durationSec}`);
  return `${p.width}×${p.height} (${format.aspectRatio}) H.264, ${p.fps ?? format.fps}fps, ${p.durationSec.toFixed(1)}s`;
}
