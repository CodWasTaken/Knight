CREATE TABLE "guild_firewall_settings" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"bot_mode" text DEFAULT 'OBSERVE' NOT NULL,
	"webhook_mode" text DEFAULT 'OBSERVE' NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guild_firewall_bot_mode_check" CHECK ("guild_firewall_settings"."bot_mode" in ('OBSERVE', 'ALERT', 'ENFORCE')),
	CONSTRAINT "guild_firewall_webhook_mode_check" CHECK ("guild_firewall_settings"."webhook_mode" in ('OBSERVE', 'ALERT', 'ENFORCE'))
);
--> statement-breakpoint
CREATE TABLE "known_bots" (
	"guild_id" text NOT NULL,
	"bot_user_id" text NOT NULL,
	"trust_state" text DEFAULT 'UNKNOWN' NOT NULL,
	"invited_by_user_id" text,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "known_bots_guild_id_bot_user_id_pk" PRIMARY KEY("guild_id","bot_user_id"),
	CONSTRAINT "known_bots_trust_check" CHECK ("known_bots"."trust_state" in ('TRUSTED', 'APPROVED', 'UNKNOWN', 'BLOCKED'))
);
--> statement-breakpoint
CREATE TABLE "known_webhooks" (
	"guild_id" text NOT NULL,
	"webhook_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"trust_state" text DEFAULT 'UNKNOWN' NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "known_webhooks_guild_id_webhook_id_pk" PRIMARY KEY("guild_id","webhook_id"),
	CONSTRAINT "known_webhooks_trust_check" CHECK ("known_webhooks"."trust_state" in ('TRUSTED', 'APPROVED', 'UNKNOWN', 'BLOCKED'))
);
--> statement-breakpoint
CREATE TABLE "protected_resources" (
	"guild_id" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"level" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "protected_resources_guild_id_resource_type_resource_id_pk" PRIMARY KEY("guild_id","resource_type","resource_id"),
	CONSTRAINT "protected_resources_type_check" CHECK ("protected_resources"."resource_type" in ('USER', 'ROLE', 'CHANNEL')),
	CONSTRAINT "protected_resources_level_check" CHECK ("protected_resources"."level" in ('IMPORTANT', 'CRITICAL', 'IMMUTABLE'))
);
--> statement-breakpoint
CREATE TABLE "security_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"source" text NOT NULL,
	"action" text NOT NULL,
	"actor_user_id" text,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"audit_log_id" text,
	"execution_id" text,
	"incident_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"actor_key" text NOT NULL,
	"severity" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"summary" text NOT NULL,
	"event_count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_incidents_status_check" CHECK ("security_incidents"."status" in ('ACTIVE', 'CONTAINED', 'RESOLVED')),
	CONSTRAINT "security_incidents_event_count_check" CHECK ("security_incidents"."event_count" > 0)
);
--> statement-breakpoint
ALTER TABLE "guild_firewall_settings" ADD CONSTRAINT "guild_firewall_settings_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "known_bots" ADD CONSTRAINT "known_bots_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "known_webhooks" ADD CONSTRAINT "known_webhooks_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protected_resources" ADD CONSTRAINT "protected_resources_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_incident_id_security_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."security_incidents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_incidents" ADD CONSTRAINT "security_incidents_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "security_events_guild_occurred_idx" ON "security_events" USING btree ("guild_id","occurred_at");--> statement-breakpoint
CREATE INDEX "security_events_incident_idx" ON "security_events" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "security_incidents_guild_actor_idx" ON "security_incidents" USING btree ("guild_id","actor_key","last_seen_at");