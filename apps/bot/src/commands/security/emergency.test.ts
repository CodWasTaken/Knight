import { describe, expect, it, vi } from 'vitest';
import { executeEmergencyLockdown, executeEmergencyPanic } from './emergency.js';

describe('emergency command handlers', () => {
  it('does not report success when an emergency transition fails', async () => {
    const lockdown = vi.fn().mockRejectedValue(new Error('database_url=private'));

    const result = await executeEmergencyLockdown(
      {
        guildId: '100',
        actorUserId: 'owner',
        scope: 'FULL',
        reason: 'Investigating',
      },
      { lockdown },
    );

    expect(result.content).toContain('could not change');
    expect(result.content).not.toContain('enabled');
    expect(result.content).not.toContain('database_url');
  });

  it('explains that unconfirmed Panic was not activated', async () => {
    const panic = vi.fn().mockRejectedValue(
      Object.assign(new Error('confirmation required'), {
        code: 'PANIC_CONFIRMATION_REQUIRED',
      }),
    );

    const result = await executeEmergencyPanic(
      {
        guildId: '100',
        actorUserId: 'manager',
        reason: 'Possible compromise',
        confirmed: false,
      },
      { panic },
    );

    expect(result.content).toContain('not activated');
    expect(result.content).toContain('confirmation');
  });
});
