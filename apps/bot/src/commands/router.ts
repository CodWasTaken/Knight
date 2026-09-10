import { MessageFlags, type Interaction } from 'discord.js';
import { executeDoctorCommand, type DoctorCommandDependencies } from './doctor.js';
import { executeMessagePurge, type MessagePurgeCommandDependencies } from './message/purge.js';
import { executeMemberBan, type MemberBanCommandDependencies } from './member/ban.js';
import { executeMemberKick, type MemberKickCommandDependencies } from './member/kick.js';
import { executeMemberTimeout, type MemberTimeoutCommandDependencies } from './member/timeout.js';
import { executeMemberUnban, type MemberUnbanCommandDependencies } from './member/unban.js';
import { executeMemberWarn, type MemberWarnCommandDependencies } from './member/warn.js';
import { executeMemberWarnings, type MemberWarningsCommandDependencies } from './member/warnings.js';
import {
  executeSecurityManagerAdd,
  type SecurityManagerGrantService,
} from './security/manager-add.js';
import {
  executeSecurityManagerRemove,
  type SecurityManagerRevokeService,
} from './security/manager-remove.js';
import { executeStaffAssign, type StaffAssignService } from './staff/assign.js';
import {
  executeStaffCreateProfile,
  type StaffCreateProfileService,
} from './staff/create-profile.js';
import { executeStaffInspect, type StaffInspectService } from './staff/inspect.js';
import { executeStaffRemove, type StaffRemoveService } from './staff/remove.js';
import { executeSetupCommand, type SetupCommandDependencies } from './setup.js';

export type CommandRouterDependencies = Readonly<{
  memberBan: MemberBanCommandDependencies;
  memberWarn: MemberWarnCommandDependencies;
  memberWarnings: MemberWarningsCommandDependencies;
  memberTimeout: MemberTimeoutCommandDependencies;
  memberKick: MemberKickCommandDependencies;
  memberUnban: MemberUnbanCommandDependencies;
  messagePurge: MessagePurgeCommandDependencies;
  roleSync: StaffCreateProfileService &
    StaffAssignService &
    StaffRemoveService &
    StaffInspectService;
  securityManagers: SecurityManagerGrantService & SecurityManagerRevokeService;
  setup: SetupCommandDependencies;
  doctor: DoctorCommandDependencies;
  now: () => number;
}>;

const EPHEMERAL = MessageFlags.Ephemeral;
const IMPLEMENTED_COMMANDS = new Set(['member', 'message', 'staff', 'security', 'setup', 'doctor']);

