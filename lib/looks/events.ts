export const LOOK_POST_EVENT_KEYS = {
  PUBLISHED: 'LOOK_POST_PUBLISHED',
  LIKED: 'LOOK_POST_LIKED',
  COMMENTED: 'LOOK_POST_COMMENTED',
  SAVED: 'LOOK_POST_SAVED',
} as const

export type LookPostEventKey =
  (typeof LOOK_POST_EVENT_KEYS)[keyof typeof LOOK_POST_EVENT_KEYS]

type BaseLookPostEvent = {
  type: LookPostEventKey
  lookPostId: string
  professionalId: string
  actorUserId: string | null
  occurredAt: Date
}

export type LookPostPublishedEvent = BaseLookPostEvent & {
  type: typeof LOOK_POST_EVENT_KEYS.PUBLISHED
}

export type LookPostLikedEvent = BaseLookPostEvent & {
  type: typeof LOOK_POST_EVENT_KEYS.LIKED
}

export type LookPostCommentedEvent = BaseLookPostEvent & {
  type: typeof LOOK_POST_EVENT_KEYS.COMMENTED
}

export type LookPostSavedEvent = BaseLookPostEvent & {
  type: typeof LOOK_POST_EVENT_KEYS.SAVED
}

export type LookPostEvent =
  | LookPostPublishedEvent
  | LookPostLikedEvent
  | LookPostCommentedEvent
  | LookPostSavedEvent

export function createLookPostEvent(
  args: Omit<LookPostEvent, 'occurredAt'> & {
    occurredAt?: Date
  },
): LookPostEvent {
  return {
    ...args,
    actorUserId: args.actorUserId ?? null,
    occurredAt: args.occurredAt ?? new Date(),
  }
}