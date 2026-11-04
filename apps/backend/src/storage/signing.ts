import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

const DEFAULT_TTL_SECONDS = 60 * 60; // 1 hour

function sign(payload: string) {
  return createHmac('sha256', config.APP_SECRET).update(payload).digest('base64url');
}

const payloadFor = (key: string, exp: number, download: string) => `${key}\n${exp}\n${download}`;

/**
 * Short-lived signed URLs for stored files (same idea as S3 presigned URLs).
 * Anyone with the link can fetch the file until it expires, and nothing else.
 */
export function signedFileUrl(key: string, opts: { download?: string; ttlSeconds?: number } = {}) {
  const exp = Math.floor(Date.now() / 1000) + (opts.ttlSeconds ?? DEFAULT_TTL_SECONDS);
  const download = opts.download ?? '';
  const params = new URLSearchParams({ exp: String(exp), sig: sign(payloadFor(key, exp, download)) });
  if (download) params.set('dl', download);
  return `/api/files/${key}?${params.toString()}`;
}

export function fileUrls(key: string, downloadName: string) {
  return { url: signedFileUrl(key), downloadUrl: signedFileUrl(key, { download: downloadName }) };
}

export function verifyFileSignature(key: string, exp: number, sig: string, download = ''): boolean {
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(sign(payloadFor(key, exp, download)));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
