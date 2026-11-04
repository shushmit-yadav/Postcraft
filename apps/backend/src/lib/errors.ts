/**
 * Application error with a stable machine-readable code.
 *
 * - `status`: HTTP status when the error reaches the API boundary.
 * - `retryable`: the pipeline retries these (network blips, provider 5xx/429).
 *   Non-retryable errors fail the job immediately with a user-facing message.
 * - `userMessage`: what the UI shows. Internal details stay in logs.
 */
export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly userMessage: string;
  readonly details?: unknown;

  constructor(
    code: string,
    userMessage: string,
    opts: { status?: number; retryable?: boolean; cause?: unknown; details?: unknown; internalMessage?: string } = {},
  ) {
    super(opts.internalMessage ?? userMessage, { cause: opts.cause });
    this.name = 'AppError';
    this.code = code;
    this.userMessage = userMessage;
    this.status = opts.status ?? 400;
    this.retryable = opts.retryable ?? false;
    this.details = opts.details;
  }
}

export const notFound = (what: string) =>
  new AppError('NOT_FOUND', `${what} not found`, { status: 404 });

export const conflict = (message: string) => new AppError('CONFLICT', message, { status: 409 });

/** Wraps unknown errors from the pipeline into an AppError, defaulting to retryable. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Error && err.name === 'TimeoutError') {
    return new AppError('STEP_TIMEOUT', 'A processing step took too long.', {
      retryable: true,
      cause: err,
    });
  }
  return new AppError('INTERNAL', 'Something went wrong while generating your content.', {
    status: 500,
    retryable: true,
    cause: err,
    internalMessage: err instanceof Error ? err.message : String(err),
  });
}
