import type { Database } from '@knight/database/client';
import { GuildRepository } from '@knight/database/repositories/guild-repository';
import { SecurityLedgerRepository } from '@knight/database/repositories/security-ledger-repository';
import { SecurityManagerRepository } from '@knight/database/repositories/security-manager-repository';
import { StaffRepository } from '@knight/database/repositories/staff-repository';

export type WebRepositories = Readonly<{
  guilds: GuildRepository;
  managers: SecurityManagerRepository;
  securityLedger: SecurityLedgerRepository;
  staff: StaffRepository;
}>;

export function createWebRepositories(database: Database): WebRepositories {
  return {
    guilds: new GuildRepository(database),
    managers: new SecurityManagerRepository(database),
    securityLedger: new SecurityLedgerRepository(database),
    staff: new StaffRepository(database),
  } as const;
}
