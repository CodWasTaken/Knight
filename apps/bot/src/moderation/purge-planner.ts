import type { DiscordMessageState } from '@knight/discord';

export type PurgeAuthorState = Readonly<{
  userId: string;
  isGuildOwner: boolean;
  knightRank: number | null;
  elevatedUnregistered: boolean;
}>;

export type PurgePlan = Readonly<{
  deletableIds: readonly string[];
  protectedIds: readonly string[];
  ineligibleIds: readonly string[];
}>;

export function planPurge(input: {
  messages: readonly DiscordMessageState[];
  authors: ReadonlyMap<string, PurgeAuthorState>;
  actorRank: number | null;
  actorIsGuildOwner: boolean;
  targetUserId?: string | null;
}): PurgePlan {
  const deletableIds: string[] = [];
  const protectedIds: string[] = [];
  const ineligibleIds: string[] = [];

  for (const message of input.messages) {
    if (input.targetUserId != null && message.authorUserId !== input.targetUserId) continue;
    if (!message.bulkDeletable) {
      ineligibleIds.push(message.messageId);
      continue;
    }

    const author = input.authors.get(message.authorUserId);
    if (author === undefined) {
      protectedIds.push(message.messageId);
      continue;
    }

    const rankProtected =
      !input.actorIsGuildOwner &&
      author.knightRank !== null &&
      (input.actorRank === null || author.knightRank >= input.actorRank);
    const protectedAuthor =
      author.isGuildOwner ||
      (!input.actorIsGuildOwner && author.elevatedUnregistered) ||
      rankProtected;

    if (protectedAuthor) protectedIds.push(message.messageId);
    else deletableIds.push(message.messageId);
  }

  return { deletableIds, protectedIds, ineligibleIds };
}
