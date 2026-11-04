import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { isProd } from './config.js';

declare module 'fastify' {
  interface FastifyRequest {
    sessionId: string;
  }
}

const COOKIE = 'sid';
const UUID = /^[0-9a-f-]{36}$/;

/**
 * Anonymous sessions: every browser gets a signed, httpOnly cookie with a random id.
 * Jobs and uploads are scoped to it, so one visitor can't read another's content.
 * Real accounts are a later step (see roadmap); this keeps the demo friction-free.
 */
export const sessionPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('sessionId', '');
  app.addHook('onRequest', async (req, reply) => {
    const raw = req.cookies[COOKIE];
    const unsigned = raw ? req.unsignCookie(raw) : null;
    if (unsigned?.valid && unsigned.value && UUID.test(unsigned.value)) {
      req.sessionId = unsigned.value;
      return;
    }
    req.sessionId = randomUUID();
    reply.setCookie(COOKIE, req.sessionId, {
      signed: true,
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
  });
});
