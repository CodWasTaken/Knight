import { GuildMode } from '@knight/contracts';
import type { BanGuardPreview } from '../setup/guarded-migration-service.js';
import type { SetupStateView } from '../setup/setup-service.js';

export type SetupCommandDependencies = Readonly<{
  setup: {
    getState(guildId: string, actorUserId: string): Promise<SetupStateView>;
  };
  migrations: {
    previewBanGuard(guildId: string): Promise<BanGuardPreview>;
  };
}>;

export type SetupCommandResult = Readonly<{ content: string }>;

export async function executeSetupCommand(
  input: Readonly<{ guildId: string; actorUserId: string }>,
  dependencies: SetupCommandDependencies,
): Promise<SetupCommandResult> {
  const state = await dependencies.setup.getState(input.guildId, input.actorUserId);
  const lines = [
    'Knight setup status',
    `Mode: ${state.mode}`,
    `Setup step: ${state.step}`,
    `Hierarchy: ${state.hierarchyHealthy ? 'healthy' : 'blocked'}`,
    `Manage Roles: ${state.manageRolesReady ? 'ready' : 'missing'}`,
    `Staff Profiles: ${state.profileReady ? 'ready' : 'not ready'} (${state.profileCount})`,
    `Security Managers: ${state.securityManagerCount}`,
    `Next action: ${state.nextAction}`,
  ];

  if (state.mode === GuildMode.Observe) {
    lines.push(
      'Mode transition: Observe → Test is available when your practice workflow is ready.',
    );
  }

  if (state.mode === GuildMode.Test) {
    const preview = await dependencies.migrations.previewBanGuard(input.guildId);
    lines.push(
      `MEMBER_BAN Guarded preview: ${preview.roles.length} role(s), ${preview.staffCount} active staff, ${preview.blocked ? 'blocked' : 'ready'}.`,
      'Owner confirmation is required in the dashboard before enabling Guarded permissions.',
    );
  }
  if (state.mode === GuildMode.Guarded) {
    lines.push(
      'MEMBER_BAN Guarded is active. Owner rollback to Test is available in the dashboard.',
    );
  }

  return { content: lines.join('\n') };
}
