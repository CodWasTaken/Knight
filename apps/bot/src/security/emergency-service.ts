import {
  SECURITY_LOCKDOWN_SCOPES,
  type SecurityLockdownScope,
  type SecurityStateMode,
} from '@knight/contracts';
import type {
  GuildRepository,
  SecurityManagerRepository,
  SecurityRepository,
  SecurityStateView,
} from '@knight/database';
import type { SecurityRecorder } from './security-recorder.js';

const VALID_SCOPES = new Set<string>(SECURITY_LOCKDOWN_SCOPES);

export type EmergencyServiceDependencies = Readonly<{
  guilds: Pick<GuildRepository, 'get'>;
  managers: Pick<SecurityManagerRepository, 'isSecurityManager'>;
  security: Pick<
    SecurityRepository,
    'getSecurityState' | 'transitionSecurityState' | 'findOrCreateIncident'
  >;
  securityRecorder: Pick<SecurityRecorder, 'record'>;
  now: () => Date;
}>;

export class EmergencyServiceError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'EmergencyServiceError';
  }
}

export class EmergencyService {
  public constructor(private readonly dependencies: EmergencyServiceDependencies) {}

  public status(guildId: string): Promise<SecurityStateView> {
    return this.dependencies.security.getSecurityState(guildId);
  }

  private async requireAuthority(guildId: string, actorUserId: string): Promise<void> {
    const guild = await this.dependencies.guilds.get(guildId);
    if (guild === null) {
      throw new EmergencyServiceError(
        'GUILD_NOT_CONFIGURED',
        'Knight is not configured for this guild.',
      );
    }
    if (
      guild.ownerId !== actorUserId &&
      !(await this.dependencies.managers.isSecurityManager(guildId, actorUserId))
    ) {
      throw new EmergencyServiceError(
        'EMERGENCY_AUTHORITY_REQUIRED',
        'Only the guild owner or a Knight Security Manager may change emergency state.',
      );
    }
  }

  private reason(value: string): string {
    const reason = value.trim();
    if (reason.length === 0) {
      throw new EmergencyServiceError('REASON_REQUIRED', 'An emergency-state reason is required.');
    }
    return reason;
  }

  private async transition(input: {
    guildId: string;
    actorUserId: string;
    mode: SecurityStateMode;
    lockedScopes: readonly SecurityLockdownScope[];
    reason: string;
    action: string;
    severity: 'HIGH' | 'CRITICAL';
    incidentId?: string | null;
    expectedModes: readonly SecurityStateMode[];
  }): Promise<SecurityStateView> {
    const state = await this.dependencies.security.transitionSecurityState({
      guildId: input.guildId,
      expectedModes: input.expectedModes,
      mode: input.mode,
      lockedScopes: input.lockedScopes,
      reason: input.reason,
      updatedBy: input.actorUserId,
    });
    if (state === null) {
      throw new EmergencyServiceError(
        'INVALID_EMERGENCY_TRANSITION',
        'The emergency state changed before this request could be applied.',
      );
    }
    await this.dependencies.securityRecorder.record(
      {
        guildId: input.guildId,
        severity: input.severity,
        source: 'SECURITY',
        action: input.action,
        actorUserId: input.actorUserId,
        targetId: input.guildId,
        decisionId: null,
        incidentId: input.incidentId ?? null,
        metadata: {
          mode: input.mode,
          lockedScopes: input.lockedScopes,
          reason: input.reason,
        },
      },
      'SECURITY',
    );
    return state;
  }

  public async lockdown(input: {
    guildId: string;
    actorUserId: string;
    scopes: readonly SecurityLockdownScope[];
    reason: string;
  }): Promise<SecurityStateView> {
    await this.requireAuthority(input.guildId, input.actorUserId);
    const reason = this.reason(input.reason);
    const scopes = [...new Set(input.scopes)];
    if (scopes.length === 0 || scopes.some((scope) => !VALID_SCOPES.has(scope))) {
      throw new EmergencyServiceError(
        'INVALID_LOCKDOWN_SCOPE',
        'Choose at least one supported Lockdown scope.',
      );
    }
    return this.transition({
      guildId: input.guildId,
      actorUserId: input.actorUserId,
      mode: 'LOCKDOWN',
      lockedScopes: scopes,
      reason,
      action: 'security.lockdown.enabled',
      severity: 'HIGH',
      expectedModes: ['NORMAL', 'LOCKDOWN'],
    });
  }

  public async unlock(input: {
    guildId: string;
    actorUserId: string;
    reason: string;
  }): Promise<SecurityStateView> {
    await this.requireAuthority(input.guildId, input.actorUserId);
    const reason = this.reason(input.reason);
    return this.transition({
      ...input,
      mode: 'NORMAL',
      lockedScopes: [],
      reason,
      action: 'security.lockdown.cleared',
      severity: 'HIGH',
      expectedModes: ['LOCKDOWN'],
    });
  }

  public async panic(input: {
    guildId: string;
    actorUserId: string;
    reason: string;
    confirmed: boolean;
  }): Promise<SecurityStateView> {
    if (!input.confirmed) {
      throw new EmergencyServiceError(
        'PANIC_CONFIRMATION_REQUIRED',
        'Panic requires explicit confirmation.',
      );
    }
    await this.requireAuthority(input.guildId, input.actorUserId);
    const reason = this.reason(input.reason);
    const occurredAt = this.dependencies.now();
    const state = await this.dependencies.security.transitionSecurityState({
      guildId: input.guildId,
      expectedModes: ['NORMAL', 'LOCKDOWN', 'PANIC'],
      mode: 'PANIC',
      lockedScopes: [],
      reason,
      updatedBy: input.actorUserId,
    });
    if (state === null) {
      throw new EmergencyServiceError(
        'INVALID_EMERGENCY_TRANSITION',
        'The emergency state changed before Panic could be applied.',
      );
    }
    const incident = await this.dependencies.security.findOrCreateIncident({
      guildId: input.guildId,
      actorKey: 'emergency:panic',
      severity: 'CRITICAL',
      summary: `Panic activated: ${reason}`,
      occurredAt,
    });
    await this.dependencies.securityRecorder.record(
      {
        guildId: input.guildId,
        severity: 'CRITICAL',
        source: 'SECURITY',
        action: 'security.panic.enabled',
        actorUserId: input.actorUserId,
        targetId: input.guildId,
        decisionId: null,
        incidentId: incident.id,
        metadata: { mode: 'PANIC', lockedScopes: [], reason },
      },
      'SECURITY',
    );
    return state;
  }

  public async clearPanic(input: {
    guildId: string;
    actorUserId: string;
    reason: string;
  }): Promise<SecurityStateView> {
    await this.requireAuthority(input.guildId, input.actorUserId);
    const reason = this.reason(input.reason);
    return this.transition({
      ...input,
      mode: 'NORMAL',
      lockedScopes: [],
      reason,
      action: 'security.panic.cleared',
      severity: 'CRITICAL',
      expectedModes: ['PANIC'],
    });
  }
}
