CREATE TABLE "guild_factory_reset_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guild_factory_reset_jobs_status_check" CHECK ("guild_factory_reset_jobs"."status" in ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED'))
);
--> statement-breakpoint
ALTER TABLE "guarded_categories" ADD COLUMN "migration_id" uuid;--> statement-breakpoint
ALTER TABLE "guarded_categories" ADD COLUMN "snapshot_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "guarded_categories" SET "snapshot_required" = true WHERE "enabled" = true;--> statement-breakpoint
ALTER TABLE "guild_logging_settings" ADD COLUMN "message_channel_id" text;--> statement-breakpoint
ALTER TABLE "guild_logging_settings" ADD COLUMN "voice_channel_id" text;--> statement-breakpoint
ALTER TABLE "guild_logging_settings" ADD COLUMN "store_deleted_message_content" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "guild_factory_reset_jobs" ADD CONSTRAINT "guild_factory_reset_jobs_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guild_factory_reset_jobs_status_created_idx" ON "guild_factory_reset_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "guild_factory_reset_jobs_guild_created_idx" ON "guild_factory_reset_jobs" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "guild_factory_reset_jobs_one_active_uq" ON "guild_factory_reset_jobs" USING btree ("guild_id") WHERE "guild_factory_reset_jobs"."status" in ('PENDING', 'RUNNING');
