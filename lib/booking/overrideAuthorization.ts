// lib/booking/overrideAuthorization.ts

import {
  BookingOverridePermissionScope,
  Prisma,
  Role,
} from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { bookingError } from '@/lib/booking/errors'
import type { ProSchedulingAppliedOverride } from '@/lib/booking/policies/proSchedulingPolicy'

type AssertCanUseBookingOverrideArgs = {
  actorUserId: string
  professionalId: string
  rule: ProSchedulingAppliedOverride
}

type SupportedOverrideRule =
  | 'ADVANCE_NOTICE'
  | 'MAX_DAYS_AHEAD'
  | 'WORKING_HOURS'

const SUPPORTED_OVERRIDE_RULES: ReadonlySet<SupportedOverrideRule> = new Set([
  'ADVANCE_NOTICE',
  'MAX_DAYS_AHEAD',
  'WORKING_HOURS',
])

const OVERRIDE_AUTH_SELECT = {
  id: true,
  role: true,
  professionalProfile: {
    select: {
      id: true,
      userId: true,
    },
  },
  bookingOverridePermissionsAsActor: {
    where: {
      isActive: true,
      revokedAt: null,
    },
    select: {
      id: true,
      rule: true,
      scope: true,
      professionalId: true,
      startsAt: true,
      expiresAt: true,
    },
    take: 200,
  },
} satisfies Prisma.UserSelect

type OverrideAuthActorRecord = Prisma.UserGetPayload<{
  select: typeof OVERRIDE_AUTH_SELECT
}>

function normalizeTrimmed(value: string): string {
  return value.trim()
}

function assertNonEmptyTrimmed(value: string, fieldName: string): string {
  const normalized = normalizeTrimmed(value)
  if (normalized.length === 0) {
    throw bookingError('FORBIDDEN', {
      message: `Missing ${fieldName} for booking override.`,
      userMessage: 'You are not allowed to use booking overrides.',
    })
  }
  return normalized
}

function normalizeSupportedOverrideRule(
  rule: ProSchedulingAppliedOverride,
): SupportedOverrideRule {
  if (!SUPPORTED_OVERRIDE_RULES.has(rule as SupportedOverrideRule)) {
    throw bookingError('FORBIDDEN', {
      message: `Unsupported booking override rule: ${String(rule)}`,
      userMessage: 'That override is not allowed.',
    })
  }

  return rule as SupportedOverrideRule
}

function isPermissionCurrentlyActive(args: {
  startsAt: Date | null
  expiresAt: Date | null
  now: Date
}): boolean {
  const { startsAt, expiresAt, now } = args

  if (startsAt && startsAt.getTime() > now.getTime()) {
    return false
  }

  if (expiresAt && expiresAt.getTime() <= now.getTime()) {
    return false
  }

  return true
}

function hasMatchingPermission(args: {
  actor: OverrideAuthActorRecord
  professionalId: string
  rule: SupportedOverrideRule
  now: Date
}): boolean {
  for (const permission of args.actor.bookingOverridePermissionsAsActor) {
    if (permission.rule !== args.rule) continue

    if (
      !isPermissionCurrentlyActive({
        startsAt: permission.startsAt ?? null,
        expiresAt: permission.expiresAt ?? null,
        now: args.now,
      })
    ) {
      continue
    }

    switch (permission.scope) {
      case BookingOverridePermissionScope.ANY_PROFESSIONAL:
        return true

      case BookingOverridePermissionScope.PROFESSIONAL_TEAM:
        if (permission.professionalId === args.professionalId) {
          return true
        }
        break

      case BookingOverridePermissionScope.SELF_ONLY: {
        const actorOwnProfessionalId = args.actor.professionalProfile?.id ?? null
        const isOwnProfessional =
          actorOwnProfessionalId != null &&
          actorOwnProfessionalId === args.professionalId

        if (
          isOwnProfessional &&
          permission.professionalId === args.professionalId
        ) {
          return true
        }
        break
      }
    }
  }

  return false
}
function isActorOwnProfessional(args: {
  actor: OverrideAuthActorRecord
  professionalId: string
}): boolean {
  const actorOwnProfessionalId = args.actor.professionalProfile?.id ?? null

  return (
    actorOwnProfessionalId != null &&
    actorOwnProfessionalId === args.professionalId
  )
}
export async function assertCanUseBookingOverride(
  args: AssertCanUseBookingOverrideArgs,
): Promise<void> {
  const actorUserId = assertNonEmptyTrimmed(args.actorUserId, 'actor user id')
  const professionalId = assertNonEmptyTrimmed(
    args.professionalId,
    'professional id',
  )
  const rule = normalizeSupportedOverrideRule(args.rule)

  const actor = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: OVERRIDE_AUTH_SELECT,
  })

  if (!actor) {
    throw bookingError('FORBIDDEN', {
      message: `Actor user not found for booking override: ${actorUserId}`,
      userMessage: 'You are not allowed to use booking overrides.',
    })
  }

  /**
   * Hard fail for client users.
   * Override authority must come from a pro-side or admin-side account.
   */
  if (actor.role === Role.CLIENT) {
    throw bookingError('FORBIDDEN', {
      message: `Client users cannot use booking overrides. actorUserId=${actorUserId}`,
      userMessage: 'You are not allowed to use that override.',
    })
  }

  /**
   * A pro can schedule their own booking outside their own working hours.
   * This is not the same as bypassing advance notice or max-days-ahead rules,
   * which still require explicit override permission.
   */
  if (
    rule === 'WORKING_HOURS' &&
    actor.role === Role.PRO &&
    isActorOwnProfessional({ actor, professionalId })
  ) {
    return
  }

  const now = new Date()

  if (
    !hasMatchingPermission({
      actor,
      professionalId,
      rule,
      now,
    })
  ) {
    throw bookingError('FORBIDDEN', {
      message: [
        'Booking override permission denied.',
        `actorUserId=${actorUserId}`,
        `professionalId=${professionalId}`,
        `rule=${rule}`,
        `role=${actor.role}`,
      ].join(' '),
      userMessage: 'You are not allowed to use that override.',
    })
  }
}