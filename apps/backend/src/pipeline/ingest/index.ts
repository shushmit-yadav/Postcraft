import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { assets, type ProductData } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { MIN_IMAGE_SIDE, normalizeImage } from '../../media/images.js';
import { safeFetch } from '../../security/ssrf.js';
import { storage } from '../../storage/index.js';
import type { StepContext } from '../types.js';
import { parseProductPage } from './parse-product.js';

const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const WANTED_IMAGES = 4;

const BLOCKED_HINT = 'Try uploading a product image instead.';

export async function ingestFromUrl(ctx: StepContext): Promise<ProductData> {
  const { job, signal } = ctx;
  if (!job.inputUrl) throw new AppError('BAD_INPUT', 'This job has no URL.');

  const page = await safeFetch(job.inputUrl, {
    signal,
    maxBytes: MAX_HTML_BYTES,
    timeoutMs: 20_000,
    accept: 'text/html,application/xhtml+xml',
  });
  checkPageResponse(page.status, page.contentType);
  await ctx.progress(0.3);

  const parsed = parseProductPage(page.body.toString('utf8'), page.url.toString());
  ctx.log.info({ source: parsed.source, images: parsed.imageUrls.length, title: parsed.title }, 'parsed product page');
  if (!parsed.title) {
    throw new AppError('NO_PRODUCT_FOUND', `We couldn't find product details on that page. ${BLOCKED_HINT}`);
  }
  if (parsed.imageUrls.length === 0) {
    throw new AppError('NO_PRODUCT_IMAGES', `We found the product but no usable images. ${BLOCKED_HINT}`);
  }
  await ctx.event(`Found "${parsed.title}" with ${parsed.imageUrls.length} candidate image(s)`);

  // Retry safety: drop images saved by an earlier, interrupted attempt.
  await removeSourceImages(job.id);

  const saved: { id: string; aspect: number }[] = [];
  const seen = new Set<string>();
  const skipReasons = new Set<string>();
  for (const imageUrl of parsed.imageUrls) {
    if (saved.length >= WANTED_IMAGES) break;
    signal.throwIfAborted();
    try {
      const res = await safeFetch(imageUrl, { signal, maxBytes: MAX_IMAGE_BYTES, timeoutMs: 15_000, accept: 'image/*' });
      if (res.status !== 200) continue;
      const img = await normalizeImage(res.body);
      if (seen.has(img.sha256)) continue;
      seen.add(img.sha256);

      const key = `jobs/${job.id}/source-${randomUUID()}.${img.ext}`;
      await storage.put(key, img.buffer);
      const [row] = await db
        .insert(assets)
        .values({
          sessionId: job.sessionId,
          jobId: job.id,
          kind: 'source_image',
          storageKey: key,
          mime: img.mime,
          bytes: img.buffer.length,
          width: img.width,
          height: img.height,
          sha256: img.sha256,
        })
        .returning({ id: assets.id });
      saved.push({ id: row!.id, aspect: img.width / img.height });
      await ctx.progress(0.3 + (0.7 * saved.length) / WANTED_IMAGES);
    } catch (err) {
      if (signal.aborted) throw err;
      skipReasons.add(err instanceof AppError ? err.code : 'DOWNLOAD_FAILED');
      // One bad image shouldn't fail the job; skip it and try the next.
      ctx.log.warn({ err: (err as Error).message, imageUrl }, 'skipping product image');
    }
  }

  if (saved.length === 0) {
    const reason =
      skipReasons.size === 1 && skipReasons.has('IMAGE_TOO_SMALL')
        ? `The product images on that page are too small (under ${MIN_IMAGE_SIDE}px) to make good content.`
        : 'None of the product images could be downloaded.';
    throw new AppError('NO_PRODUCT_IMAGES', `${reason} ${BLOCKED_HINT}`);
  }
  // Product shots first: wide banners (often the store's share card with marketing text)
  // and tall strips go last, so the hero image is the product whenever one exists.
  const isBanner = (aspect: number) => aspect > 1.6 || aspect < 0.45;
  const assetIds = [...saved].sort((a, b) => Number(isBanner(a.aspect)) - Number(isBanner(b.aspect))).map((s) => s.id);
  await ctx.event(`Saved ${assetIds.length} product image(s)`);

  return {
    title: parsed.title,
    description: parsed.description ?? undefined,
    brand: parsed.brand ?? undefined,
    price: parsed.price ?? undefined,
    currency: parsed.currency ?? undefined,
    category: parsed.category ?? undefined,
    sourceUrl: page.url.toString(),
    imageAssetIds: assetIds,
  };
}

function checkPageResponse(status: number, contentType: string) {
  if (status === 401 || status === 403 || status === 429 || status === 503) {
    throw new AppError('SITE_BLOCKED', `This website blocks automated access (HTTP ${status}). ${BLOCKED_HINT}`);
  }
  if (status === 404 || status === 410) {
    throw new AppError('PAGE_NOT_FOUND', 'That page does not exist (404). Check the link.');
  }
  if (status >= 500) {
    throw new AppError('SITE_ERROR', `The website returned an error (HTTP ${status}).`, { retryable: true });
  }
  if (status !== 200) {
    throw new AppError('UNEXPECTED_RESPONSE', `The website returned an unexpected response (HTTP ${status}).`);
  }
  if (contentType && !/html|xml/i.test(contentType)) {
    throw new AppError('NOT_A_WEB_PAGE', 'That link is not a web page. Paste the product page URL.');
  }
}

async function removeSourceImages(jobId: string) {
  const old = await db
    .delete(assets)
    .where(and(eq(assets.jobId, jobId), eq(assets.kind, 'source_image')))
    .returning({ key: assets.storageKey });
  await Promise.all(old.map((a) => storage.delete(a.key)));
}
