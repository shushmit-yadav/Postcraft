import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import { storage } from '../storage/index.js';
import { verifyFileSignature } from '../storage/signing.js';

const MIME_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/** Serves stored files behind short-lived signed URLs, with HTTP Range support for video seeking. */
export const fileRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/files/*',
    {
      schema: {
        params: z.object({ '*': z.string().min(1).max(300) }),
        querystring: z.object({
          exp: z.coerce.number(),
          sig: z.string().min(10).max(100),
          dl: z
            .string()
            .max(120)
            .regex(/^[\w.-]+$/)
            .optional(),
        }),
      },
    },
    async (req, reply) => {
      const key = req.params['*'];
      const { exp, sig, dl } = req.query;
      if (!verifyFileSignature(key, exp, sig, dl ?? '')) {
        throw new AppError('LINK_EXPIRED', 'This link is invalid or has expired', { status: 403 });
      }
      const stat = await storage.stat(key);
      if (!stat) throw new AppError('NOT_FOUND', 'File not found', { status: 404 });

      const ext = key.split('.').pop() ?? '';
      reply
        .header('content-type', MIME_BY_EXT[ext] ?? 'application/octet-stream')
        .header('accept-ranges', 'bytes')
        .header('cache-control', 'private, max-age=3600')
        .header('x-content-type-options', 'nosniff');
      if (dl) reply.header('content-disposition', `attachment; filename="${dl}"`);

      const range = parseRange(req.headers.range, stat.bytes);
      if (range === 'invalid') {
        return reply.code(416).header('content-range', `bytes */${stat.bytes}`).send();
      }
      if (range) {
        return reply
          .code(206)
          .header('content-range', `bytes ${range.start}-${range.end}/${stat.bytes}`)
          .header('content-length', range.end - range.start + 1)
          .send(storage.read(key, range));
      }
      return reply.header('content-length', stat.bytes).send(storage.read(key));
    },
  );
};

function parseRange(header: string | undefined, size: number) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return 'invalid' as const;
  let start: number;
  let end: number;
  if (!m[1]) {
    // Suffix range: last N bytes.
    start = Math.max(size - Number(m[2]), 0);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (start > end || start >= size) return 'invalid' as const;
  return { start, end };
}
