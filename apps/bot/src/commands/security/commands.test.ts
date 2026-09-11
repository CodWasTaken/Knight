import { describe, expect, it, vi } from 'vitest';
import { executeSecurityManagerAdd } from './manager-add.js';
import { executeSecurityManagerRemove } from './manager-remove.js';

const baseInput = {
  guildId: '100',
  actorUserId: '1',
  userId: '42',
} as const;

describe('security manager command handlers', () => {
  it('grants explicit Security Manager authority through the owner-only service', async () => {
    const service = { grant: vi.fn().mockResolvedValue(undefined) };

    const result = await executeSecurityManagerAdd(baseInput, service);

    expect(service.grant).toHaveBeenCalledWith(baseInput);
    expect(result.content).toContain('<@42>');
    expect(result.content).toContain('Security Manager');
  });

  it('revokes explicit Security Manager authority through the owner-only service', async () => {
    const service = { revoke: vi.fn().mockResolvedValue(undefined) };

    const result = await executeSecurityManagerRemove(baseInput, service);

    expect(service.revoke).toHaveBeenCalledWith(baseInput);
    expect(result.content).toContain('<@42>');
    expect(result.content).toContain('revoked');
  });

  it('renders owner-only denial without leaking internal details', async () => {
    const service = {
      grant: vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('Only owner. db=postgres://private'), { code: 'OWNER_REQUIRED' }),
        ),
    };

    const result = await executeSecurityManagerAdd(baseInput, service);

    expect(result.content).toContain('guild owner');
    expect(result.content).not.toContain('postgres://');
  });

  it('sanitizes unexpected Security Manager failures', async () => {
    const service = {
      revoke: vi.fn().mockRejectedValue(new Error('oauth_secret=private')),
    };

    const result = await executeSecurityManagerRemove(baseInput, service);

    expect(result.content).toContain('could not complete');
    expect(result.content).not.toContain('oauth_secret');
  });
});
