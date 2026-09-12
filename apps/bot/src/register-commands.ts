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
      .setName('warn')
      .setDescription('Issue a durable Knight warning.')
      .addUserOption((option) =>
        option.setName('user').setDescription('Member to warn.').setRequired(true),
      )
      .addStringOption((option) =>
        option.setName('reason').setDescription('Moderation reason.').setRequired(true),
      ),
  )
  .addSubcommand((command) =>
    command
      .setName('warnings')
      .setDescription('View a member’s Knight warning history.')
      .addUserOption((option) =>
        option.setName('user').setDescription('Member whose warnings to view.').setRequired(true),
      ),
  )
  .addSubcommand((command) =>
    command
      .setName('timeout')
      .setDescription('Temporarily restrict a member through Knight.')
      .addUserOption((option) =>
        option.setName('user').setDescription('Member to timeout.').setRequired(true),
      )
      .addStringOption((option) =>
        option.setName('duration').setDescription('Duration such as 10m, 1h, or 1d.').setRequired(true),
      )
      .addStringOption((option) =>
        option.setName('reason').setDescription('Moderation reason.').setRequired(true),
      ),
  )
  .addSubcommand((command) =>
    command
      .setName('kick')
      .setDescription('Remove a member from the server through Knight.')
      .addUserOption((option) =>
        option.setName('user').setDescription('Member to kick.').setRequired(true),
      )
      .addStringOption((option) =>
        option.setName('reason').setDescription('Moderation reason.').setRequired(true),
      ),
  )
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
  )
  .addSubcommand((command) =>
    command
      .setName('unban')
      .setDescription('Remove a Discord ban through Knight policy checks.')
      .addStringOption((option) =>
        option.setName('user_id').setDescription('Discord user ID to unban.').setRequired(true),
      )
      .addStringOption((option) =>
        option.setName('reason').setDescription('Moderation reason.').setRequired(true),
      ),
  );

const message = new SlashCommandBuilder()
  .setName('message')
  .setDescription('Run guarded message moderation actions.')
  .addSubcommand((command) =>
    command
      .setName('purge')
      .setDescription('Delete recent messages through Knight policy checks.')
      .addIntegerOption((option) =>
        option
          .setName('count')
          .setDescription('Number of recent messages to inspect, from 1 to 100.')
          .setMinValue(1)
          .setMaxValue(100)
          .setRequired(true),
      )
      .addUserOption((option) =>
        option.setName('user').setDescription('Optional member filter.'),
      )
      .addStringOption((option) =>
        option.setName('reason').setDescription('Optional moderation reason.'),
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

const backup = new SlashCommandBuilder()
  .setName('backup')
  .setDescription('Manage Knight local backups.')
  .addSubcommand((command) =>
    command.setName('create').setDescription('Queue a local structural backup.'),
  )
  .addSubcommand((command) =>
    command.setName('status').setDescription('Show the latest backup and recovery status.'),
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
  )
  .addSubcommand((command) =>
    command.setName('status').setDescription('Show the current Knight emergency security state.'),
  )
  .addSubcommand((command) =>
    command
      .setName('lockdown')
      .setDescription('Freeze a fixed group of privileged Knight actions.')
      .addStringOption((option) =>
        option
          .setName('scope')
          .setDescription('Privileged action group to freeze.')
          .setRequired(true)
          .addChoices(
            { name: 'Member moderation', value: 'MEMBER_MODERATION' },
            { name: 'Roles', value: 'ROLES' },
            { name: 'Channels', value: 'CHANNELS' },
            { name: 'Bots and webhooks', value: 'BOTS_WEBHOOKS' },
            { name: 'Security configuration', value: 'SECURITY_CONFIG' },
            { name: 'Full', value: 'FULL' },
          ),
      )
      .addStringOption((option) =>
        option.setName('reason').setDescription('Reason for Lockdown.').setRequired(true),
      ),
  )
  .addSubcommand((command) =>
    command
      .setName('unlock')
      .setDescription('Clear Lockdown and return Knight to Normal.')
      .addStringOption((option) =>
        option.setName('reason').setDescription('Reason for clearing Lockdown.').setRequired(true),
      ),
  )
  .addSubcommand((command) =>
    command
      .setName('panic')
      .setDescription('Freeze privileged Knight mutations during an emergency.')
      .addStringOption((option) =>
        option.setName('reason').setDescription('Reason for Panic.').setRequired(true),
      )
      .addBooleanOption((option) =>
        option
          .setName('confirm')
          .setDescription('Confirm that Panic should be activated.')
          .setRequired(true),
      ),
  )
  .addSubcommand((command) =>
    command
      .setName('panic-clear')
      .setDescription('Clear Panic and return Knight to Normal.')
      .addStringOption((option) =>
        option.setName('reason').setDescription('Reason for clearing Panic.').setRequired(true),
      ),
  );

export const KNIGHT_COMMANDS = [doctor, setup, member, message, staff, security, backup] as const;

export async function registerCommands(client: Client<true>): Promise<void> {
  await client.application.commands.set(KNIGHT_COMMANDS.map((command) => command.toJSON()));
}
