// lib/search/contracts.ts
import type { ProfessionType } from '@prisma/client'

export class SearchRequestError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'SearchRequestError'
    this.status = status
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function pickNonEmptyString(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function normalizeOptionalId(
  value: string | null | undefined,
): string | null {
  return pickNonEmptyString(value)
}

export function parseBooleanParam(
  value: string | null | undefined,
): boolean {
  const normalized = (value ?? '').trim().toLowerCase()

  return (
    normalized === '1' ||
    normalized === 'true' ||
    normalized === 'yes' ||
    normalized === 'on'
  )
}

export function pickFiniteNumber(
  value: string | null | undefined,
): number | null {
  const raw = pickNonEmptyString(value)
  if (!raw) return null

  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

export function clampInt(
  value: number,
  min: number,
  max: number,
): number {
  return Math.max(min, Math.min(max, Math.trunc(value)))
}

export function parseLimit(
  raw: string | null | undefined,
  args: { defaultValue: number; max: number },
): number {
  const parsed = pickFiniteNumber(raw)
  if (parsed == null) return args.defaultValue

  return clampInt(parsed, 1, args.max)
}

export function decodeIdCursor(
  raw: string | null | undefined,
): string | null {
  const token = pickNonEmptyString(raw)
  if (!token) return null

  try {
    const decoded = JSON.parse(
      Buffer.from(token, 'base64url').toString('utf8'),
    ) as unknown

    if (!isRecord(decoded)) return null

    return pickNonEmptyString(
      typeof decoded.id === 'string' ? decoded.id : null,
    )
  } catch {
    return null
  }
}

export function encodeIdCursor(id: string): string {
  return Buffer.from(JSON.stringify({ id }), 'utf8').toString(
    'base64url',
  )
}

export function paginateByCursor<T extends { id: string }>(
  items: readonly T[],
  args: { cursorId: string | null; limit: number },
): { items: T[]; nextCursor: string | null } {
  const startIndex = args.cursorId
    ? Math.max(
        0,
        items.findIndex((item) => item.id === args.cursorId) + 1,
      )
    : 0

  const page = items.slice(startIndex, startIndex + args.limit + 1)
  const hasMore = page.length > args.limit
  const visible = hasMore ? page.slice(0, args.limit) : page

  return {
    items: [...visible],
    nextCursor:
      hasMore && visible.length > 0
        ? encodeIdCursor(visible[visible.length - 1].id)
        : null,
  }
}

export type SearchProLocationPreviewDto = {
  id: string
  formattedAddress: string | null
  city: string | null
  state: string | null
  timeZone: string | null
  placeId: string | null
  lat: number | null
  lng: number | null
  isPrimary: boolean
}

export type SearchProItemDto = {
  id: string
  businessName: string | null
  handle: string | null
  professionType: ProfessionType | null
  avatarUrl: string | null
  locationLabel: string | null
  distanceMiles: number | null
  ratingAvg: number | null
  ratingCount: number
  minPrice: number | null
  supportsMobile: boolean
  closestLocation: SearchProLocationPreviewDto | null
  primaryLocation: SearchProLocationPreviewDto | null
}

export type SearchProsResponseDto = {
  items: SearchProItemDto[]
  nextCursor: string | null
}

export type SearchServiceItemDto = {
  id: string
  name: string
  categoryId: string | null
  categoryName: string | null
  categorySlug: string | null
}

export type SearchServicesResponseDto = {
  items: SearchServiceItemDto[]
  nextCursor: string | null
}