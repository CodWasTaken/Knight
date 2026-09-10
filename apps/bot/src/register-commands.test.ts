import { ApplicationCommandOptionType } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { KNIGHT_COMMANDS } from './register-commands.js';

type OptionShape = Readonly<{
  name: string;
  type: number;
  required?: boolean;
  min_value?: number;
  max_value?: number;
  options?: readonly OptionShape[];
}>;

type CommandShape = Readonly<{
  name: string;
  options?: readonly OptionShape[];
}>;

function command(name: string): CommandShape {
  const commands = KNIGHT_COMMANDS.map((item) => item.toJSON()) as CommandShape[];
  const found = commands.find((item) => item.name === name);
  if (!found) throw new Error(`Missing command ${name}`);
  return found;
}

function subcommand(parent: string, name: string): OptionShape {
  const found = command(parent).options?.find((item) => item.name === name);
  if (!found) throw new Error(`Missing subcommand ${parent} ${name}`);
  return found;
}

describe('Knight moderation command registration', () => {
  it('registers the complete approved command groups and subcommands', () => {
    const commands = KNIGHT_COMMANDS.map((item) => item.toJSON()) as CommandShape[];
    expect(commands.map((item) => item.name)).toEqual([
      'doctor',
      'setup',
      'member',
      'message',
      'staff',
      'security',
    ]);
    expect(command('member').options?.map((item) => item.name)).toEqual([
      'warn',
      'warnings',
      'timeout',
      'kick',
      'ban',
      'unban',
    ]);
    expect(command('message').options?.map((item) => item.name)).toEqual(['purge']);
  });

  it.each(['warn', 'timeout', 'kick', 'ban'])(
    'registers /member %s with required member and reason options',
    (name) => {
      expect(subcommand('member', name).options).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'user',
            type: ApplicationCommandOptionType.User,
            required: true,
          }),
          expect.objectContaining({
            name: 'reason',
            type: ApplicationCommandOptionType.String,
            required: true,
          }),
        ]),
      );
    },
  );

  it('registers warning history and unban with their distinct target shapes', () => {
    expect(subcommand('member', 'warnings').options).toEqual([
      expect.objectContaining({
        name: 'user',
        type: ApplicationCommandOptionType.User,
        required: true,
      }),
    ]);
    expect(subcommand('member', 'unban').options).toEqual([
      expect.objectContaining({
        name: 'user_id',
        type: ApplicationCommandOptionType.String,
        required: true,
      }),
      expect.objectContaining({
        name: 'reason',
        type: ApplicationCommandOptionType.String,
        required: true,
      }),
    ]);
  });

  it('registers timeout duration and purge bounds exactly', () => {
    expect(subcommand('member', 'timeout').options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'duration',
          type: ApplicationCommandOptionType.String,
          required: true,
        }),
      ]),
    );
    expect(subcommand('message', 'purge').options).toEqual([
      expect.objectContaining({
        name: 'count',
        type: ApplicationCommandOptionType.Integer,
        required: true,
        min_value: 1,
        max_value: 100,
      }),
      expect.objectContaining({ name: 'user', type: ApplicationCommandOptionType.User }),
      expect.objectContaining({ name: 'reason', type: ApplicationCommandOptionType.String }),
    ]);
  });
});
