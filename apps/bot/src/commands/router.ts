import { MessageFlags, type Interaction } from 'discord.js';
import { executeMemberBan, type MemberBanCommandDependencies } from './member/ban.js';

export type CommandRouterDependencies = Readonly<{
  memberBan: MemberBanCommandDependencies;
  now: () => number;
}>;

const EPHEMERAL = MessageFlags.Ephemeral;

export async function routeInteraction(
  interaction: Interaction,
  dependencies: CommandRouterDependencies,
): Promise<void> {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName !== 'member') {
    await interaction.reply({
      content:
        'This Knight command is registered but is not implemented in the current milestone yet.',
      flags: EPHEMERAL,
    });
    return;
  }
  const subcommand = interaction.options.getSubcommand();
  if (subcommand !== 'ban') {
    await interaction.reply({
      content: 'That member command is not implemented yet.',
      flags: EPHEMERAL,
    });
    return;
  }

  if (interaction.guildId === null) {
    await interaction.reply({
      content: 'Knight moderation commands can only be used inside a Discord server.',
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
}
