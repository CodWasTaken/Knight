CREATE TABLE "guilds" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"mode" text DEFAULT 'OBSERVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guilds_mode_check" CHECK ("guilds"."mode" in ('OBSERVE', 'TEST', 'GUARDED'))
);
--> statement-breakpoint
CREATE TABLE "setup_states" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"step" text DEFAULT 'WELCOME' NOT NULL,
	"completed_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_managers" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"granted_by" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_managers_guild_id_user_id_pk" PRIMARY KEY("guild_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "staff_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"profile_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sync_status" text DEFAULT 'PENDING' NOT NULL,
	"assigned_by" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "staff_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_profile_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"profile_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"action_policies" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_profile_versions_version_check" CHECK ("staff_profile_versions"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "staff_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"name" text NOT NULL,
	"discord_role_id" text NOT NULL,
	"rank" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"current_version_id" uuid,
	"sync_mode" text DEFAULT 'MANAGED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_profiles_rank_check" CHECK ("staff_profiles"."rank" >= 0)
);
--> statement-breakpoint
CREATE TABLE "temporary_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guarded_categories" (
	"guild_id" text NOT NULL,
	"category" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guarded_categories_guild_id_category_pk" PRIMARY KEY("guild_id","category")
);
--> statement-breakpoint
CREATE TABLE "policy_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"action" text NOT NULL,
	"target_id" text,
	"decision" text NOT NULL,
	"code" text NOT NULL,
	"profile_version_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permission_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"migration_id" uuid NOT NULL,
	"role_id" text NOT NULL,
	"permissions" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"email_verified" timestamp with time zone,
	"image" text
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "setup_states" ADD CONSTRAINT "setup_states_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_managers" ADD CONSTRAINT "security_managers_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_profile_id_staff_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."staff_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_overrides" ADD CONSTRAINT "staff_overrides_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_profile_versions" ADD CONSTRAINT "staff_profile_versions_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_profile_versions" ADD CONSTRAINT "staff_profile_versions_profile_id_staff_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."staff_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temporary_access" ADD CONSTRAINT "temporary_access_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guarded_categories" ADD CONSTRAINT "guarded_categories_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_decisions" ADD CONSTRAINT "policy_decisions_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_decisions" ADD CONSTRAINT "policy_decisions_profile_version_id_staff_profile_versions_id_fk" FOREIGN KEY ("profile_version_id") REFERENCES "public"."staff_profile_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permission_snapshots" ADD CONSTRAINT "role_permission_snapshots_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_assignments_active_user_uq" ON "staff_assignments" USING btree ("guild_id","user_id") WHERE "staff_assignments"."active" = true;--> statement-breakpoint
CREATE INDEX "staff_assignments_guild_profile_idx" ON "staff_assignments" USING btree ("guild_id","profile_id");--> statement-breakpoint
CREATE INDEX "staff_overrides_guild_user_idx" ON "staff_overrides" USING btree ("guild_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_profile_versions_profile_version_uq" ON "staff_profile_versions" USING btree ("profile_id","version");--> statement-breakpoint
CREATE INDEX "staff_profile_versions_guild_profile_idx" ON "staff_profile_versions" USING btree ("guild_id","profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_profiles_guild_name_uq" ON "staff_profiles" USING btree ("guild_id","name");--> statement-breakpoint
CREATE INDEX "staff_profiles_guild_role_idx" ON "staff_profiles" USING btree ("guild_id","discord_role_id");--> statement-breakpoint
CREATE INDEX "temporary_access_guild_user_idx" ON "temporary_access" USING btree ("guild_id","user_id");--> statement-breakpoint
CREATE INDEX "policy_decisions_guild_created_idx" ON "policy_decisions" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE INDEX "policy_decisions_actor_action_idx" ON "policy_decisions" USING btree ("guild_id","actor_user_id","action");--> statement-breakpoint
CREATE INDEX "role_permission_snapshots_guild_migration_idx" ON "role_permission_snapshots" USING btree ("guild_id","migration_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");