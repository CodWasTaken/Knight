import { MessageFlags, type Interaction } from 'discord.js';
import { executeMemberBan, type MemberBanCommandDependencies } from './member/ban.js';
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

export type CommandRouterDependencies = Readonly<{
  memberBan: MemberBanCommandDependencies;
  roleSync: StaffCreateProfileService &
    StaffAssignService &
    StaffRemoveService &
    StaffInspectService;
  securityManagers: SecurityManagerGrantService & SecurityManagerRevokeService;
  now: () => number;
}>;

const EPHEMERAL = MessageFlags.Ephemeral;
const IMPLEMENTED_COMMANDS = new Set(['member', 'staff', 'security']);

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

  const subcommand = interaction.options.getSubcommand();

  if (interaction.commandName === 'member') {
    if (subcommand !== 'ban') {
      await interaction.reply({
        content: 'That member command is not implemented yet.',
        flags: EPHEMERAL,
      });
      return;
    }
    const target = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason', true);
    const result = await executeMemberBan(
      {
        guildId: interaction.guildId,
        actorUserId: interaction.user.id,
        targetUserId: target.id,
        knightBotUserId: interaction.client.user.id,
        reason,
        nowMs: dependencies.now(),
      },
      dependencies.memberBan,
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
