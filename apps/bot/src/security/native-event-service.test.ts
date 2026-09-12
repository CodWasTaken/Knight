import { ProtectionLevel } from '@knight/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeEventService } from './native-event-service.js';

function dependencies() {
  return {
    security: {
      getProtectionLevel: vi.fn().mockResolvedValue(ProtectionLevel.Normal),
      findOrCreateIncident: vi.fn().mockResolvedValue({ id: 'incident-1' }),
      recordEvent: vi.fn().mockImplementation(async (input) => ({ id: 'event-1', ...input })),
    },
    correlations: { consumeMatch: vi.fn().mockResolvedValue(null) },
    recorder: { record: vi.fn().mockResolvedValue({ id: 1 }) },
    firewall: {
      handleBotJoin: vi.fn().mockResolvedValue({ observed: 1, removed: 0 }),
      handleWebhookUpdate: vi.fn().mockResolvedValue({ observed: 0, removed: 0 }),
    },
  };
}

const event = {
  guildId: 'g1',
  knightBotUserId: 'b1',
  action: 'member.ban',
  targetType: 'USER' as const,
  targetId: 'u2',
  actorUserId: 'staff-1',
  auditLogId: 'audit-1',
  metadata: {},
  occurredAt: new Date('2026-09-12T10:00:00.000Z'),
};

describe('NativeEventService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('recognizes a correlated Knight mutation and records its requester', async () => {
    const deps = dependencies();
    deps.correlations.consumeMatch.mockResolvedValueOnce({
      id: 'corr-1',
      guildId: 'g1',
      requestedByUserId: 'owner-1',
      action: 'member.ban',
      targetId: 'u2',
      expectedAuditActorBotId: 'b1',
      createdAtMs: 1_000,
    });

    await new NativeEventService(deps).record({ ...event, actorUserId: 'b1' });

    expect(deps.correlations.consumeMatch).toHaveBeenCalledWith({
      guildId: 'g1',
      expectedAuditActorBotId: 'b1',
      action: 'member.ban',
      targetId: 'u2',
    });
    expect(deps.security.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'KNIGHT',
        actorUserId: 'owner-1',
        executionId: 'corr-1',
        incidentId: null,
      }),
    );
    expect(deps.security.findOrCreateIncident).not.toHaveBeenCalled();
  });

  it.each([
    ['staff-1', 'staff-1'],
    [null, null],
  ])('preserves safe native attribution %s', async (actorUserId, expectedActor) => {
    const deps = dependencies();

    await new NativeEventService(deps).record({ ...event, actorUserId });

    expect(deps.security.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'NATIVE', actorUserId: expectedActor }),
    );
    if (actorUserId !== null) expect(deps.correlations.consumeMatch).not.toHaveBeenCalled();
  });

  it('still records a native event when Redis correlation is unavailable', async () => {
    const deps = dependencies();
    deps.correlations.consumeMatch.mockRejectedValueOnce(new Error('redis unavailable'));

    await new NativeEventService(deps).record({ ...event, actorUserId: null });

    expect(deps.security.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'NATIVE', actorUserId: null, executionId: null }),
    );
  });

  it('groups a protected native change into an incident and records it in the ledger', async () => {
    const deps = dependencies();
    deps.security.getProtectionLevel.mockResolvedValue(ProtectionLevel.Critical);
    const service = new NativeEventService(deps);

    await service.record({ ...event, action: 'role.update', targetType: 'ROLE', targetId: 'r1' });
    await service.record({
      ...event,
      action: 'role.delete',
      targetType: 'ROLE',
      targetId: 'r1',
      occurredAt: new Date('2026-09-12T10:01:00.000Z'),
    });

    expect(deps.security.findOrCreateIncident).toHaveBeenCalledTimes(2);
    expect(deps.security.findOrCreateIncident).toHaveBeenCalledWith(
      expect.objectContaining({ guildId: 'g1', actorKey: 'user:staff-1', severity: 'HIGH' }),
    );
    expect(deps.security.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ incidentId: 'incident-1' }),
    );
    expect(deps.recorder.record).toHaveBeenCalledWith(
      expect.objectContaining({ incidentId: 'incident-1', severity: 'HIGH' }),
      'SECURITY',
    );
  });

  it('passes bot joins and webhook updates to the explicit firewall', async () => {
    const deps = dependencies();
    const service = new NativeEventService(deps);

    await service.record({ ...event, action: 'bot.join', targetType: 'BOT', targetId: 'bot-2' });
    await service.record({
      ...event,
      action: 'webhook.update',
      targetType: 'WEBHOOK',
      targetId: 'channel-1',
    });

    expect(deps.firewall.handleBotJoin).toHaveBeenCalledWith('g1', 'bot-2');
    expect(deps.firewall.handleWebhookUpdate).toHaveBeenCalledWith('g1', 'channel-1');
  });

  it('still applies explicit firewall handling when the native ledger append fails', async () => {
    const deps = dependencies();
    deps.recorder.record.mockRejectedValueOnce(new Error('ledger unavailable'));

    await expect(
      new NativeEventService(deps).record({
        ...event,
        action: 'bot.join',
        targetType: 'BOT',
        targetId: 'bot-2',
      }),
    ).rejects.toThrow('ledger unavailable');

    expect(deps.security.recordEvent).toHaveBeenCalledTimes(1);
    expect(deps.firewall.handleBotJoin).toHaveBeenCalledWith('g1', 'bot-2');
  });
});
