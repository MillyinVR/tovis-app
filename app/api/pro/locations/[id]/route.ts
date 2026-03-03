// app/api/pro/locations/[id]/route.ts
import { prisma } from '@/lib/prisma'
import { Prisma, ProfessionalLocationType } from '@prisma/client'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { isValidIanaTimeZone } from '@/lib/timeZone'

export const dynamic = 'force-dynamic'

type JsonObject = Record<string, unknown>
type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue }

function isRecord(v: unknown): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isJsonValue(v: unknown): v is JsonValue {
  if (v === null) return true
  const t = typeof v
  if (t === 'string' || t === 'number' || t === 'boolean') return true
  if (Array.isArray(v)) return v.every(isJsonValue)
  if (isRecord(v)) return Object.values(v).every(isJsonValue)
  return false
}

async function readJsonObject(req: Request): Promise<JsonObject> {
  const raw: unknown = await req.json().catch(() => ({}))
  return isRecord(raw) ? raw : {}
}

async function readParams(ctx: { params: { id: string } | Promise<{ id: string }> }) {
  return await Promise.resolve(ctx.params)
}

function has(body: JsonObject, key: string) {
  return Object.prototype.hasOwnProperty.call(body, key)
}

function pickTrimmedString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s ? s : null
}

function pickBoolean(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null
}

