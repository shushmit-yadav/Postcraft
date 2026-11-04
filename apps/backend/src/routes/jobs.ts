import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CreateJobSchema } from '@app/shared';
import { cancelJob, createJob, getJobView, retryJob } from '../jobs/service.js';

const JobParams = z.object({ id: z.uuid() });

export const jobRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/jobs',
    {
      schema: {
        body: CreateJobSchema,
        headers: z.object({ 'idempotency-key': z.string().min(8).max(100).optional() }),
      },
      // Generation is expensive: tighter limit than the global one.
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { jobId, created } = await createJob(
        req.sessionId,
        req.body,
        req.headers['idempotency-key'],
      );
      return reply.code(created ? 202 : 200).send({ jobId });
    },
  );

  app.get('/jobs/:id', { schema: { params: JobParams } }, async (req) =>
    getJobView(req.params.id, req.sessionId),
  );

  app.post('/jobs/:id/retry', { schema: { params: JobParams } }, async (req, reply) => {
    await retryJob(req.params.id, req.sessionId);
    return reply.code(202).send({ jobId: req.params.id });
  });

  app.post('/jobs/:id/cancel', { schema: { params: JobParams } }, async (req) => {
    await cancelJob(req.params.id, req.sessionId);
    return { jobId: req.params.id };
  });
};
