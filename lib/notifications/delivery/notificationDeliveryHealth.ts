// lib/notifications/delivery/notificationDeliveryHealth.ts
//
// Read-only health snapshot of the notification delivery queue, so a stuck cron
// or a spike of provider failures is caught proactively (alerting) instead of by
// a client reporting "I never got the text." Pure-ish: pass `now`/`db` for tests.
import { Errors } from 'apns2'
import { NotificationDeliveryStatus } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import {
  APNS_INVALID_PRIVATE_KEY_MESSAGE,
  readApnsConfigOutcome,
} from '@/lib/notifications/config'

// A delivery still PENDING/PROCESSING this long past its nextAttemptAt means the
// worker isn't draining (the cron runs every minute, so nothing should be this
// far overdue under normal operation).
export const STUCK_OVERDUE_MINUTES = 15
// FAILED_FINAL is terminal; a handful from bad addresses is normal, a spike is
// not. Window for both this and the status breakdown.
export const HEALTH_WINDOW_MINUTES = 60
export const FAILED_FINAL_ALERT_THRESHOLD = 10

/**
 * FAILED_RETRYABLE spike threshold.
 *
 * This exists because the two checks above were BLIND to a total push outage:
 * every failing delivery was FAILED_RETRYABLE (never terminal, so
 * failedFinalCount stayed 0) and none were PENDING/PROCESSING (so stuckCount
 * stayed 0). Push was dead for weeks and this probe reported healthy the entire
 * time.
 *
 * Threshold derived from 30 days of production, not guessed: 17 retryable
 * failures total across 5 distinct hours — a normal hour sees 1–2 — while the
 * outage hour produced 11. Five per window sits clear of the noise and would
 * have caught it. Revisit as real volume grows; at higher throughput this wants
 * to become a rate rather than a count.
 */
export const FAILED_RETRYABLE_ALERT_THRESHOLD = 5

/**
 * Error codes that mean APNs REJECTED our provider credentials — the key, key id
 * and team id are all present and the key is a real EC key, so every env-side
 * check passes, but Apple refuses everything we sign. Derived from apns2's own
 * reason strings rather than retyped, so a library rename can't silently empty
 * this set.
 *
 * Excluded on purpose: ExpiredProviderToken (apns2 drops its cached JWT and the
 * next attempt succeeds) and TooManyProviderTokenUpdates (a rate limit). Both are
 * transient and would cry wolf.
 *
 * Counted separately from the volume thresholds above because volume is exactly
 * what this failure lacks. It surfaced in production as 26 terminal failures only
 * because one phone had 13 stale device tokens; with the fan-out fixed to one
 * send per install, the SAME total outage produces ~1 failure per notification
 * and would sit far under FAILED_FINAL_ALERT_THRESHOLD forever. A credential
 * rejection is unhealthy at a count of one.
 */
export const APNS_CREDENTIAL_REJECTED_ERROR_CODES: readonly string[] = [
  Errors.invalidProviderToken,
  Errors.missingProviderToken,
  Errors.invalidSigningKey,
  // Our own code, when the provider refused to build a client at all.
  'PUSH_PROVIDER_MISCONFIGURED',
]

export const APNS_CREDENTIAL_REJECTED_MESSAGE =
  'APNs rejected the provider credentials (InvalidProviderToken): the .p8 parses, but Apple will not accept anything signed with it. Check that APNS_KEY_ID names the key currently in APNS_AUTH_KEY, that APNS_TEAM_ID owns that key, that the key has not been revoked, and — if it is a topic-restricted key — that APNS_BUNDLE_ID is one of its allowed app IDs. This is NOT a sandbox/production mismatch; that fails as BadDeviceToken.'

export type NotificationDeliveryHealth = {
  healthy: boolean
  generatedAt: string
  windowMinutes: number
  countsByStatus: Record<string, number>
  stuckCount: number
  failedFinalCount: number
  failedRetryableCount: number
  /** Deliveries the provider refused because OUR credentials were rejected. */
  credentialRejectedCount: number
  topErrorCodes: { code: string; count: number }[]
  /** Provider credentials that are present but unusable. */
  providerConfigIssues: string[]
  reasons: string[]
}

/**
 * Credentials that are set but cannot work. Distinct from "not configured":
 * an absent provider is a deliberate state, whereas a present-but-broken one
 * silently swallows every notification routed to it.
 */
