import { SlashCommandBuilder, type Client } from 'discord.js';

const doctor = new SlashCommandBuilder()
  .setName('doctor')
  .setDescription('Check Knight health and Discord protection readiness.');

const setup = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Start or continue Knight server setup.');

const member = new SlashCommandBuilder()
  .setName('member')
  .setDescription('Run guarded member moderation actions.')
  .addSubcommand((command) =>
    command
      .setName('ban')
      .setDescription('Ban a member through Knight policy checks.')
      .addUserOption((option) =>
        option.setName('user').setDescription('Member to ban.').setRequired(true),
      )
      .addStringOption((option) =>
        option.setName('reason').setDescription('Moderation reason.').setRequired(true),
      ),
  );

const staff = new SlashCommandBuilder()
  .setName('staff')
  .setDescription('Manage Knight Staff Profiles and assignments.')
  .addSubcommand((command) =>
    command
      .setName('create-profile')
      .setDescription('Create a Knight Staff Profile mapped to a Discord role.')
      .addStringOption((option) =>
        option.setName('name').setDescription('Profile name.').setRequired(true),
      )
      .addRoleOption((option) =>
        option.setName('role').setDescription('Mapped Discord role.').setRequired(true),
      )
      .addIntegerOption((option) =>
        option
          .setName('rank')
          .setDescription('Knight hierarchy rank.')
          .setMinValue(0)
          .setRequired(true),
      ),
  )
  .addSubcommand((command) =>
    command
      .setName('assign')
      .setDescription('Assign a Staff Profile to a member.')
      .addUserOption((option) =>
        option.setName('user').setDescription('Member to assign.').setRequired(true),
      )
      .addStringOption((option) =>
        option.setName('profile').setDescription('Staff Profile name or ID.').setRequired(true),
      ),
  )
  .addSubcommand((command) =>
    command
      .setName('remove')
      .setDescription('Remove a member from Knight staff.')
      .addUserOption((option) =>
        option.setName('user').setDescription('Staff member to remove.').setRequired(true),
      ),
  )
  .addSubcommand((command) =>
    command
      .setName('inspect')
      .setDescription('Inspect a member’s effective Knight staff state.')
      .addUserOption((option) =>
        option.setName('user').setDescription('Staff member to inspect.').setRequired(true),
      ),
  );

const security = new SlashCommandBuilder()
  .setName('security')
  .setDescription('Manage Knight security authority.')
  .addSubcommand((command) =>
    command
      .setName('manager-add')
      .setDescription('Grant Knight Security Manager authority.')
      .addUserOption((option) =>
        option.setName('user').setDescription('Member to authorize.').setRequired(true),
      ),
  )
  .addSubcommand((command) =>
    command
      .setName('manager-remove')
      .setDescription('Revoke Knight Security Manager authority.')
      .addUserOption((option) =>
        option.setName('user').setDescription('Security Manager to revoke.').setRequired(true),
      ),
  );

export const KNIGHT_COMMANDS = [doctor, setup, member, staff, security] as const;

export async function registerCommands(client: Client<true>): Promise<void> {
  await client.application.commands.set(KNIGHT_COMMANDS.map((command) => command.toJSON()));
}
