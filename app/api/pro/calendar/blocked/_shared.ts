// app/api/pro/calendar/blocked/_shared.ts 

import { Prisma } from '@prisma/client'

const MIN_BLOCK_MINUTES = 15
const MAX_BLOCK_MINUTES = 24 * 60
const MAX_RANGE_DAYS = 180
const MAX_NOTE_LENGTH = 500

export type BlockDto = {
  id: string
  startsAt: string
  endsAt: string
  note: string | null
  locationId: string | null
}

export function trimString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  return trimmed ? trimmed : null
}

export function toDateOrNull(v: unknown): Date | null {
  const s = trimString(v)
  if (!s) return null

  const d = new Date(s)
  return Number.isFinite(d.getTime()) ? d : null
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60_000)
}

export function validateBlockWindow(startsAt: Date, endsAt: Date): string | null {
  if (endsAt <= startsAt) {
    return 'End must be after start.'
  }

  const durationMinutes = minutesBetween(startsAt, endsAt)
  if (durationMinutes < MIN_BLOCK_MINUTES || durationMinutes > MAX_BLOCK_MINUTES) {
    return 'Block must be between 15 minutes and 24 hours.'
  }

  return null
}

export function clampRange(from: Date, to: Date): { from: Date; to: Date } {
  const maxMs = MAX_RANGE_DAYS * 24 * 60 * 60_000
  const currentMs = to.getTime() - from.getTime()

  if (currentMs <= maxMs) {
    return { from, to }
  }

  return {
    from,
    to: new Date(from.getTime() + maxMs),
  }
}

export function parseNoteInput(
  v: unknown,
  mode: 'post' | 'patch',
): { ok: true; isSet: boolean; value: string | null } | { ok: false } {
  if (v === undefined) {
    return mode === 'patch'
      ? { ok: true, isSet: false, value: null }
      : { ok: true, isSet: true, value: null }
  }

  if (v === null) {
    return { ok: true, isSet: true, value: null }
  }

  if (typeof v !== 'string') {
    return { ok: false }
  }

  const trimmed = v.trim()
  if (!trimmed) {
    return { ok: true, isSet: true, value: null }
  }

  return {
    ok: true,
    isSet: true,
    value: trimmed.slice(0, MAX_NOTE_LENGTH),
  }
}

export function parseLocationIdInput(v: unknown): { ok: true; value: string | null } | { ok: false } {
  if (v === undefined || v === null) {
    return { ok: true, value: null }
  }

  if (typeof v !== 'string') {
    return { ok: false }
  }

  const trimmed = v.trim()
  return { ok: true, value: trimmed || null }
}

export function buildBlockConflictWhere(args: {
  professionalId: string
  startsAt: Date
  endsAt: Date
  locationId: string | null
  excludeBlockId?: string
}): Prisma.CalendarBlockWhereInput {
  const { professionalId, startsAt, endsAt, locationId, excludeBlockId } = args

  const base: Prisma.CalendarBlockWhereInput = {
    professionalId,
    startsAt: { lt: endsAt },
    endsAt: { gt: startsAt },
    ...(excludeBlockId ? { id: { not: excludeBlockId } } : {}),
  }

  if (locationId) {
    return {
      ...base,
      OR: [{ locationId }, { locationId: null }],
    }
  }

  return base
}

export function toBlockDto(block: {
  id: string
  startsAt: Date
  endsAt: Date
  note: string | null
  locationId: string | null
}): BlockDto {
  return {
    id: block.id,
    startsAt: block.startsAt.toISOString(),
    endsAt: block.endsAt.toISOString(),
    note: block.note ?? null,
    locationId: block.locationId ?? null,
  }
}