function collectProviderConfigIssues(args: {
  credentialRejectedCount: number
}): string[] {
  const issues: string[] = []

  if (readApnsConfigOutcome().problem === 'INVALID_PRIVATE_KEY') {
    issues.push(APNS_INVALID_PRIVATE_KEY_MESSAGE)
  }

  // The env-side check above can only see the shape of the key. Whether Apple
  // ACCEPTS it is knowable only from what the wire said, so read it back off the
  // deliveries.
  if (args.credentialRejectedCount > 0) {
    issues.push(
      `${args.credentialRejectedCount} push delivery(s) rejected: ${APNS_CREDENTIAL_REJECTED_MESSAGE}`,
    )
  }

  return issues
}

export async function evaluateNotificationDeliveryHealth(args?: {
  now?: Date
  windowMinutes?: number
  overdueMinutes?: number
}): Promise<NotificationDeliveryHealth> {
  const now = args?.now ?? new Date()
  const windowMinutes = args?.windowMinutes ?? HEALTH_WINDOW_MINUTES
  const overdueMinutes = args?.overdueMinutes ?? STUCK_OVERDUE_MINUTES

  const windowStart = new Date(now.getTime() - windowMinutes * 60_000)
  const overdueBefore = new Date(now.getTime() - overdueMinutes * 60_000)

  const [byStatus, stuckCount, errorGroups, credentialRejectedCount] =
    await Promise.all([
      prisma.notificationDelivery.groupBy({
        by: ['status'],
        where: { createdAt: { gte: windowStart } },
        _count: { _all: true },
      }),
      prisma.notificationDelivery.count({
        where: {
          status: {
            in: [
              NotificationDeliveryStatus.PENDING,
              NotificationDeliveryStatus.PROCESSING,
            ],
          },
          nextAttemptAt: { lt: overdueBefore },
        },
      }),
      prisma.notificationDelivery.groupBy({
        by: ['lastErrorCode'],
        where: {
          createdAt: { gte: windowStart },
          status: {
            in: [
              NotificationDeliveryStatus.FAILED_RETRYABLE,
              NotificationDeliveryStatus.FAILED_FINAL,
            ],
          },
          lastErrorCode: { not: null },
        },
        _count: { _all: true },
        orderBy: { _count: { lastErrorCode: 'desc' } },
        take: 5,
      }),
      prisma.notificationDelivery.count({
        where: {
          createdAt: { gte: windowStart },
          lastErrorCode: { in: [...APNS_CREDENTIAL_REJECTED_ERROR_CODES] },
        },
      }),
    ])

  const countsByStatus: Record<string, number> = {}
  for (const row of byStatus) {
    countsByStatus[row.status] = row._count._all
  }

  const failedFinalCount =
    countsByStatus[NotificationDeliveryStatus.FAILED_FINAL] ?? 0
  const failedRetryableCount =
    countsByStatus[NotificationDeliveryStatus.FAILED_RETRYABLE] ?? 0

  const topErrorCodes = errorGroups
    .map((row) => ({
      code: row.lastErrorCode ?? 'UNKNOWN',
      count: row._count._all,
    }))
    .filter((row) => row.count > 0)

  const providerConfigIssues = collectProviderConfigIssues({
    credentialRejectedCount,
  })

  const reasons: string[] = []
  if (stuckCount > 0) {
    reasons.push(
      `${stuckCount} delivery(s) overdue by >${overdueMinutes}m (worker not draining)`,
    )
  }
  if (failedFinalCount > FAILED_FINAL_ALERT_THRESHOLD) {
    reasons.push(
      `${failedFinalCount} terminal failures in the last ${windowMinutes}m`,
    )
  }
  if (failedRetryableCount > FAILED_RETRYABLE_ALERT_THRESHOLD) {
    reasons.push(
      `${failedRetryableCount} retryable failures in the last ${windowMinutes}m (a provider is failing every send)`,
    )
  }
  for (const issue of providerConfigIssues) {
    reasons.push(issue)
  }

  return {
    healthy: reasons.length === 0,
    generatedAt: now.toISOString(),
    windowMinutes,
    countsByStatus,
    stuckCount,
    failedFinalCount,
    failedRetryableCount,
    credentialRejectedCount,
    topErrorCodes,
    providerConfigIssues,
    reasons,
  }
}
