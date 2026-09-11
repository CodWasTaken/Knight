CREATE TABLE "guild_logging_settings" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"security_channel_id" text,
	"moderation_channel_id" text,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"severity" text NOT NULL,
	"source" text NOT NULL,
	"action" text NOT NULL,
	"actor_user_id" text,
	"target_id" text,
	"decision_id" text,
	"incident_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"previous_hash" text,
	"entry_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "security_ledger_severity_check" CHECK ("security_ledger"."severity" in ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'))
);
--> statement-breakpoint
ALTER TABLE "guild_logging_settings" ADD CONSTRAINT "guild_logging_settings_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_ledger" ADD CONSTRAINT "security_ledger_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "security_ledger_guild_created_idx" ON "security_ledger" USING btree ("guild_id","created_at","id");--> statement-breakpoint
CREATE INDEX "security_ledger_guild_action_idx" ON "security_ledger" USING btree ("guild_id","action");