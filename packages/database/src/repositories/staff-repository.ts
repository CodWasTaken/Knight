import type { ActionId, ActionPolicies } from '@knight/contracts';
import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '../client.js';
import { staffAssignments, staffProfiles, staffProfileVersions } from '../schema/index.js';

export type StaffProfileRecord = Readonly<{
  id: string;
  guildId: string;
  name: string;
  discordRoleId: string;
  rank: number;
  enabled: boolean;
  currentVersionId: string | null;
}>;

export type StaffProfileVersionRecord = Readonly<{
  id: string;
  guildId: string;
  profileId: string;
  version: number;
  permissions: readonly ActionId[];
  actionPolicies: ActionPolicies;
  profileName?: string;
  discordRoleId?: string;
  rank?: number;
}>;

export class StaffRepository {
  public constructor(private readonly database: Database) {}

  public async createProfile(input: {
    guildId: string;
    name: string;
    discordRoleId: string;
    rank: number;
  }): Promise<StaffProfileRecord> {
    const [profile] = await this.database.db.insert(staffProfiles).values(input).returning();

    if (!profile) throw new Error('Failed to create staff profile');
    return profile;
  }

  public async createProfileVersion(input: {
    guildId: string;
    profileId: string;
    permissions: readonly ActionId[];
    actionPolicies: ActionPolicies;
    createdBy?: string;
  }): Promise<StaffProfileVersionRecord> {
    return this.database.db.transaction(async (tx) => {
      const [profile] = await tx
        .select({ id: staffProfiles.id })
        .from(staffProfiles)
        .where(and(eq(staffProfiles.guildId, input.guildId), eq(staffProfiles.id, input.profileId)))
        .for('update')
        .limit(1);

      if (!profile) throw new Error('Staff profile not found in guild');

      const [latest] = await tx
        .select({ version: staffProfileVersions.version })
        .from(staffProfileVersions)
        .where(
          and(
            eq(staffProfileVersions.guildId, input.guildId),
            eq(staffProfileVersions.profileId, input.profileId),
          ),
        )
        .orderBy(desc(staffProfileVersions.version))
        .limit(1);

      const nextVersion = (latest?.version ?? 0) + 1;
      const [version] = await tx
        .insert(staffProfileVersions)
        .values({
          guildId: input.guildId,
          profileId: input.profileId,
          version: nextVersion,
          permissions: [...input.permissions],
          actionPolicies: input.actionPolicies,
          createdBy: input.createdBy ?? null,
        })
        .returning();

      if (!version) throw new Error('Failed to create staff profile version');

      await tx
        .update(staffProfiles)
        .set({ currentVersionId: version.id, updatedAt: new Date() })
        .where(
          and(eq(staffProfiles.guildId, input.guildId), eq(staffProfiles.id, input.profileId)),
        );

      return version;
    });
  }

  public async assign(input: {
    guildId: string;
    userId: string;
    profileId: string;
    actorUserId: string;
  }): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      const [profile] = await tx
        .select({ id: staffProfiles.id })
        .from(staffProfiles)
        .where(
          and(
            eq(staffProfiles.guildId, input.guildId),
            eq(staffProfiles.id, input.profileId),
            eq(staffProfiles.enabled, true),
          ),
        )
        .limit(1);

      if (!profile) throw new Error('Staff profile not found in guild');

      await tx
        .update(staffAssignments)
        .set({ active: false, endedAt: new Date() })
        .where(
          and(
            eq(staffAssignments.guildId, input.guildId),
            eq(staffAssignments.userId, input.userId),
            eq(staffAssignments.active, true),
          ),
        );

      await tx.insert(staffAssignments).values({
        guildId: input.guildId,
        userId: input.userId,
        profileId: input.profileId,
        assignedBy: input.actorUserId,
      });
    });
  }

  public async deactivateAssignment(input: { guildId: string; userId: string }): Promise<void> {
    await this.database.db
      .update(staffAssignments)
      .set({ active: false, endedAt: new Date() })
      .where(
        and(
          eq(staffAssignments.guildId, input.guildId),
          eq(staffAssignments.userId, input.userId),
          eq(staffAssignments.active, true),
        ),
      );
  }

  public async getEffectiveProfile(
    guildId: string,
    userId: string,
  ): Promise<StaffProfileVersionRecord | null> {
    const [profile] = await this.database.db
      .select({
        id: staffProfileVersions.id,
        guildId: staffProfileVersions.guildId,
        profileId: staffProfileVersions.profileId,
        version: staffProfileVersions.version,
        permissions: staffProfileVersions.permissions,
        actionPolicies: staffProfileVersions.actionPolicies,
        profileName: staffProfiles.name,
        discordRoleId: staffProfiles.discordRoleId,
        rank: staffProfiles.rank,
      })
      .from(staffAssignments)
      .innerJoin(
        staffProfiles,
        and(
          eq(staffAssignments.profileId, staffProfiles.id),
          eq(staffAssignments.guildId, staffProfiles.guildId),
        ),
      )
      .innerJoin(
        staffProfileVersions,
        and(
          eq(staffProfiles.currentVersionId, staffProfileVersions.id),
          eq(staffProfiles.guildId, staffProfileVersions.guildId),
        ),
      )
      .where(
        and(
          eq(staffAssignments.guildId, guildId),
          eq(staffAssignments.userId, userId),
          eq(staffAssignments.active, true),
          eq(staffProfiles.enabled, true),
        ),
      )
      .limit(1);

    return profile ?? null;
  }

  public async listProfiles(guildId: string): Promise<StaffProfileRecord[]> {
    return this.database.db
      .select({
        id: staffProfiles.id,
        guildId: staffProfiles.guildId,
        name: staffProfiles.name,
        discordRoleId: staffProfiles.discordRoleId,
        rank: staffProfiles.rank,
        enabled: staffProfiles.enabled,
        currentVersionId: staffProfiles.currentVersionId,
      })
      .from(staffProfiles)
      .where(eq(staffProfiles.guildId, guildId));
  }
}
