// lib/booking/closeoutAudit.ts
import { BookingCloseoutAuditAction, Prisma } from '@prisma/client'

type CreateBookingCloseoutAuditLogArgs = {
  tx: Prisma.TransactionClient
  bookingId: string
  professionalId: string
  actorUserId?: string | null
  action: BookingCloseoutAuditAction
  route: string
  requestId?: string | null
  idempotencyKey?: string | null
  oldValue?: Prisma.JsonValue | null
  newValue?: Prisma.JsonValue | null
  metadata?: Prisma.JsonValue | null
}

export function normalizeIdempotencyKey(value?: string | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function toInputJsonValue(value: Prisma.JsonValue): Prisma.InputJsonValue {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => (item === null ? null : toInputJsonValue(item)))
  }

  if (value === null || typeof value !== 'object') {
    return {}
  }

  const out: Record<string, Prisma.InputJsonValue | null> = {}

  for (const key of Object.keys(value)) {
    const child = value[key]
    if (child === undefined) continue
    out[key] = child === null ? null : toInputJsonValue(child)
  }

  return out
}

function toNullableJsonCreateInput(
  value: Prisma.JsonValue | null | undefined,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  if (value === undefined) return undefined
  if (value === null) return Prisma.JsonNull
  return toInputJsonValue(value)
}

function sortAuditValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Prisma.Decimal) return value.toFixed(2)

  if (Array.isArray(value)) {
    return value.map((item) => sortAuditValue(item))
  }

  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'object') {
    return value
  }

  const record = value as Record<string, unknown>
  const out: Record<string, unknown> = {}

  for (const key of Object.keys(record).sort()) {
    const child = record[key]
    if (child === undefined) continue
    out[key] = sortAuditValue(child)
  }

  return out
}

export function areAuditValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(sortAuditValue(left)) === JSON.stringify(sortAuditValue(right))
}

function mergeAuditMetadata(
  metadata: Prisma.JsonValue | null | undefined,
): Prisma.JsonObject {
  const base: Prisma.JsonObject = {
    source: 'booking_closeout_audit',
  }

  if (
    metadata &&
    typeof metadata === 'object' &&
    !Array.isArray(metadata)
  ) {
    return {
      ...base,
      ...metadata,
    }
  }

  return base
}

export async function createBookingCloseoutAuditLog(
  args: CreateBookingCloseoutAuditLogArgs,
): Promise<void> {
  await args.tx.bookingCloseoutAuditLog.create({
    data: {
      bookingId: args.bookingId,
      professionalId: args.professionalId,
      actorUserId: args.actorUserId ?? null,
      action: args.action,
      route: args.route,
      requestId: normalizeIdempotencyKey(args.requestId),
      idempotencyKey: normalizeIdempotencyKey(args.idempotencyKey),
      oldValue: toNullableJsonCreateInput(args.oldValue ?? null),
      newValue: toNullableJsonCreateInput(args.newValue ?? null),
      metadata: toNullableJsonCreateInput(mergeAuditMetadata(args.metadata)),
    },
  })
}