function pickNumberOrNull(v: unknown): number | null | undefined {
  // undefined = invalid
  if (v === null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

function requireAddressForType(t: ProfessionalLocationType) {
  return t === ProfessionalLocationType.SALON || t === ProfessionalLocationType.SUITE
}

export async function PATCH(req: Request, ctx: { params: { id: string } | Promise<{ id: string }> }) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const { id } = await readParams(ctx)
    const locationId = (id || '').trim()
    if (!locationId) return jsonFail(400, 'Missing id')

    const body = await readJsonObject(req)

    const existing = await prisma.professionalLocation.findFirst({
      where: { id: locationId, professionalId },
      select: {
        id: true,
        type: true,
        isPrimary: true,
        isBookable: true,
        timeZone: true,
        placeId: true,
        formattedAddress: true,
        lat: true,
        lng: true,
      },
    })

    if (!existing) return jsonFail(404, 'Location not found')

    // Build patch (only apply fields explicitly present)
    const data: Prisma.ProfessionalLocationUpdateManyMutationInput = {}

    // name: allow "" to clear -> null
    if (has(body, 'name')) data.name = pickTrimmedString(body.name)

    // isPrimary: special handling
    let requestedPrimary: boolean | null = null
    if (has(body, 'isPrimary')) {
      const b = pickBoolean(body.isPrimary)
      if (b === null) return jsonFail(400, 'isPrimary must be boolean')
      requestedPrimary = b
      if (requestedPrimary === false && existing.isPrimary) {
        return jsonFail(400, 'Cannot unset primary directly. Set another location as primary instead.')
      }
      data.isPrimary = requestedPrimary
    }

    if (has(body, 'isBookable')) {
      const b = pickBoolean(body.isBookable)
      if (b === null) return jsonFail(400, 'isBookable must be boolean')
      data.isBookable = b
    }

    if (has(body, 'placeId')) data.placeId = pickTrimmedString(body.placeId)
    if (has(body, 'formattedAddress')) data.formattedAddress = pickTrimmedString(body.formattedAddress)
    if (has(body, 'city')) data.city = pickTrimmedString(body.city)
    if (has(body, 'state')) data.state = pickTrimmedString(body.state)
    if (has(body, 'postalCode')) data.postalCode = pickTrimmedString(body.postalCode)
    if (has(body, 'countryCode')) data.countryCode = pickTrimmedString(body.countryCode)

    if (has(body, 'lat')) {
      const n = pickNumberOrNull(body.lat)
      if (n === undefined) return jsonFail(400, 'lat must be a number or null')
      data.lat = n === null ? null : new Prisma.Decimal(n)
    }

    if (has(body, 'lng')) {
      const n = pickNumberOrNull(body.lng)
      if (n === undefined) return jsonFail(400, 'lng must be a number or null')
      data.lng = n === null ? null : new Prisma.Decimal(n)
    }

    if (has(body, 'timeZone')) {
      const tz = pickTrimmedString(body.timeZone)
      // allow clearing only if NOT bookable (validated below)
      data.timeZone = tz
    }

    if (has(body, 'workingHours')) {
      if (!isJsonValue(body.workingHours) || body.workingHours === null || Array.isArray(body.workingHours)) {
        return jsonFail(400, 'workingHours must be a JSON object')
      }
      data.workingHours = body.workingHours
    }

    // ---- validate merged invariants (bookable => timezone, and salon/suite => address bits) ----
    const nextIsBookable =
      typeof data.isBookable === 'boolean' ? data.isBookable : Boolean(existing.isBookable)

    const nextTimeZone =
      typeof data.timeZone === 'string' || data.timeZone === null
        ? data.timeZone
        : existing.timeZone ?? null

    const nextPlaceId =
      typeof data.placeId === 'string' || data.placeId === null ? data.placeId : existing.placeId ?? null

    const nextFormattedAddress =
      typeof data.formattedAddress === 'string' || data.formattedAddress === null
        ? data.formattedAddress
        : existing.formattedAddress ?? null

    const nextLat =
      data.lat === null
        ? null
        : data.lat instanceof Prisma.Decimal
          ? data.lat
          : existing.lat ?? null

    const nextLng =
      data.lng === null
        ? null
        : data.lng instanceof Prisma.Decimal
          ? data.lng
          : existing.lng ?? null

    if (nextIsBookable) {
      if (!nextTimeZone || !isValidIanaTimeZone(nextTimeZone)) {
        return jsonFail(400, 'Bookable locations must have a valid IANA timeZone.')
      }

      if (requireAddressForType(existing.type)) {
        if (!nextPlaceId || !nextFormattedAddress || !nextLat || !nextLng) {
          return jsonFail(400, 'Salon/Suite locations require placeId + formattedAddress + lat/lng when bookable.')
        }
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      if (requestedPrimary === true) {
        await tx.professionalLocation.updateMany({
          where: { professionalId, isPrimary: true },
          data: { isPrimary: false },
        })
      }

      const updated = await tx.professionalLocation.updateMany({
        where: { id: locationId, professionalId },
        data,
      })

      if (updated.count !== 1) return null

      return await tx.professionalLocation.findFirst({
        where: { id: locationId, professionalId },
        select: { id: true, isPrimary: true, isBookable: true, timeZone: true, type: true },
      })
    })

    if (!result) return jsonFail(404, 'Location not found')

    return jsonOk({ location: result })
  } catch (e) {
    console.error('PATCH /api/pro/locations/[id] error', e)
    const msg = e instanceof Error ? e.message : 'Failed to update location'
    return jsonFail(500, msg)
  }
}

export async function DELETE(_req: Request, ctx: { params: { id: string } | Promise<{ id: string }> }) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const { id } = await readParams(ctx)
    const locationId = (id || '').trim()
    if (!locationId) return jsonFail(400, 'Missing id')

    try {
      const deleted = await prisma.professionalLocation.deleteMany({
        where: { id: locationId, professionalId },
      })

      if (deleted.count !== 1) return jsonFail(404, 'Location not found')
      return jsonOk({})
    } catch (e) {
      // Prisma FK restrict commonly surfaces as P2003
      const err = e as { code?: unknown; message?: unknown }
      const code = typeof err.code === 'string' ? err.code : ''
      const message = typeof err.message === 'string' ? err.message : ''

      if (code === 'P2003' || message.includes('Foreign key constraint') || message.includes('violates foreign key')) {
        return jsonFail(409, 'This location is used by existing bookings and cannot be deleted.')
      }

      throw e
    }
  } catch (e) {
    console.error('DELETE /api/pro/locations/[id] error', e)
    const msg = e instanceof Error ? e.message : 'Failed to delete location'
    return jsonFail(500, msg)
  }
}