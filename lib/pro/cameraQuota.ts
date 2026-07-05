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

// Manually-granted bonus images for the month (admin top-up), added on top of
// the plan quota. A parallel calendar-month counter so it self-retires with the
// month like the usage counter — the v1 of the deferred paid top-up ledger.
function bonusRedisKey(professionalId: string, now: Date): string {
  return `quota:pro:camera:bonus:${professionalId}:${monthKey(now)}`
}

function toCount(raw: unknown): number {
  return raw == null ? 0 : Math.max(0, Number(raw) || 0)
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

    const [baseQuota, rawUsed, rawBonus] = await Promise.all([
      getProCameraImageMonthlyQuota(args.professionalId),
      redis.get(quotaRedisKey(args.professionalId, now)),
      redis.get(bonusRedisKey(args.professionalId, now)),
    ])

    const used = toCount(rawUsed)
    const quota = baseQuota + toCount(rawBonus)
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

export type ProCameraUsage = {
  /** Images analyzed this month (0 while metering is off — nothing is counted). */
  used: number
  /** The plan-tier allowance (CAMERA_IMAGES_PER_MONTH). */
  baseQuota: number
  /** Admin-granted bonus images for this month. */
  bonus: number
  /** Effective allowance = baseQuota + bonus. */
  quota: number
  /** max(0, quota - used). */
  remaining: number
  /** Whether metering is active (ENABLE_MEMBERSHIP_ENFORCEMENT). */
  enforced: boolean
}

/**
 * This pro's current-month camera usage for a readout (admin panel / pro
 * status). Fails safe: Redis missing or erroring reports 0 used / 0 bonus so the
 * number is never scary, and the plan quota still comes through.
 */
export async function getProCameraUsage(args: {
  professionalId: string
  now?: Date
}): Promise<ProCameraUsage> {
  const now = args.now ?? new Date()
  const baseQuota = await getProCameraImageMonthlyQuota(args.professionalId)

  let used = 0
  let bonus = 0
  try {
    const redis = getRedis()
    if (redis !== null) {
      const [rawUsed, rawBonus] = await Promise.all([
        redis.get(quotaRedisKey(args.professionalId, now)),
        redis.get(bonusRedisKey(args.professionalId, now)),
      ])
      used = toCount(rawUsed)
      bonus = toCount(rawBonus)
    }
  } catch (error) {
    console.error('cameraQuota usage read failed (defaulting to 0)', error)
  }

  const quota = baseQuota + bonus
  return {
    used,
    baseQuota,
    bonus,
    quota,
    remaining: Math.max(0, quota - used),
    enforced: membershipEnforcementEnabled(),
  }
}

/**
 * Grant `count` bonus images for the current month (admin top-up). Increments
 * this month's bonus counter and returns the new bonus total, or null when
 * Redis is unavailable (a grant needs a live counter). v1 of the deferred paid
 * top-up ledger.
 */
export async function grantCameraBonusImages(args: {
  professionalId: string
  count: number
  now?: Date
}): Promise<number | null> {
  if (args.count <= 0) return null
  const now = args.now ?? new Date()

  try {
    const redis = getRedis()
    if (redis === null) return null

    const key = bonusRedisKey(args.professionalId, now)
    const total = await redis.incrby(key, args.count)
    await redis.expire(key, QUOTA_KEY_TTL_SECONDS)
    return total
  } catch (error) {
    console.error('cameraQuota grant bonus failed', error)
    return null
  }
}
