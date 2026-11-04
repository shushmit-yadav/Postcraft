import { z } from 'zod';
import { FORMAT_IDS, PLATFORMS, FORMATS } from './formats.js';

/** Job lifecycle. Order matters: it drives the progress timeline in the UI. */
export const JOB_STEPS = ['ingesting', 'analyzing', 'scripting', 'rendering', 'finalizing'] as const;
export type JobStep = (typeof JOB_STEPS)[number];

/** Overall progress (0-100) each step covers. Shared so the UI timeline matches the worker. */
export const STEP_PROGRESS: Record<JobStep, readonly [start: number, end: number]> = {
  ingesting: [0, 20],
  analyzing: [20, 35],
  scripting: [35, 50],
  rendering: [50, 90],
  finalizing: [90, 99],
};

export const JOB_STATUSES = [
  'queued',
  ...JOB_STEPS,
  'awaiting_review',
  'completed',
  'failed',
  'cancelled',
] as const;
export const JobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const TERMINAL_STATUSES: readonly JobStatus[] = ['completed', 'failed', 'cancelled'];
export const isTerminal = (s: JobStatus) => TERMINAL_STATUSES.includes(s);

export const InputTypeSchema = z.enum(['url', 'image', 'video']);
export type InputType = z.infer<typeof InputTypeSchema>;

export const PlatformSchema = z.enum(PLATFORMS);
export const FormatIdSchema = z.enum(FORMAT_IDS);

export const ToneSchema = z.enum(['energetic', 'friendly', 'premium', 'playful']);
export type Tone = z.infer<typeof ToneSchema>;

export const JobOptionsSchema = z.object({
  tone: ToneSchema.default('energetic'),
  /** Pause after the script is written so the user can edit it before rendering. */
  reviewBeforeRender: z.boolean().default(false),
});
export type JobOptions = z.infer<typeof JobOptionsSchema>;

/** POST /api/jobs request body. */
export const CreateJobSchema = z
  .discriminatedUnion('inputType', [
    z.object({
      inputType: z.literal('url'),
      url: z.url({ protocol: /^https?$/ }).max(2048),
    }),
    z.object({ inputType: z.literal('image'), assetId: z.uuid() }),
    z.object({ inputType: z.literal('video'), assetId: z.uuid() }),
  ])
  .and(
    z.object({
      platform: PlatformSchema,
      formatId: FormatIdSchema,
      options: JobOptionsSchema.default({ tone: 'energetic', reviewBeforeRender: false }),
    }),
  )
  .refine((v) => FORMATS[v.formatId].platform === v.platform, {
    message: 'formatId does not belong to the selected platform',
    path: ['formatId'],
  });
export type CreateJobInput = z.infer<typeof CreateJobSchema>;

/** The AI-generated (and user-editable) content plan for a post. */
export const ScriptSchema = z.object({
  hook: z.string().min(1).max(80),
  scenes: z
    .array(
      z.object({
        text: z.string().min(1).max(90),
        imageIndex: z.number().int().min(0),
        durationSec: z.number().min(1.5).max(8),
      }),
    )
    .min(1)
    .max(8),
  cta: z.string().min(1).max(40),
  caption: z.string().min(1).max(2200),
  hashtags: z.array(z.string().regex(/^#?[\p{L}\p{N}_]+$/u)).max(30),
});
export type Script = z.infer<typeof ScriptSchema>;

export const JobEventSchema = z.object({
  id: z.number(),
  step: z.string(),
  level: z.enum(['info', 'warn', 'error']),
  message: z.string(),
  createdAt: z.string(),
});
export type JobEvent = z.infer<typeof JobEventSchema>;

export const JobOutputSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['output_video', 'output_image', 'thumbnail']),
  mime: z.string(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  durationMs: z.number().nullable(),
  bytes: z.number(),
  url: z.string(),
  downloadUrl: z.string(),
});
export type JobOutput = z.infer<typeof JobOutputSchema>;

/** GET /api/jobs/:id response. */
export const JobViewSchema = z.object({
  id: z.uuid(),
  status: JobStatusSchema,
  progress: z.number().min(0).max(100),
  inputType: InputTypeSchema,
  inputUrl: z.string().nullable(),
  platform: PlatformSchema,
  formatId: FormatIdSchema,
  provider: z.enum(['mock', 'claude']).nullable(),
  script: ScriptSchema.nullable(),
  error: z
    .object({ code: z.string(), message: z.string(), retryable: z.boolean() })
    .nullable(),
  attempts: z.number(),
  events: z.array(JobEventSchema),
  outputs: z.array(JobOutputSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
});
export type JobView = z.infer<typeof JobViewSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
