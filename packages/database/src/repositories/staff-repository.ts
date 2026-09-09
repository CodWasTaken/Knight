import type { ActionId, ActionPolicies } from '@knight/contracts';
import type { Database } from '../client.js';

export type StaffProfileRecord = Readonly<{ id: string }>;
export type StaffProfileVersionRecord = Readonly<{ id: string; version: number; permissions: readonly ActionId[] }>;

export class StaffRepository {
  public constructor(private readonly database: Database) {
    void this.database;
  }

  public async createProfile(_input: { guildId: string; name: string; discordRoleId: string; rank: number }): Promise<StaffProfileRecord> {
    throw new Error('StaffRepository not implemented');
  }

  public async createProfileVersion(_input: { guildId: string; profileId: string; permissions: readonly ActionId[]; actionPolicies: ActionPolicies; createdBy?: string }): Promise<StaffProfileVersionRecord> {
    throw new Error('StaffRepository not implemented');
  }

  public async assign(_input: { guildId: string; userId: string; profileId: string; actorUserId: string }): Promise<void> {
    throw new Error('StaffRepository not implemented');
  }

  public async getEffectiveProfile(_guildId: string, _userId: string): Promise<StaffProfileVersionRecord | null> {
    throw new Error('StaffRepository not implemented');
  }
}
