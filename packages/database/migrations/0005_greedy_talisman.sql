CREATE TABLE "backup_policies" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"archive_channel_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"max_messages_per_channel" integer DEFAULT 1000 NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backup_policies_mode_check" CHECK ("backup_policies"."mode" in ('DISABLED', 'MANUAL', 'DAILY')),
	CONSTRAINT "backup_policies_message_cap_check" CHECK ("backup_policies"."max_messages_per_channel" between 1 and 10000)
);
--> statement-breakpoint
CREATE TABLE "backups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"relative_path" text,
	"sha256" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backups_status_check" CHECK ("backups"."status" in ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED'))
);
--> statement-breakpoint
CREATE TABLE "recovery_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"backup_id" uuid NOT NULL,
	"requested_by" text NOT NULL,
	"phase" text DEFAULT 'PREVIEW' NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"preview" jsonb,
	"checkpoint" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recovery_jobs_phase_check" CHECK ("recovery_jobs"."phase" in ('PREVIEW', 'EXECUTION')),
	CONSTRAINT "recovery_jobs_status_check" CHECK ("recovery_jobs"."status" in ('PENDING', 'RUNNING', 'PREVIEW_READY', 'COMPLETED', 'FAILED'))
);
--> statement-breakpoint
ALTER TABLE "backup_policies" ADD CONSTRAINT "backup_policies_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backups" ADD CONSTRAINT "backups_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_jobs" ADD CONSTRAINT "recovery_jobs_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_jobs" ADD CONSTRAINT "recovery_jobs_backup_id_backups_id_fk" FOREIGN KEY ("backup_id") REFERENCES "public"."backups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backups_status_created_idx" ON "backups" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "backups_guild_created_idx" ON "backups" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE INDEX "recovery_jobs_status_created_idx" ON "recovery_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "recovery_jobs_guild_created_idx" ON "recovery_jobs" USING btree ("guild_id","created_at");