export async function routeInteraction(
  interaction: Interaction,
  dependencies: CommandRouterDependencies,
): Promise<void> {
  if (!interaction.isChatInputCommand()) return;

  if (!IMPLEMENTED_COMMANDS.has(interaction.commandName)) {
    await interaction.reply({
      content:
        'This Knight command is registered but is not implemented in the current milestone yet.',
      flags: EPHEMERAL,
    });
    return;
  }

  if (interaction.guildId === null) {
    await interaction.reply({
      content: 'Knight security-management commands can only be used inside a Discord server.',
      flags: EPHEMERAL,
    });
    return;
  }

  if (interaction.commandName === 'doctor') {
    const result = await executeDoctorCommand(
      { guildId: interaction.guildId },
      dependencies.doctor,
    );
    await interaction.reply({ content: result.content, flags: EPHEMERAL });
    return;
  }

  if (interaction.commandName === 'setup') {
    const result = await executeSetupCommand(
      { guildId: interaction.guildId, actorUserId: interaction.user.id },
      dependencies.setup,
    );
    await interaction.reply({ content: result.content, flags: EPHEMERAL });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  if (interaction.commandName === 'member') {
    if (subcommand === 'warn') {
      const result = await executeMemberWarn(
        {
          guildId: interaction.guildId,
          actorUserId: interaction.user.id,
          targetUserId: interaction.options.getUser('user', true).id,
          knightBotUserId: interaction.client.user.id,
          reason: interaction.options.getString('reason', true),
          nowMs: dependencies.now(),
        },
        dependencies.memberWarn,
      );
      await interaction.reply({ content: result.content, flags: EPHEMERAL });
      return;
    }

    if (subcommand === 'warnings') {
      const result = await executeMemberWarnings(
        {
          guildId: interaction.guildId,
          actorUserId: interaction.user.id,
          targetUserId: interaction.options.getUser('user', true).id,
          nowMs: dependencies.now(),
        },
        dependencies.memberWarnings,
      );
      await interaction.reply({ content: result.content, flags: EPHEMERAL });
      return;
    }

    if (subcommand === 'timeout') {
      const result = await executeMemberTimeout(
        {
          guildId: interaction.guildId,
          actorUserId: interaction.user.id,
          targetUserId: interaction.options.getUser('user', true).id,
          knightBotUserId: interaction.client.user.id,
          duration: interaction.options.getString('duration', true),
          reason: interaction.options.getString('reason', true),
          nowMs: dependencies.now(),
        },
        dependencies.memberTimeout,
      );
      await interaction.reply({ content: result.content, flags: EPHEMERAL });
      return;
    }

    if (subcommand === 'kick') {
      const result = await executeMemberKick(
        {
          guildId: interaction.guildId,
          actorUserId: interaction.user.id,
          targetUserId: interaction.options.getUser('user', true).id,
          knightBotUserId: interaction.client.user.id,
          reason: interaction.options.getString('reason', true),
          nowMs: dependencies.now(),
        },
        dependencies.memberKick,
      );
      await interaction.reply({ content: result.content, flags: EPHEMERAL });
      return;
    }

    if (subcommand === 'ban') {
      const result = await executeMemberBan(
        {
          guildId: interaction.guildId,
          actorUserId: interaction.user.id,
          targetUserId: interaction.options.getUser('user', true).id,
          knightBotUserId: interaction.client.user.id,
          reason: interaction.options.getString('reason', true),
          nowMs: dependencies.now(),
        },
        dependencies.memberBan,
      );
      await interaction.reply({ content: result.content, flags: EPHEMERAL });
      return;
    }

    if (subcommand === 'unban') {
      const result = await executeMemberUnban(
        {
          guildId: interaction.guildId,
          actorUserId: interaction.user.id,
          targetUserId: interaction.options.getString('user_id', true),
          knightBotUserId: interaction.client.user.id,
          reason: interaction.options.getString('reason', true),
          nowMs: dependencies.now(),
        },
        dependencies.memberUnban,
      );
      await interaction.reply({ content: result.content, flags: EPHEMERAL });
      return;
    }

    await interaction.reply({
      content: 'That member command is not implemented yet.',
      flags: EPHEMERAL,
    });
    return;
  }

  if (interaction.commandName === 'message') {
    if (subcommand !== 'purge') {
      await interaction.reply({ content: 'That message command is not implemented yet.', flags: EPHEMERAL });
      return;
    }
    const target = interaction.options.getUser('user', false);
    const result = await executeMessagePurge(
      {
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        actorUserId: interaction.user.id,
        knightBotUserId: interaction.client.user.id,
        count: interaction.options.getInteger('count', true),
        targetUserId: target?.id ?? null,
        reason: interaction.options.getString('reason', false),
        nowMs: dependencies.now(),
      },
      dependencies.messagePurge,
    );
    await interaction.reply({ content: result.content, flags: EPHEMERAL });
    return;
  }

  if (interaction.commandName === 'staff') {
    if (subcommand === 'create-profile') {
      const result = await executeStaffCreateProfile(
        {
          guildId: interaction.guildId,
          actorUserId: interaction.user.id,
          name: interaction.options.getString('name', true),
          discordRoleId: interaction.options.getRole('role', true).id,
          rank: interaction.options.getInteger('rank', true),
        },
        dependencies.roleSync,
      );
      await interaction.reply({ content: result.content, flags: EPHEMERAL });
      return;
    }

    if (subcommand === 'assign') {
      const result = await executeStaffAssign(
        {
          guildId: interaction.guildId,
          actorUserId: interaction.user.id,
          userId: interaction.options.getUser('user', true).id,
          profileReference: interaction.options.getString('profile', true),
        },
        dependencies.roleSync,
      );
      await interaction.reply({ content: result.content, flags: EPHEMERAL });
      return;
    }

    if (subcommand === 'remove') {
      const result = await executeStaffRemove(
        {
          guildId: interaction.guildId,
          actorUserId: interaction.user.id,
          userId: interaction.options.getUser('user', true).id,
        },
        dependencies.roleSync,
      );
      await interaction.reply({ content: result.content, flags: EPHEMERAL });
      return;
    }

    if (subcommand === 'inspect') {
      const result = await executeStaffInspect(
        {
          guildId: interaction.guildId,
          userId: interaction.options.getUser('user', true).id,
        },
        dependencies.roleSync,
      );
      await interaction.reply({ content: result.content, flags: EPHEMERAL });
      return;
    }

    await interaction.reply({
      content: 'That staff command is not implemented yet.',
      flags: EPHEMERAL,
    });
    return;
  }

  if (subcommand === 'manager-add') {
    const result = await executeSecurityManagerAdd(
      {
        guildId: interaction.guildId,
        actorUserId: interaction.user.id,
        userId: interaction.options.getUser('user', true).id,
      },
      dependencies.securityManagers,
    );
    await interaction.reply({ content: result.content, flags: EPHEMERAL });
    return;
  }

  if (subcommand === 'manager-remove') {
    const result = await executeSecurityManagerRemove(
      {
        guildId: interaction.guildId,
        actorUserId: interaction.user.id,
        userId: interaction.options.getUser('user', true).id,
      },
      dependencies.securityManagers,
    );
    await interaction.reply({ content: result.content, flags: EPHEMERAL });
    return;
  }

  await interaction.reply({
    content: 'That security command is not implemented yet.',
    flags: EPHEMERAL,
  });
}
