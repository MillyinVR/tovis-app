// lib/live/broadcastAudience.ts
//
// Audience resolution for live-sync Layer 2. Call sites name WHO changed (a
// professional, some users); this module turns that into channel names and
// hands them to broadcastLive(). One rule, one place — so a new pro-facing
// event can never reach half the pro's devices.
//
// A pro's audience is TWO channels, not one:
//   pro:{professionalId} — the web pro shell, which is server-rendered and so
//                          knows the professional PROFILE id.
//   user:{proUserId}     — the pro's own devices. The iOS app builds its
//                          channel list from the session JWT, which carries
//                          `userId` and no profile id (TovisKit's SessionToken
//                          reads userId/role/sessionKind only), so it subscribes
//                          to `user:{userId}` and nothing else. Every `pro:`
//                          ping was therefore inaudible on the phone. Resolving
//                          the pro's userId here fixes every pro-facing live
//                          event for iOS at once — no new token claim, no extra
//                          client round-trip, no DTO change.
//
// Fail-open throughout: this runs AFTER the write has committed, so a lookup or
// network failure must never surface to the caller. Losing a ping costs
// freshness, never correctness — the next load/poll/focus still reads truth.
import 'server-only'

import { prisma } from '@/lib/prisma'
import { safeError } from '@/lib/security/logging'

import {
  broadcastLive,
  liveChannelForPro,
  liveChannelForUser,
  type LiveTopic,
} from './broadcast'

/** The professional's own user id, or null when unknown/unresolvable. */
async function professionalUserId(
  professionalId: string,
): Promise<string | null> {
  try {
    const profile = await prisma.professionalProfile.findUnique({
      where: { id: professionalId },
      select: { userId: true },
    })

    return profile?.userId ?? null
  } catch (error: unknown) {
    console.warn('professionalUserId lookup failed', {
      error: safeError(error),
    })

    return null
  }
}

/**
 * Every channel that carries a change owned by this professional — the salon
 * channel plus the pro's own user channel. Degrades to just the salon channel
 * when the profile can't be resolved.
 */
export async function liveChannelsForProfessional(
  professionalId: string | null | undefined,
): Promise<string[]> {
  if (!professionalId) return []

  const userId = await professionalUserId(professionalId)

  return [liveChannelForPro(professionalId), liveChannelForUser(userId)].filter(
    (channel): channel is string => Boolean(channel),
  )
}

/**
 * Notify a professional's devices and/or specific users that something changed.
 * Deduplicates channels (a pro acting on their own booking resolves to the same
 * user channel twice) and never throws.
 */
export async function broadcastChange(args: {
  topic: LiveTopic
  professionalId?: string | null
  userIds?: Array<string | null | undefined>
}): Promise<void> {
  try {
    const proChannels = await liveChannelsForProfessional(args.professionalId)
    const userChannels = (args.userIds ?? []).map((id) => liveChannelForUser(id))

    const channels = Array.from(
      new Set(
        [...proChannels, ...userChannels].filter((channel): channel is string =>
          Boolean(channel),
        ),
      ),
    )

    await broadcastLive(channels, args.topic)
  } catch (error: unknown) {
    console.warn('broadcastChange failed', { error: safeError(error) })
  }
}
