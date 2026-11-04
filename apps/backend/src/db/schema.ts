import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { JOB_STATUSES, type JobOptions, type Script } from '@app/shared';

export const jobStatusEnum = pgEnum('job_status', JOB_STATUSES);
export const inputTypeEnum = pgEnum('input_type', ['url', 'image', 'video']);
export const assetKindEnum = pgEnum('asset_kind', [
  'source_image',
  'source_video',
  'output_video',
  'output_image',
  'thumbnail',
]);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** Product facts gathered by the ingest step (scraped page or uploaded file). */
export interface ProductData {
  title: string;
  description?: string;
  brand?: string;
  price?: string;
  currency?: string;
  category?: string;
  sourceUrl?: string;
  /** Asset ids of the product images saved to storage, best first. */
  imageAssetIds: string[];
}

/** Marketing analysis produced by the analyze step. */
export interface AnalysisData {
  category: string;
  sellingPoints: string[];
  audience: string;
  heroImageIndex: number;
}

export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: text('session_id').notNull(),
    jobId: uuid('job_id'),
    kind: assetKindEnum('kind').notNull(),
    storageKey: text('storage_key').notNull().unique(),
    mime: text('mime').notNull(),
    bytes: bigint('bytes', { mode: 'number' }).notNull(),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('duration_ms'),
    sha256: text('sha256'),
    ...timestamps,
  },
  (t) => [index('assets_job_idx').on(t.jobId), index('assets_session_idx').on(t.sessionId)],
);

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: text('session_id').notNull(),
    status: jobStatusEnum('status').notNull().default('queued'),
    progress: integer('progress').notNull().default(0),
    inputType: inputTypeEnum('input_type').notNull(),
    inputUrl: text('input_url'),
    inputAssetId: uuid('input_asset_id').references(() => assets.id),
    platform: text('platform').notNull(),
    formatId: text('format_id').notNull(),
    options: jsonb('options').$type<JobOptions>().notNull(),
    // Step checkpoints: a non-null value means the step finished, so a retry skips it.
    product: jsonb('product').$type<ProductData>(),
    analysis: jsonb('analysis').$type<AnalysisData>(),
    script: jsonb('script').$type<Script>(),
    /** Set when the user approves the script in review mode. */
    scriptApprovedAt: timestamp('script_approved_at', { withTimezone: true }),
    provider: text('provider').$type<'mock' | 'claude'>(),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    errorRetryable: boolean('error_retryable'),
    attempts: integer('attempts').notNull().default(0),
    idempotencyKey: text('idempotency_key'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('jobs_session_idx').on(t.sessionId, t.createdAt),
    index('jobs_status_updated_idx').on(t.status, t.updatedAt),
    uniqueIndex('jobs_idempotency_idx').on(t.sessionId, t.idempotencyKey),
  ],
);

export const jobEvents = pgTable(
  'job_events',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    step: text('step').notNull(),
    level: text('level').$type<'info' | 'warn' | 'error'>().notNull().default('info'),
    message: text('message').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('job_events_job_idx').on(t.jobId, t.id)],
);

/** Workers upsert a row every few seconds so the API can tell if any worker is alive. */
export const workerHeartbeats = pgTable('worker_heartbeats', {
  workerId: text('worker_id').primaryKey(),
  hostname: text('hostname').notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
});

export type JobRow = typeof jobs.$inferSelect;
export type AssetRow = typeof assets.$inferSelect;
