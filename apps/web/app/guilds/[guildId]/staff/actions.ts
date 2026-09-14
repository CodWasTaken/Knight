'use server';

import {
  RATE_LIMITED_MODERATION_ACTIONS,
  READ_ONLY_ACTIONS,
  type ActionId,
} from '@knight/contracts';
import { redirect } from 'next/navigation';
import { auth } from '../../../../auth';
import { requireGuildAccess } from '../../../../lib/authorization';
import { getWebDiscordAdapter } from '../../../../lib/discord-runtime';
import { requireEmergencyScopesAvailable } from '../../../../lib/emergency-state';
import { getWebRuntime, type WebRuntime } from '../../../../lib/server-runtime';
import { runWithActionFeedback } from '../../../../lib/action-feedback';
import {
  createStaffProfileFromDashboard,
  updateStaffProfileFromDashboard,
  updateStaffProfilePolicy,
} from '../../../../lib/staff-profile-service';

function requiredString(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Invalid Staff Profile form submission.');
  }
  return value;
}

const EDITABLE_MODERATION_ACTIONS = [
  ...RATE_LIMITED_MODERATION_ACTIONS,
  ...READ_ONLY_ACTIONS,
] as const;
const EDITABLE_MODERATION_ACTION_SET = new Set<ActionId>(EDITABLE_MODERATION_ACTIONS);

function optionalString(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === 'string' ? value : undefined;
}

function optionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  return Number(value);
}

function parseActionPolicies(formData: FormData): Record<string, unknown> {
  return Object.fromEntries(
    RATE_LIMITED_MODERATION_ACTIONS.map((action) => {
      const windows = Array.from({ length: 10 }, (_, index) => {
        const max = optionalString(formData, `limitMax:${action}:${index}`);
        const amount = optionalString(formData, `limitAmount:${action}:${index}`);
        const unit = optionalString(formData, `limitUnit:${action}:${index}`);
        if ([max, amount, unit].every((value) => value === undefined || value === '')) return null;
        return {
          max: optionalNumber(max),
          amount: optionalNumber(amount),
          unit: unit === '' ? undefined : unit,
        };
      }).filter((window) => window !== null);

      return [
        action,
        {
          unlimited: optionalString(formData, `limitMode:${action}`) !== 'custom',
          windows,
        },
      ];
    }),
  );
}

function parsePermissions(formData: FormData, current: readonly ActionId[]): ActionId[] {
  const permissions = current.filter((action) => !EDITABLE_MODERATION_ACTION_SET.has(action));
  for (const action of EDITABLE_MODERATION_ACTIONS) {
    if (formData.get(`permission:${action}`) === 'on') permissions.push(action);
  }
  return permissions;
}

async function authorizedStaffRuntime(formData: FormData): Promise<{
  guildId: string;
  actorUserId: string;
  runtime: WebRuntime;
}> {
  const session = await auth();
  if (!session?.user?.id) redirect('/');

  const guildId = requiredString(formData, 'guildId');
  const runtime = getWebRuntime();
  await requireGuildAccess(guildId, session, runtime.repositories);
  return { guildId, actorUserId: session.user.id, runtime };
}

function dashboardDependencies(runtime: WebRuntime) {
  const discord = getWebDiscordAdapter(runtime);
  if (discord === null) {
    throw new Error(
      'Live Discord Staff Profile operations are unavailable because DISCORD_TOKEN is not configured for the web service.',
    );
  }
  return { ...runtime.repositories, discord };
}

export async function createStaffProfileAction(formData: FormData): Promise<void> {
  const { guildId, actorUserId, runtime } = await authorizedStaffRuntime(formData);
  await runWithActionFeedback(`/guilds/${guildId}/staff`, [`/guilds/${guildId}/staff`], async () => {
  await requireEmergencyScopesAvailable(runtime.repositories.security, guildId, ['ROLES', 'SECURITY_CONFIG']);
  await createStaffProfileFromDashboard(
    {
      guildId,
      name: requiredString(formData, 'name'),
      discordRoleId: requiredString(formData, 'discordRoleId'),
      rank: Number(requiredString(formData, 'rank')),
    },
    { userId: actorUserId },
    dashboardDependencies(runtime),
  );
  });
}

export async function updateStaffProfileMetadataAction(formData: FormData): Promise<void> {
  const { guildId, actorUserId, runtime } = await authorizedStaffRuntime(formData);
  const profileId = requiredString(formData, 'profileId');
  await runWithActionFeedback(`/guilds/${guildId}/staff/${profileId}`, [`/guilds/${guildId}/staff`, `/guilds/${guildId}/staff/${profileId}`], async () => {
  await requireEmergencyScopesAvailable(runtime.repositories.security, guildId, ['ROLES', 'SECURITY_CONFIG']);
  await updateStaffProfileFromDashboard(
    {
      guildId,
      profileId,
      name: requiredString(formData, 'name'),
      discordRoleId: requiredString(formData, 'discordRoleId'),
      rank: Number(requiredString(formData, 'rank')),
    },
    { userId: actorUserId },
    dashboardDependencies(runtime),
  );
  });
}

export async function updateStaffProfilePolicyAction(formData: FormData): Promise<void> {
  const { guildId, actorUserId, runtime } = await authorizedStaffRuntime(formData);
  const profileId = requiredString(formData, 'profileId');
  await runWithActionFeedback(`/guilds/${guildId}/staff/${profileId}`, [`/guilds/${guildId}/staff`, `/guilds/${guildId}/staff/${profileId}`], async () => {
  await requireEmergencyScopesAvailable(runtime.repositories.security, guildId, ['ROLES', 'SECURITY_CONFIG']);

  const current = await runtime.repositories.staff.getCurrentProfileVersion(guildId, profileId);
  if (current === null) {
    throw new Error('Staff Profile not found.');
  }

  await updateStaffProfilePolicy(
    {
      guildId,
      profileId,
      permissions: parsePermissions(formData, current.permissions),
      actionPolicies: parseActionPolicies(formData),
    },
    { userId: actorUserId },
    runtime.repositories,
  );

  });
}
