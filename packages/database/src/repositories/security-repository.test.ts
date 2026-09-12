import { ProtectionLevel } from '@knight/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDatabase, createDatabase } from '../client.js';
import { applyMigrations } from '../migrations.js';
import { GuildRepository } from './guild-repository.js';
import { SecurityRepository } from './security-repository.js';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://knight:knight@localhost:5432/knight_test';
const database = createDatabase(databaseUrl);
const guilds = new GuildRepository(database);
const security = new SecurityRepository(database);

describe('security persistence', () => {
  beforeAll(async () => {
    await applyMigrations(database);
    await database.pool.query('TRUNCATE TABLE guilds CASCADE');
    await guilds.createOrUpdateOwner('g1', 'owner-1');
    await guilds.createOrUpdateOwner('g2', 'owner-2');
  });

  afterAll(async () => closeDatabase(database));

  it('keeps events isolated by guild', async () => {
    await security.recordEvent({
      guildId: 'g1',
      source: 'NATIVE',
      action: 'role.update',
      actorUserId: null,
      targetType: 'ROLE',
      targetId: 'role-1',
      auditLogId: null,
      executionId: null,
      incidentId: null,
      metadata: {},
      occurredAt: new Date('2026-09-12T10:00:00.000Z'),
    });

    expect(await security.listEvents('g2', 100)).toEqual([]);
    expect(await security.listEvents('g1', 100)).toEqual([
      expect.objectContaining({ guildId: 'g1', action: 'role.update', targetId: 'role-1' }),
    ]);
  });

  it('stores guild-scoped protection and defaults unlisted resources to Normal', async () => {
    expect(await security.getProtectionLevel('g1', 'USER', '42')).toBe(ProtectionLevel.Normal);

    await security.saveProtection({
      guildId: 'g1',
      resourceType: 'USER',
      resourceId: '42',
      level: ProtectionLevel.Important,
      updatedBy: 'owner-1',
    });
    await security.saveProtection({
      guildId: 'g2',
      resourceType: 'USER',
      resourceId: '42',
      level: ProtectionLevel.Immutable,
      updatedBy: 'owner-2',
    });

    expect(await security.getProtectionLevel('g1', 'USER', '42')).toBe(ProtectionLevel.Important);
    expect(await security.getProtectionLevel('g2', 'USER', '42')).toBe(ProtectionLevel.Immutable);

    await security.removeProtection('g1', 'USER', '42');
    expect(await security.getProtectionLevel('g1', 'USER', '42')).toBe(ProtectionLevel.Normal);
  });

  it('distinguishes neutral firewall defaults from an explicitly saved choice', async () => {
    expect(await security.getFirewallSettings('g1')).toMatchObject({
      guildId: 'g1',
      botMode: 'OBSERVE',
      webhookMode: 'OBSERVE',
      configured: false,
    });

    await security.saveFirewallSettings({
      guildId: 'g1',
      botMode: 'ALERT',
      webhookMode: 'ENFORCE',
      updatedBy: 'owner-1',
    });

    expect(await security.getFirewallSettings('g1')).toMatchObject({
      botMode: 'ALERT',
      webhookMode: 'ENFORCE',
      configured: true,
    });
    expect(await security.getFirewallSettings('g2')).toMatchObject({ configured: false });
  });

  it('upserts bot and webhook inventory trust states per guild', async () => {
    const bot = await security.upsertBotInventory({
      guildId: 'g1',
      botUserId: 'bot-1',
      trustState: 'BLOCKED',
      invitedByUserId: null,
      seenAt: new Date('2026-09-12T10:00:00.000Z'),
    });
    const webhook = await security.upsertWebhookInventory({
      guildId: 'g1',
      webhookId: 'webhook-1',
      channelId: 'channel-1',
      trustState: 'APPROVED',
      seenAt: new Date('2026-09-12T10:00:00.000Z'),
    });

    expect(bot).toMatchObject({ guildId: 'g1', botUserId: 'bot-1', trustState: 'BLOCKED' });
    expect(webhook).toMatchObject({
      guildId: 'g1',
      webhookId: 'webhook-1',
      channelId: 'channel-1',
      trustState: 'APPROVED',
    });
    expect(await security.getBotInventory('g1', 'bot-1')).toMatchObject({
      trustState: 'BLOCKED',
    });
    expect(await security.getWebhookInventory('g1', 'webhook-1')).toMatchObject({
      trustState: 'APPROVED',
    });
    expect(await security.getBotInventory('g2', 'bot-1')).toBeNull();

    expect(await security.listBotInventory('g1')).toEqual([
      expect.objectContaining({ botUserId: 'bot-1', trustState: 'BLOCKED' }),
    ]);
    expect(await security.listWebhookInventory('g2')).toEqual([]);
    expect(await security.setBotTrustState('g2', 'bot-1', 'TRUSTED')).toBeNull();
    expect(await security.setWebhookTrustState('g1', 'webhook-1', 'BLOCKED')).toMatchObject({
      trustState: 'BLOCKED',
    });
  });

  it('groups incidents by guild and actor within a five-minute window', async () => {
    const first = await security.findOrCreateIncident({
      guildId: 'g1',
      actorKey: 'user:42',
      severity: 'HIGH',
      summary: 'Native role changes',
      occurredAt: new Date('2026-09-12T10:00:00.000Z'),
    });
    const grouped = await security.findOrCreateIncident({
      guildId: 'g1',
      actorKey: 'user:42',
      severity: 'HIGH',
      summary: 'Native role changes',
      occurredAt: new Date('2026-09-12T10:04:00.000Z'),
    });
    const later = await security.findOrCreateIncident({
      guildId: 'g1',
      actorKey: 'user:42',
      severity: 'HIGH',
      summary: 'Native role changes',
      occurredAt: new Date('2026-09-12T10:10:00.000Z'),
    });
    const otherGuild = await security.findOrCreateIncident({
      guildId: 'g2',
      actorKey: 'user:42',
      severity: 'HIGH',
      summary: 'Native role changes',
      occurredAt: new Date('2026-09-12T10:04:00.000Z'),
    });

    expect(grouped.id).toBe(first.id);
    expect(grouped.eventCount).toBe(2);
    expect(later.id).not.toBe(first.id);
    expect(otherGuild.id).not.toBe(first.id);
    expect(await security.listActiveIncidents('g1')).toEqual([
      expect.objectContaining({ id: later.id }),
      expect.objectContaining({ id: first.id, eventCount: 2 }),
    ]);
  });

  it('lists protected resources only for the requested guild', async () => {
    await security.saveProtection({
      guildId: 'g1',
      resourceType: 'ROLE',
      resourceId: 'role-9',
      level: ProtectionLevel.Critical,
      updatedBy: 'owner-1',
    });

    expect(await security.listProtectedResources('g1')).toEqual([
      expect.objectContaining({ resourceType: 'ROLE', resourceId: 'role-9' }),
    ]);
    expect(await security.listProtectedResources('g2')).toEqual([
      expect.objectContaining({ resourceType: 'USER', resourceId: '42' }),
    ]);
  });

  it('stores one complete guild emergency state and defaults to Normal', async () => {
    expect(await security.getSecurityState('g1')).toMatchObject({
      guildId: 'g1',
      mode: 'NORMAL',
      lockedScopes: [],
      reason: null,
      updatedBy: null,
    });

    await security.setSecurityState({
      guildId: 'g1',
      mode: 'LOCKDOWN',
      lockedScopes: ['MEMBER_MODERATION', 'SECURITY_CONFIG'],
      reason: 'Investigating account access',
      updatedBy: 'owner-1',
    });
    expect(await security.getSecurityState('g1')).toMatchObject({
      mode: 'LOCKDOWN',
      lockedScopes: ['MEMBER_MODERATION', 'SECURITY_CONFIG'],
      reason: 'Investigating account access',
    });
    expect(await security.getSecurityState('g2')).toMatchObject({ mode: 'NORMAL' });

    await security.setSecurityState({
      guildId: 'g1',
      mode: 'PANIC',
      lockedScopes: ['ROLES'],
      reason: 'Confirmed compromise',
      updatedBy: 'manager-1',
    });
    expect(await security.getSecurityState('g1')).toMatchObject({
      mode: 'PANIC',
      lockedScopes: [],
      reason: 'Confirmed compromise',
      updatedBy: 'manager-1',
    });
  });

  it('changes emergency state only when the locked current mode matches', async () => {
    await security.setSecurityState({
      guildId: 'g1',
      mode: 'PANIC',
      lockedScopes: [],
      reason: 'Confirmed compromise',
      updatedBy: 'owner-1',
    });

    const staleUnlock = await security.transitionSecurityState({
      guildId: 'g1',
      expectedModes: ['LOCKDOWN'],
      mode: 'NORMAL',
      lockedScopes: [],
      reason: 'Stale unlock',
      updatedBy: 'owner-1',
    });

    expect(staleUnlock).toBeNull();
    expect(await security.getSecurityState('g1')).toMatchObject({
      mode: 'PANIC',
      reason: 'Confirmed compromise',
    });
  });
});
