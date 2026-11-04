import type { CreateJobInput, JobView, OutputFormat, Platform } from '@app/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      credentials: 'same-origin',
      ...init,
      headers: {
        ...(init.body && !(init.body instanceof FormData) ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Is the backend running?');
  }
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = body?.error;
    throw new ApiError(res.status, err?.code ?? 'HTTP_ERROR', err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return body as T;
}

export interface Health {
  status: 'ok' | 'degraded';
  database: boolean;
  workers: number;
  contentProvider: 'mock' | 'claude';
}

export const api = {
  health: () => request<Health>('/health'),
  formats: () => request<{ platforms: Platform[]; formats: OutputFormat[] }>('/formats'),
  createJob: (input: CreateJobInput, idempotencyKey: string) =>
    request<{ jobId: string }>('/jobs', {
      method: 'POST',
      body: JSON.stringify(input),
      headers: { 'idempotency-key': idempotencyKey },
    }),
  getJob: (id: string) => request<JobView>(`/jobs/${id}`),
  retryJob: (id: string) => request<{ jobId: string }>(`/jobs/${id}/retry`, { method: 'POST' }),
  cancelJob: (id: string) => request<{ jobId: string }>(`/jobs/${id}/cancel`, { method: 'POST' }),
};
