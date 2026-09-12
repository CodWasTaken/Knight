import type { Database } from '@knight/database/client';
import { BackupRepository } from '@knight/database';
import { GuildRepository } from '@knight/database/repositories/guild-repository';
import { SecurityLedgerRepository } from '@knight/database/repositories/security-ledger-repository';
import { SecurityManagerRepository } from '@knight/database/repositories/security-manager-repository';
import { SecurityRepository } from '@knight/database/repositories/security-repository';
import { StaffRepository } from '@knight/database/repositories/staff-repository';

export type WebRepositories = Readonly<{
  backups: BackupRepository;
  guilds: GuildRepository;
  managers: SecurityManagerRepository;
  securityLedger: SecurityLedgerRepository;
  security: SecurityRepository;
  staff: StaffRepository;
}>;

export function createWebRepositories(database: Database): WebRepositories {
  return {
    backups: new BackupRepository(database),
    guilds: new GuildRepository(database),
    managers: new SecurityManagerRepository(database),
    securityLedger: new SecurityLedgerRepository(database),
    security: new SecurityRepository(database),
    staff: new StaffRepository(database),
  } as const;
}
