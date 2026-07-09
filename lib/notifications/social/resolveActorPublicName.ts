import { Prisma, PrismaClient } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import {
  pickProfessionalPublicDisplayName,
  professionalPublicDisplayNameSelect,
} from '@/lib/privacy/professionalDisplayName'
import { pickClientPublicHandle } from '@/lib/profiles/publicProfileFormatting'

type Db = PrismaClient | Prisma.TransactionClient

/**
 * Public display name for a Looks-social actor, resolved at EMIT time so the
 * personalized title survives on PUSH — which, unlike the in-app activity feed,
 * cannot resolve an actor id at render time.
 *
 * PRO actors resolve to their opted-in public display name; CLIENT actors
 * resolve to their public `@handle` ONLY when their profile is public — never a
 * legal name. Returns `null` when no public identity is available, so callers
 * keep their existing name-free copy (the "strangers never see a legal name"
 * guarantee is preserved).
 *
 * Best-effort by design: these emits run post-commit and must never throw, so
 * any read failure resolves to `null` (→ the name-free fallback).
 */
export async function resolveLookActorPublicName(
  identity: {
    professionalProfileId: string | null
    clientProfileId: string | null
  },
  db: Db = prisma,
): Promise<string | null> {
  try {
    if (identity.professionalProfileId) {
      const pro = await db.professionalProfile.findUnique({
        where: { id: identity.professionalProfileId },
        select: professionalPublicDisplayNameSelect,
      })
      return pro ? pickProfessionalPublicDisplayName(pro) : null
    }

    if (identity.clientProfileId) {
      const client = await db.clientProfile.findUnique({
        where: { id: identity.clientProfileId },
        select: { handle: true, isPublicProfile: true },
      })
      return client ? pickClientPublicHandle(client) : null
    }

    return null
  } catch {
    return null
  }
}

/**
 * Batch form of {@link resolveUserActorPublicName}. Resolves each distinct User
 * id to its PUBLIC display name (pro opted-in identity or public client
 * `@handle`), or `null` when none is available. Returns a map keyed by the
 * (trimmed) User id; ids that resolve to no public identity are simply absent
 * (callers treat a miss as `null`). Best-effort by design — a read failure
 * yields an empty map so callers fall back to their name-free copy.
 */
export async function resolveUserPublicNames(
  userIds: readonly string[],
  db: Db = prisma,
): Promise<Map<string, string | null>> {
  const resolved = new Map<string, string | null>()
  const distinct = [
    ...new Set(userIds.map((id) => id.trim()).filter((id) => id.length > 0)),
  ]
  if (distinct.length === 0) return resolved

  try {
    const users = await db.user.findMany({
      where: { id: { in: distinct } },
      select: {
        id: true,
        professionalProfile: { select: professionalPublicDisplayNameSelect },
        clientProfile: { select: { handle: true, isPublicProfile: true } },
      },
    })

    for (const user of users) {
      const name = user.professionalProfile
        ? pickProfessionalPublicDisplayName(user.professionalProfile)
        : user.clientProfile
          ? pickClientPublicHandle(user.clientProfile)
          : null
      resolved.set(user.id, name)
    }
  } catch {
    return new Map()
  }

  return resolved
}

/**
 * LOOK_FOLLOWER_NEW carries only the follower's User id. Resolve to the user's
 * pro public display name (their opted-in identity) or public client `@handle`,
 * else `null`. Same PUBLIC-only, never-legal-name, best-effort contract as
 * {@link resolveLookActorPublicName}.
 */
export async function resolveUserActorPublicName(
  userId: string,
  db: Db = prisma,
): Promise<string | null> {
  const resolved = await resolveUserPublicNames([userId], db)
  return resolved.get(userId.trim()) ?? null
}
