import {
  GuildRepository,
  SecurityLedgerRepository,
  SecurityManagerRepository,
  StaffRepository,
  type Database,
} from '@knight/database';
import { describe, expect, it } from 'vitest';
import { createWebRepositories } from './server-dependencies';

describe('createWebRepositories', () => {
  it('uses the durable Knight repositories for web authorization and dashboard state', () => {
    const repositories = createWebRepositories({} as Database);

    expect(repositories.guilds).toBeInstanceOf(GuildRepository);
    expect(repositories.managers).toBeInstanceOf(SecurityManagerRepository);
    expect(repositories.securityLedger).toBeInstanceOf(SecurityLedgerRepository);
    expect(repositories.staff).toBeInstanceOf(StaffRepository);
  });
});
