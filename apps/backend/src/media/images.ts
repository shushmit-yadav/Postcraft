import { createHash } from 'node:crypto';
import sharp, { type Metadata, type Sharp } from 'sharp';
import { AppError } from '../lib/errors.js';

sharp.cache(false);
sharp.concurrency(2);

export const MIN_IMAGE_SIDE = 300;
const MAX_INPUT_PIXELS = 40_000_000; // ~40 MP: refuses decompression bombs

export interface NormalizedImage {
  buffer: Buffer;
  mime: 'image/jpeg' | 'image/png';
  ext: 'jpg' | 'png';
  width: number;
  height: number;
  sha256: string;
}

/** Magic-byte sniffing: trust the file's content, never its name or declared type. */
export function sniffImageType(buf: Buffer): 'jpeg' | 'png' | 'webp' | 'avif' | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('ascii', 4, 12) === 'ftypavif') return 'avif';
  return null;
}

/**
 * Decodes and re-encodes an image. Re-encoding strips metadata (EXIF, GPS) and
 * anything smuggled inside the file; we only ever store and serve our own encode.
 * Images with transparency stay PNG (cut-out product shots), others become JPEG.
 */
export async function normalizeImage(input: Buffer, maxSide = 1600): Promise<NormalizedImage> {
  if (!sniffImageType(input)) {
    throw new AppError('INVALID_IMAGE', 'The file is not a supported image (JPEG, PNG, WebP or AVIF).');
  }
  let pipeline: Sharp;
  let meta: Metadata;
  try {
    pipeline = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' }).rotate();
    meta = await pipeline.metadata();
  } catch (err) {
    throw new AppError('INVALID_IMAGE', 'The image could not be read. It may be corrupt.', { cause: err });
  }
  const w = meta.autoOrient?.width ?? meta.width ?? 0;
  const h = meta.autoOrient?.height ?? meta.height ?? 0;
  if (Math.min(w, h) < MIN_IMAGE_SIDE) {
    throw new AppError(
      'IMAGE_TOO_SMALL',
      `The image is too small (${w}×${h}). Use one at least ${MIN_IMAGE_SIDE}px on each side.`,
    );
  }

  const resized = pipeline.resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true });
  const hasAlpha = meta.hasAlpha === true;
  const { data, info } = await (hasAlpha
    ? resized.png({ compressionLevel: 8 })
    : resized.flatten({ background: '#ffffff' }).jpeg({ quality: 88, mozjpeg: true })
  ).toBuffer({ resolveWithObject: true });

  return {
    buffer: data,
    mime: hasAlpha ? 'image/png' : 'image/jpeg',
    ext: hasAlpha ? 'png' : 'jpg',
    width: info.width,
    height: info.height,
    sha256: createHash('sha256').update(data).digest('hex'),
  };
}
