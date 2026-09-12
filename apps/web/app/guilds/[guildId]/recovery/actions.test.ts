import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getWebRuntime: vi.fn(),
  getWebDiscordAdapter: vi.fn(),
  requireGuildAccess: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('../../../../auth', () => ({ auth: mocks.auth }));
vi.mock('../../../../lib/authorization', () => ({ requireGuildAccess: mocks.requireGuildAccess }));
vi.mock('../../../../lib/server-runtime', () => ({ getWebRuntime: mocks.getWebRuntime }));
vi.mock('../../../../lib/discord-runtime', () => ({ getWebDiscordAdapter: mocks.getWebDiscordAdapter }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

import {
  confirmRestoreAction, queueBackupNowAction, requestRestorePreviewAction,
  retryRestoreAction, saveBackupPolicyAction,
} from './actions';

function policyData(values: {
  mode?: string;
  cap?: string;
  channels?: string[];
} = {}): FormData {
  const form = new FormData();
  form.set('guildId', '100');
  form.set('mode', values.mode ?? 'DAILY');
  form.set('maxMessagesPerChannel', values.cap ?? '1000');
  for (const channel of values.channels ?? []) form.append('archiveChannelId', channel);
  return form;
}

function setup(archiveEnabled = false) {
  const savePolicy = vi.fn().mockResolvedValue({});
  const enqueueBackup = vi.fn().mockResolvedValue({ id: 'backup-now', status: 'PENDING' });
  const getBackup = vi.fn().mockResolvedValue({
    id: 'backup-1', guildId: '100', status: 'COMPLETED',
    relativePath: '100/backup-1.json.gz', sha256: 'a'.repeat(64),
  });
  const enqueueRestorePreview = vi.fn().mockResolvedValue({ id: 'job-1', status: 'PENDING' });
  const confirmRestore = vi.fn().mockResolvedValue({ id: 'job-1', status: 'PENDING' });
  const retryRestore = vi.fn().mockResolvedValue({ id: 'job-1', status: 'PENDING' });
  const repositories = {
    guilds: {}, managers: {}, staff: {}, security: {}, securityLedger: {},
    backups: {
      savePolicy, enqueueBackup, getBackup, enqueueRestorePreview, confirmRestore, retryRestore,
    },
  };
  const discord = {
    listTextChannels: vi.fn().mockResolvedValue([
      { channelId: '10', name: 'general' },
      { channelId: '20', name: 'archive' },
    ]),
  };
  mocks.auth.mockResolvedValue({ user: { id: 'session-user' } });
  mocks.requireGuildAccess.mockResolvedValue('SECURITY_MANAGER');
  mocks.getWebRuntime.mockReturnValue({
    env: { ENABLE_MESSAGE_CONTENT_ARCHIVE: archiveEnabled },
    repositories,
  });
  mocks.getWebDiscordAdapter.mockReturnValue(discord);
  return {
    repositories, savePolicy, enqueueBackup, getBackup, enqueueRestorePreview,
    confirmRestore, retryRestore, discord,
  };
}

describe('recovery backup policy actions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('queues a restore preview for an authorized manager only from a completed verified backup', async () => {
    const made = setup();
    const form = new FormData();
    form.set('guildId', '100');
    form.set('backupId', 'backup-1');

    await requestRestorePreviewAction(form);

    expect(made.getBackup).toHaveBeenCalledWith('100', 'backup-1');
    expect(made.enqueueRestorePreview).toHaveBeenCalledWith({
      guildId: '100', backupId: 'backup-1', requestedBy: 'session-user',
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/guilds/100/recovery');

    made.getBackup.mockResolvedValueOnce({ id: 'backup-2', status: 'FAILED', relativePath: null, sha256: null });
    form.set('backupId', 'backup-2');
    await expect(requestRestorePreviewAction(form)).rejects.toThrow('completed backup');
  });

  it('requires explicit owner confirmation before queuing restore execution', async () => {
    const made = setup();
    const form = new FormData();
    form.set('guildId', '100');
    form.set('jobId', 'job-1');
    form.set('confirmRestore', 'CONFIRM');

    await expect(confirmRestoreAction(form)).rejects.toThrow('guild owner');
    expect(made.confirmRestore).not.toHaveBeenCalled();

    mocks.requireGuildAccess.mockResolvedValueOnce('OWNER');
    await confirmRestoreAction(form);
    expect(made.confirmRestore).toHaveBeenCalledWith({
      guildId: '100', jobId: 'job-1', confirmedBy: 'session-user',
    });
  });

  it('rejects restore confirmation when the explicit checkbox is absent', async () => {
    const made = setup();
    mocks.requireGuildAccess.mockResolvedValueOnce('OWNER');
    const form = new FormData();
    form.set('guildId', '100');
    form.set('jobId', 'job-1');

    await expect(confirmRestoreAction(form)).rejects.toThrow('explicit confirmation');
    expect(made.confirmRestore).not.toHaveBeenCalled();
  });

  it('allows only the guild owner to retry a failed restore from its checkpoint', async () => {
    const made = setup();
    const form = new FormData();
    form.set('guildId', '100');
    form.set('jobId', 'job-1');

    await expect(retryRestoreAction(form)).rejects.toThrow('guild owner');
    expect(made.retryRestore).not.toHaveBeenCalled();

    mocks.requireGuildAccess.mockResolvedValueOnce('OWNER');
    await retryRestoreAction(form);
    expect(made.retryRestore).toHaveBeenCalledWith({ guildId: '100', jobId: 'job-1' });
  });

  it('queues a manual backup for an authorized principal without running it inline', async () => {
    const { repositories, enqueueBackup } = setup();
    const form = new FormData();
    form.set('guildId', '100');

    await queueBackupNowAction(form);

    expect(mocks.requireGuildAccess).toHaveBeenCalledWith(
      '100', { user: { id: 'session-user' } }, repositories,
    );
    expect(enqueueBackup).toHaveBeenCalledWith({ guildId: '100', requestedBy: 'session-user' });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/guilds/100/recovery');
  });

  it('allows an authorized Security Manager and persists the session actor', async () => {
    const { repositories, savePolicy } = setup();
    await saveBackupPolicyAction(policyData({ mode: 'MANUAL' }));
    expect(mocks.requireGuildAccess).toHaveBeenCalledWith(
      '100',
      { user: { id: 'session-user' } },
      repositories,
    );
    expect(savePolicy).toHaveBeenCalledWith({
      guildId: '100',
      mode: 'MANUAL',
      archiveChannelIds: [],
      maxMessagesPerChannel: 1000,
      updatedBy: 'session-user',
    });
  });

  it('also allows the guild owner and propagates authorization denial', async () => {
    const { savePolicy } = setup();
    mocks.requireGuildAccess.mockResolvedValueOnce('OWNER');
    await expect(saveBackupPolicyAction(policyData({ mode: 'DISABLED' }))).resolves.toBeUndefined();
    expect(savePolicy).toHaveBeenCalledTimes(1);

    mocks.requireGuildAccess.mockRejectedValueOnce(new Error('denied'));
    await expect(saveBackupPolicyAction(policyData())).rejects.toThrow('denied');
    expect(savePolicy).toHaveBeenCalledTimes(1);
  });

  it.each(['DISABLED', 'MANUAL', 'DAILY'])('accepts exact policy mode %s', async (mode) => {
    const { savePolicy } = setup();
    await saveBackupPolicyAction(policyData({ mode }));
    expect(savePolicy).toHaveBeenCalledWith(expect.objectContaining({ mode }));
  });
  it('rejects any non-approved policy mode', async () => {
    const { savePolicy } = setup();
    await expect(saveBackupPolicyAction(policyData({ mode: 'WEEKLY' }))).rejects.toThrow('backup policy mode');
    expect(savePolicy).not.toHaveBeenCalled();
  });

  it.each(['0', '10001', '1.5', 'nope'])('rejects invalid message cap %s', async (cap) => {
    const { savePolicy } = setup();
    await expect(saveBackupPolicyAction(policyData({ cap }))).rejects.toThrow('message cap');
    expect(savePolicy).not.toHaveBeenCalled();
  });

  it('rejects archive channels outside the guild text-channel list', async () => {
    const { savePolicy } = setup(true);
    await expect(
      saveBackupPolicyAction(policyData({ channels: ['10', 'outside'] })),
    ).rejects.toThrow('valid guild text channel');
    expect(savePolicy).not.toHaveBeenCalled();
  });

  it('rejects selected message archives when operator opt-in is disabled', async () => {
    const { savePolicy } = setup(false);
    await expect(saveBackupPolicyAction(policyData({ channels: ['10'] }))).rejects.toThrow(
      'ENABLE_MESSAGE_CONTENT_ARCHIVE',
    );
    expect(savePolicy).not.toHaveBeenCalled();
  });

  it('persists validated selected channels when operator opt-in is enabled', async () => {
    const { savePolicy, discord } = setup(true);
    await saveBackupPolicyAction(policyData({ channels: ['10', '20'], cap: '2500' }));
    expect(discord.listTextChannels).toHaveBeenCalledWith('100');
    expect(savePolicy).toHaveBeenCalledWith({
      guildId: '100',
      mode: 'DAILY',
      archiveChannelIds: ['10', '20'],
      maxMessagesPerChannel: 2500,
      updatedBy: 'session-user',
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/guilds/100/recovery');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/guilds/100/setup');
  });
});
