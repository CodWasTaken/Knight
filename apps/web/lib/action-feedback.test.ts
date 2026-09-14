import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ redirect: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
import { runWithActionFeedback } from './action-feedback.js';

describe('runWithActionFeedback', () => {
  it('uses fixed success and failure codes without exposing exception text', async () => {
    await runWithActionFeedback('/guilds/100/logging', ['/guilds/100/setup'], async () => undefined);
    expect(mocks.redirect).toHaveBeenLastCalledWith('/guilds/100/logging?notice=success');
    mocks.redirect.mockClear();
    await expect(runWithActionFeedback('/guilds/100/logging', [], async () => { throw new Error('secret stack detail'); })).rejects.toThrow('secret stack detail');
    expect(mocks.redirect).toHaveBeenCalledWith('/guilds/100/logging?notice=blocked');
    expect(mocks.redirect.mock.calls.flat().join(' ')).not.toContain('secret stack detail');
  });
});
