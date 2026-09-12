CREATE TABLE "guild_security_state" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'NORMAL' NOT NULL,
	"locked_scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason" text NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guild_security_state_mode_check" CHECK ("guild_security_state"."mode" in ('NORMAL', 'LOCKDOWN', 'PANIC'))
);
--> statement-breakpoint
ALTER TABLE "guild_security_state" ADD CONSTRAINT "guild_security_state_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;