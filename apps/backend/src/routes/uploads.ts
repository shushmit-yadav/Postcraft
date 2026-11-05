import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/client.js';
import { assets } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { normalizeImage } from '../media/images.js';
import { storage } from '../storage/index.js';

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/**
 * POST /api/uploads: one product image as multipart/form-data (field `file`).
 * The content is trusted only after normalizeImage: magic bytes, minimum size,
 * pixel limit, then a re-encode, so we only ever store our own encode.
 */
export const uploadRoutes: FastifyPluginAsync = async (app) => {
  app.post('/uploads', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!req.isMultipart()) throw new AppError('BAD_REQUEST', 'Send the image as multipart/form-data.');
    const file = await req.file({ limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 0 } });
    if (!file) throw new AppError('NO_FILE', 'No file was uploaded.');

    let input: Buffer;
    try {
      input = await file.toBuffer();
    } catch (err) {
      if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
        throw new AppError('FILE_TOO_LARGE', 'The image is larger than 15 MB.', { status: 413 });
      }
      throw err;
    }

    const img = await normalizeImage(input);
    const key = `uploads/${randomUUID()}.${img.ext}`;
    await storage.put(key, img.buffer);
    const [row] = await db
      .insert(assets)
      .values({
        sessionId: req.sessionId,
        kind: 'source_image',
        storageKey: key,
        mime: img.mime,
        bytes: img.buffer.length,
        width: img.width,
        height: img.height,
        sha256: img.sha256,
      })
      .returning({ id: assets.id });

    return reply.code(201).send({ assetId: row!.id, width: img.width, height: img.height });
  });
};
