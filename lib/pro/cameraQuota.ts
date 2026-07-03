// lib/pro/cameraQuota.ts
//
// Monthly AI-camera image allowance by membership tier (see
// CAMERA_IMAGES_PER_MONTH in lib/pro/entitlements.ts). Camera images are
// analyzed in-flight and never stored, so usage is metered as a calendar-month
// Redis counter per pro — there is deliberately no DB row to count. Purchasable
// top-up credits will move this to a DB ledger; until then the counter is the
// whole story.
//
// Philosophy matches lib/rateLimit: NEVER let metering infrastructure break the
// camera. Redis missing or erroring → fail open (allow). The per-day rate-limit
// buckets (lib/rateLimit/policies.ts) stay in place as the abuse backstop.
// Enforcement is inert until ENABLE_MEMBERSHIP_ENFORCEMENT is on.

import { membershipEnforcementEnabled } from '@/lib/membership/enforcement'
import { getProCameraImageMonthlyQuota } from '@/lib/pro/entitlements'
import { getRedis } from '@/lib/redis'
import { getZonedParts } from '@/lib/time'

// Keys carry the UTC month, so a stale counter self-retires; the expiry only
// needs to outlive its month.
const QUOTA_KEY_TTL_SECONDS = 62 * 24 * 60 * 60

export type CameraQuotaDecision =
  | { allowed: true }
  | { allowed: false; used: number; quota: number }

function monthKey(now: Date): string {
  const parts = getZonedParts(now, 'UTC')
  return `${parts.year}-${String(parts.month).padStart(2, '0')}`
}

function quotaRedisKey(professionalId: string, now: Date): string {
  return `quota:pro:camera:${professionalId}:${monthKey(now)}`
}

/**
 * Whether this pro may analyze `imageCount` more images this month. Called
 * before the Anthropic request; usage is recorded separately AFTER a successful
 * analysis so failed calls never consume allowance.
 */
export async function enforceCameraImageQuota(args: {
  professionalId: string
  imageCount: number
  now?: Date
}): Promise<CameraQuotaDecision> {
  if (!membershipEnforcementEnabled()) return { allowed: true }

  const now = args.now ?? new Date()

  try {
    const redis = getRedis()
    if (redis === null) return { allowed: true }

    const [quota, rawUsed] = await Promise.all([
      getProCameraImageMonthlyQuota(args.professionalId),
      redis.get(quotaRedisKey(args.professionalId, now)),
    ])

    const used = rawUsed == null ? 0 : Math.max(0, Number(rawUsed) || 0)
    if (used + args.imageCount > quota) {
      return { allowed: false, used, quota }
    }

    return { allowed: true }
  } catch (error) {
    console.error('cameraQuota enforce failed (failing open)', error)
    return { allowed: true }
  }
}

/** Record successfully analyzed images against this month's allowance. */
export async function recordCameraImageUse(args: {
  professionalId: string
  imageCount: number
  now?: Date
}): Promise<void> {
  if (!membershipEnforcementEnabled()) return
  if (args.imageCount <= 0) return

  const now = args.now ?? new Date()

  try {
    const redis = getRedis()
    if (redis === null) return

    const key = quotaRedisKey(args.professionalId, now)
    const total = await redis.incrby(key, args.imageCount)
    if (total === args.imageCount) {
      await redis.expire(key, QUOTA_KEY_TTL_SECONDS)
    }
  } catch (error) {
    console.error('cameraQuota record failed (ignored)', error)
  }
}
