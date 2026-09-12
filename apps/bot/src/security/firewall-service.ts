import type { InventoryTrustState, SecurityRepository } from '@knight/database';
import type { DiscordActionPort } from '@knight/discord';
import type { SecurityRecorder } from './security-recorder.js';

export type FirewallResult = Readonly<{ observed: number; removed: number }>;

function inventoryTrustState(value: string | undefined): InventoryTrustState {
  if (value === undefined) return 'UNKNOWN';
  if (value === 'TRUSTED' || value === 'APPROVED' || value === 'UNKNOWN' || value === 'BLOCKED') {
    return value;
  }
  throw new Error('Invalid persisted firewall trust state');
}

export type FirewallServiceDependencies = Readonly<{
  security: Pick<
    SecurityRepository,
    | 'getFirewallSettings'
    | 'getBotInventory'
    | 'upsertBotInventory'
    | 'getWebhookInventory'
    | 'upsertWebhookInventory'
    | 'recordEvent'
  >;
  discord: Pick<DiscordActionPort, 'kickMember' | 'listChannelWebhooks' | 'deleteWebhook'>;
  recorder: Pick<SecurityRecorder, 'record'>;
  now: () => Date;
}>;

export class FirewallService {
  public constructor(private readonly dependencies: FirewallServiceDependencies) {}

  private async notify(input: {
    guildId: string;
    severity: 'MEDIUM' | 'HIGH';
    action: string;
    targetId: string;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    await this.dependencies.recorder.record(
      {
        ...input,
        source: 'KNIGHT',
        actorUserId: null,
        decisionId: null,
        incidentId: null,
      },
      'SECURITY',
    );
  }

  private async recordRemovalFailure(input: {
    guildId: string;
    action: string;
    targetType: 'BOT' | 'WEBHOOK';
    targetId: string;
  }): Promise<void> {
    const occurredAt = this.dependencies.now();
    await this.dependencies.security.recordEvent({
      guildId: input.guildId,
      source: 'KNIGHT',
      action: input.action,
      actorUserId: null,
      targetType: input.targetType,
      targetId: input.targetId,
      auditLogId: null,
      executionId: null,
      incidentId: null,
      metadata: { outcome: 'REMOVAL_FAILED' },
      occurredAt,
    });
    await this.notify({
      guildId: input.guildId,
      severity: 'HIGH',
      action: input.action,
      targetId: input.targetId,
      metadata: { outcome: 'REMOVAL_FAILED' },
    });
  }

  public async handleBotJoin(guildId: string, botUserId: string): Promise<FirewallResult> {
    const [settings, existing] = await Promise.all([
      this.dependencies.security.getFirewallSettings(guildId),
      this.dependencies.security.getBotInventory(guildId, botUserId),
    ]);
    const trustState = inventoryTrustState(existing?.trustState);
    await this.dependencies.security.upsertBotInventory({
      guildId,
      botUserId,
      trustState,
      invitedByUserId: existing?.invitedByUserId ?? null,
      seenAt: this.dependencies.now(),
    });

    if (settings.botMode === 'OBSERVE') return { observed: 1, removed: 0 };
    await this.notify({
      guildId,
      severity: 'MEDIUM',
      action: 'firewall.bot.alert',
      targetId: botUserId,
      metadata: { mode: settings.botMode, trustState },
    });
    if (settings.botMode !== 'ENFORCE' || trustState !== 'BLOCKED') {
      return { observed: 1, removed: 0 };
    }

    try {
      await this.dependencies.discord.kickMember({
        guildId,
        targetUserId: botUserId,
        reason: 'Explicitly blocked by Knight bot firewall',
      });
      return { observed: 1, removed: 1 };
    } catch {
      await this.recordRemovalFailure({
        guildId,
        action: 'firewall.bot.removal_failed',
        targetType: 'BOT',
        targetId: botUserId,
      });
      return { observed: 1, removed: 0 };
    }
  }

  public async handleWebhookUpdate(guildId: string, channelId: string): Promise<FirewallResult> {
    const [settings, webhooks] = await Promise.all([
      this.dependencies.security.getFirewallSettings(guildId),
      this.dependencies.discord.listChannelWebhooks(channelId),
    ]);
    let removed = 0;
    for (const webhook of webhooks) {
      const existing = await this.dependencies.security.getWebhookInventory(
        guildId,
        webhook.webhookId,
      );
      const trustState = inventoryTrustState(existing?.trustState);
      await this.dependencies.security.upsertWebhookInventory({
        guildId,
        webhookId: webhook.webhookId,
        channelId: webhook.channelId,
        trustState,
        seenAt: this.dependencies.now(),
      });
      if (settings.webhookMode !== 'OBSERVE') {
        await this.notify({
          guildId,
          severity: 'MEDIUM',
          action: 'firewall.webhook.alert',
          targetId: webhook.webhookId,
          metadata: { mode: settings.webhookMode, trustState, channelId },
        });
      }
      if (settings.webhookMode !== 'ENFORCE' || trustState !== 'BLOCKED') continue;
      try {
        await this.dependencies.discord.deleteWebhook(
          webhook.webhookId,
          'Explicitly blocked by Knight webhook firewall',
        );
        removed += 1;
      } catch {
        await this.recordRemovalFailure({
          guildId,
          action: 'firewall.webhook.removal_failed',
          targetType: 'WEBHOOK',
          targetId: webhook.webhookId,
        });
      }
    }
    return { observed: webhooks.length, removed };
  }
}
