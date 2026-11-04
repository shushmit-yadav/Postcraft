import type { Readable } from 'node:stream';

/**
 * Storage abstraction. Local disk is used for local runs; an S3/R2 adapter
 * implementing the same interface is the production path (see ADR-002).
 */
export interface StorageProvider {
  put(key: string, body: Buffer | Readable): Promise<{ bytes: number }>;
  /** Byte range is inclusive on both ends, mirroring HTTP Range semantics. */
  read(key: string, range?: { start: number; end: number }): Readable;
  stat(key: string): Promise<{ bytes: number } | null>;
  delete(key: string): Promise<void>;
  /** A local filesystem path for tools like FFmpeg. Remote providers download to a temp file. */
  localPath(key: string): Promise<string>;
}

/** Keys are generated server-side; this guard also blocks path traversal if one ever isn't. */
const KEY_PATTERN = /^(?:[a-z0-9-]+\/)*[a-z0-9-]+\.[a-z0-9]{2,5}$/;

export function assertValidKey(key: string) {
  if (!KEY_PATTERN.test(key) || key.includes('..')) throw new Error(`Invalid storage key: ${key}`);
}
