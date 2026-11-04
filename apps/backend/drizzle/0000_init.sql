CREATE TYPE "public"."asset_kind" AS ENUM('source_image', 'source_video', 'output_video', 'output_image', 'thumbnail');--> statement-breakpoint
CREATE TYPE "public"."input_type" AS ENUM('url', 'image', 'video');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'ingesting', 'analyzing', 'scripting', 'rendering', 'finalizing', 'awaiting_review', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text NOT NULL,
	"job_id" uuid,
	"kind" "asset_kind" NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" bigint NOT NULL,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "job_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "job_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"job_id" uuid NOT NULL,
	"step" text NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"input_type" "input_type" NOT NULL,
	"input_url" text,
	"input_asset_id" uuid,
	"platform" text NOT NULL,
	"format_id" text NOT NULL,
	"options" jsonb NOT NULL,
	"product" jsonb,
	"analysis" jsonb,
	"script" jsonb,
	"script_approved_at" timestamp with time zone,
	"provider" text,
	"error_code" text,
	"error_message" text,
	"error_retryable" boolean,
	"attempts" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_heartbeats" (
	"worker_id" text PRIMARY KEY NOT NULL,
	"hostname" text NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_input_asset_id_assets_id_fk" FOREIGN KEY ("input_asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_job_idx" ON "assets" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "assets_session_idx" ON "assets" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "job_events_job_idx" ON "job_events" USING btree ("job_id","id");--> statement-breakpoint
CREATE INDEX "jobs_session_idx" ON "jobs" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "jobs_status_updated_idx" ON "jobs" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_idempotency_idx" ON "jobs" USING btree ("session_id","idempotency_key");