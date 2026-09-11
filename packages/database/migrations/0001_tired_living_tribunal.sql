CREATE TABLE "member_warnings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"target_user_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"reason" text NOT NULL,
	"actor_profile_version_id" uuid,
	"dm_delivery_status" text DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff_profile_versions" ADD COLUMN "profile_name" text;--> statement-breakpoint
ALTER TABLE "staff_profile_versions" ADD COLUMN "discord_role_id" text;--> statement-breakpoint
ALTER TABLE "staff_profile_versions" ADD COLUMN "rank" integer;--> statement-breakpoint
UPDATE "staff_profile_versions" AS v
SET "profile_name" = p."name", "discord_role_id" = p."discord_role_id", "rank" = p."rank"
FROM "staff_profiles" AS p
WHERE v."profile_id" = p."id" AND v."guild_id" = p."guild_id";--> statement-breakpoint
ALTER TABLE "staff_profile_versions" ALTER COLUMN "profile_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_profile_versions" ALTER COLUMN "discord_role_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_profile_versions" ALTER COLUMN "rank" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "member_warnings" ADD CONSTRAINT "member_warnings_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_warnings" ADD CONSTRAINT "member_warnings_actor_profile_version_id_staff_profile_versions_id_fk" FOREIGN KEY ("actor_profile_version_id") REFERENCES "public"."staff_profile_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_warnings_guild_target_created_idx" ON "member_warnings" USING btree ("guild_id","target_user_id","created_at");--> statement-breakpoint
ALTER TABLE "staff_profile_versions" ADD CONSTRAINT "staff_profile_versions_rank_check" CHECK ("staff_profile_versions"."rank" >= 0);
