import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { config } from './config.js';
import { AppError } from './lib/errors.js';
import { loggerOptions } from './lib/logger.js';
import { sessionPlugin } from './session.js';
import { jobRoutes } from './routes/jobs.js';
import { formatRoutes } from './routes/formats.js';
import { fileRoutes } from './routes/files.js';
import { healthRoutes } from './routes/health.js';
import { uploadRoutes } from './routes/uploads.js';

export async function buildApp() {
  const app = Fastify({
    logger: loggerOptions,
    trustProxy: true,
    bodyLimit: 1024 * 1024, // JSON bodies; uploads use multipart with their own limits
    genReqId: () => crypto.randomUUID(),
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  });
  await app.register(cookie, { secret: config.APP_SECRET });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(multipart);
  await app.register(sessionPlugin);

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: err.validation },
      });
    }
    if (err instanceof AppError) {
      if (err.status >= 500) req.log.error({ err }, err.message);
      return reply
        .code(err.status)
        .send({ error: { code: err.code, message: err.userMessage, details: err.details } });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: { code: err.code ?? 'BAD_REQUEST', message: err.message } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply
      .code(500)
      .send({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } });
  });

  await app.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(formatRoutes);
      await api.register(jobRoutes);
      await api.register(fileRoutes);
      await api.register(uploadRoutes);
      api.setNotFoundHandler((_req, reply) =>
        reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } }),
      );
    },
    { prefix: '/api' },
  );

  // In production the API also serves the built SPA, so UI and API share one origin (no CORS).
  const webDist = config.WEB_DIST_DIR ? path.resolve(config.WEB_DIST_DIR) : null;
  if (webDist && fs.existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) =>
      req.method === 'GET' ? reply.sendFile('index.html') : reply.code(404).send(),
    );
  } else {
    app.setNotFoundHandler((_req, reply) =>
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } }),
    );
  }

  return app;
}
