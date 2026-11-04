import type { FastifyPluginAsync } from 'fastify';
import { FORMATS, PLATFORMS } from '@app/shared';

export const formatRoutes: FastifyPluginAsync = async (app) => {
  app.get('/formats', async (_req, reply) => {
    reply.header('cache-control', 'public, max-age=300');
    return { platforms: PLATFORMS, formats: Object.values(FORMATS) };
  });
};
