import { describe, expect, it } from 'vitest';
import { KNIGHT_COMMANDS } from './register-commands.js';

type CommandShape = Readonly<{
  name: string;
  options?: readonly Readonly<{ name: string }>[];
}>;

describe('Knight command shell', () => {
  it('registers the approved foundation command groups and subcommands', () => {
    const commands = KNIGHT_COMMANDS.map((command) => command.toJSON()) as CommandShape[];
    expect(commands.map((command) => command.name)).toEqual([
      'doctor',
      'setup',
      'member',
      'staff',
      'security',
    ]);

    expect(
      commands.find((command) => command.name === 'member')?.options?.map((item) => item.name),
    ).toEqual(['ban']);
    expect(
      commands.find((command) => command.name === 'staff')?.options?.map((item) => item.name),
    ).toEqual(['create-profile', 'assign', 'remove', 'inspect']);
    expect(
      commands.find((command) => command.name === 'security')?.options?.map((item) => item.name),
    ).toEqual(['manager-add', 'manager-remove']);
  });
});
