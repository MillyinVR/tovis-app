// lib/booking/overrideAudit.ts

import {
  BookingOverrideAction,
  BookingOverrideRule,
  Prisma,
} from '@prisma/client'
import type { ProSchedulingAppliedOverride } from '@/lib/booking/policies/proSchedulingPolicy'

type BuildBookingOverrideAuditRowsArgs = {
  bookingId: string
  professionalId: string
  actorUserId: string
  action: BookingOverrideAction | 'CREATE' | 'UPDATE'
  route: string
  reason: string
  appliedOverrides: ProSchedulingAppliedOverride[]
  bookingScheduledForBefore?: Date | null
  bookingScheduledForAfter: Date
  advanceNoticeMinutes: number
  maxDaysAhead: number
  workingHours: unknown
  timeZone: string
}

function normalizeUnknownToJson(
  value: unknown,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  if (value === null || value === undefined) return Prisma.JsonNull

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (Array.isArray(value)) {
    return value.map((item) =>
      item === undefined
        ? null
        : normalizeUnknownToJson(item) === Prisma.JsonNull
          ? null
          : (normalizeUnknownToJson(item) as Prisma.InputJsonValue),
    )
  }

  if (typeof value === 'object') {
    const out: Record<string, Prisma.InputJsonValue | null> = {}

    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (child === undefined) continue

      const normalized = normalizeUnknownToJson(child)

      out[key] =
        normalized === Prisma.JsonNull
          ? null
          : (normalized as Prisma.InputJsonValue)
    }

    return out
  }

  return {
    unsupportedType: String(typeof value),
  }
}

function normalizeAuditAction(
  action: BuildBookingOverrideAuditRowsArgs['action'],
): BookingOverrideAction {
  if (action === 'CREATE') return BookingOverrideAction.CREATE
  if (action === 'UPDATE') return BookingOverrideAction.UPDATE
  return action
}

function mapAppliedOverrideToRule(
  rule: ProSchedulingAppliedOverride,
): BookingOverrideRule {
  switch (rule) {
    case 'ADVANCE_NOTICE':
      return BookingOverrideRule.ADVANCE_NOTICE
    case 'MAX_DAYS_AHEAD':
      return BookingOverrideRule.MAX_DAYS_AHEAD
    case 'WORKING_HOURS':
      return BookingOverrideRule.WORKING_HOURS
  }
}

function buildOldValue(args: {
  rule: ProSchedulingAppliedOverride
  advanceNoticeMinutes: number
  maxDaysAhead: number
  workingHours: unknown
  timeZone: string
}): Prisma.InputJsonValue {
  switch (args.rule) {
    case 'ADVANCE_NOTICE':
      return normalizeUnknownToJson({
        allowShortNotice: false,
        advanceNoticeMinutes: args.advanceNoticeMinutes,
      }) as Prisma.InputJsonValue

    case 'MAX_DAYS_AHEAD':
      return normalizeUnknownToJson({
        allowFarFuture: false,
        maxDaysAhead: args.maxDaysAhead,
      }) as Prisma.InputJsonValue

    case 'WORKING_HOURS':
      return normalizeUnknownToJson({
        allowOutsideWorkingHours: false,
        workingHours: args.workingHours,
        timeZone: args.timeZone,
      }) as Prisma.InputJsonValue
  }
}

function buildNewValue(args: {
  rule: ProSchedulingAppliedOverride
  advanceNoticeMinutes: number
  maxDaysAhead: number
  workingHours: unknown
  timeZone: string
}): Prisma.InputJsonValue {
  switch (args.rule) {
    case 'ADVANCE_NOTICE':
      return normalizeUnknownToJson({
        allowShortNotice: true,
        advanceNoticeMinutes: args.advanceNoticeMinutes,
      }) as Prisma.InputJsonValue

    case 'MAX_DAYS_AHEAD':
      return normalizeUnknownToJson({
        allowFarFuture: true,
        maxDaysAhead: args.maxDaysAhead,
      }) as Prisma.InputJsonValue

    case 'WORKING_HOURS':
      return normalizeUnknownToJson({
        allowOutsideWorkingHours: true,
        workingHours: args.workingHours,
        timeZone: args.timeZone,
      }) as Prisma.InputJsonValue
  }
}

export function buildBookingOverrideAuditRows(
  args: BuildBookingOverrideAuditRowsArgs,
): Prisma.BookingOverrideAuditLogCreateManyInput[] {
  const normalizedReason = args.reason.trim()
  if (!normalizedReason) return []

  const normalizedAction = normalizeAuditAction(args.action)

  const uniqueRules = Array.from(new Set(args.appliedOverrides))

  return uniqueRules.map((appliedRule) => ({
    bookingId: args.bookingId,
    professionalId: args.professionalId,
    actorUserId: args.actorUserId,
    action: normalizedAction,
    rule: mapAppliedOverrideToRule(appliedRule),
    reason: normalizedReason,
    route: args.route,
    requestId: null,
    oldValue: buildOldValue({
      rule: appliedRule,
      advanceNoticeMinutes: args.advanceNoticeMinutes,
      maxDaysAhead: args.maxDaysAhead,
      workingHours: args.workingHours,
      timeZone: args.timeZone,
    }),
    newValue: buildNewValue({
      rule: appliedRule,
      advanceNoticeMinutes: args.advanceNoticeMinutes,
      maxDaysAhead: args.maxDaysAhead,
      workingHours: args.workingHours,
      timeZone: args.timeZone,
    }),
    bookingScheduledForBefore: args.bookingScheduledForBefore ?? null,
    bookingScheduledForAfter: args.bookingScheduledForAfter,
    metadata: normalizeUnknownToJson({
      source: 'booking_override_audit',
      appliedOverride: appliedRule,
      timeZone: args.timeZone,
    }),
    createdAt: new Date(),
  }))
}