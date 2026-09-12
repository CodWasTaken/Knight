import type { SecurityRecorder } from './security-recorder.js';
export type SecurityManagerDependencies = Readonly<{
  guilds: { get(guildId: string): Promise<{ ownerId: string } | null> };
  managers: {
    isSecurityManager(guildId: string, userId: string): Promise<boolean>;
    grant(input: { guildId: string; userId: string; grantedBy: string }): Promise<void>;
    revoke(guildId: string, userId: string): Promise<void>;
  };
  security: {
    getSecurityState(guildId: string): Promise<{
      mode: 'NORMAL' | 'LOCKDOWN' | 'PANIC';
      lockedScopes: readonly string[];
    }>;
  };
  securityRecorder: Pick<SecurityRecorder, 'record'>;
}>;

export class SecurityManagerError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SecurityManagerError';
  }
}

export class SecurityManagerService {
  public constructor(private readonly dependencies: SecurityManagerDependencies) {}

  private async record(action: string, guildId: string, actorUserId: string, targetId: string): Promise<void> {
    try {
      await this.dependencies.securityRecorder.record(
        {
          guildId, severity: 'INFO', source: 'SECURITY', action, actorUserId, targetId,
          decisionId: null, incidentId: null, metadata: {},
        },
        'SECURITY',
      );
    } catch {
      // Manager state is already durable; do not pretend it rolled back.
    }
  }

  private async requireOwner(guildId: string, actorUserId: string): Promise<void> {
    const guild = await this.dependencies.guilds.get(guildId);
    if (guild === null) {
      throw new SecurityManagerError(
        'GUILD_NOT_CONFIGURED',
        'Knight is not configured for this guild.',
      );
    }
    if (guild.ownerId !== actorUserId) {
      throw new SecurityManagerError(
        'OWNER_REQUIRED',
        'Only the Discord guild owner may change Security Managers.',
      );
    }
    const state = await this.dependencies.security.getSecurityState(guildId);
    const scopedLock = state.lockedScopes.some((scope) =>
      ['SECURITY_CONFIG', 'FULL'].includes(scope),
    );
    if (state.mode === 'PANIC' || (state.mode === 'LOCKDOWN' && scopedLock)) {
      throw new SecurityManagerError(
        'EMERGENCY_STATE_BLOCKED',
        'The current emergency state blocks Security Manager changes.',
      );
    }
  }
  public async grant(input: {
    guildId: string;
    actorUserId: string;
    userId: string;
  }): Promise<void> {
    await this.requireOwner(input.guildId, input.actorUserId);
    await this.dependencies.managers.grant({
      guildId: input.guildId,
      userId: input.userId,
      grantedBy: input.actorUserId,
    });
    await this.record('security.manager.add', input.guildId, input.actorUserId, input.userId);
  }

  public async revoke(input: {
    guildId: string;
    actorUserId: string;
    userId: string;
  }): Promise<void> {
    await this.requireOwner(input.guildId, input.actorUserId);
    await this.dependencies.managers.revoke(input.guildId, input.userId);
    await this.record('security.manager.remove', input.guildId, input.actorUserId, input.userId);
  }
}
