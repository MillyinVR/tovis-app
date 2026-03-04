// app/api/pro/locations/[id]/route.ts
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma, ProfessionalLocationType } from '@prisma/client'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { pickBool, pickNumber, pickString } from '@/lib/pick'
import { isValidIanaTimeZone } from '@/lib/timeZone'
import { isRecord, type UnknownRecord, hasOwn } from '@/lib/guards'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue }

function isJsonValue(v: unknown): v is JsonValue {
  if (v === null) return true
  const t = typeof v
  if (t === 'string' || t === 'number' || t === 'boolean') return true
  if (Array.isArray(v)) return v.every(isJsonValue)
  if (isRecord(v)) return Object.values(v).every(isJsonValue)
  return false
}

async function readParams(ctx: Params) {
  return await ctx.params
}

function requireAddressForType(t: ProfessionalLocationType) {
  return t === ProfessionalLocationType.SALON || t === ProfessionalLocationType.SUITE
}

export async function PATCH(req: NextRequest, ctx: Params) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const { id } = await readParams(ctx)
    const locationId = pickString(id)
    if (!locationId) return jsonFail(400, 'Missing id')

    const raw: unknown = await req.json().catch(() => ({}))
    const body: UnknownRecord = isRecord(raw) ? raw : {}

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

    const data: Prisma.ProfessionalLocationUpdateManyMutationInput = {}

    if (hasOwn(body, 'name')) data.name = pickString(body.name)

    let requestedPrimary: boolean | null = null
    if (hasOwn(body, 'isPrimary')) {
      const b = pickBool(body.isPrimary)
      if (b === null) return jsonFail(400, 'isPrimary must be boolean')
      requestedPrimary = b
      if (requestedPrimary === false && existing.isPrimary) {
        return jsonFail(400, 'Cannot unset primary directly. Set another location as primary instead.')
      }
      data.isPrimary = requestedPrimary
    }

    if (hasOwn(body, 'isBookable')) {
      const b = pickBool(body.isBookable)
      if (b === null) return jsonFail(400, 'isBookable must be boolean')
      data.isBookable = b
    }

    if (hasOwn(body, 'placeId')) data.placeId = pickString(body.placeId)
    if (hasOwn(body, 'formattedAddress')) data.formattedAddress = pickString(body.formattedAddress)
    if (hasOwn(body, 'city')) data.city = pickString(body.city)
    if (hasOwn(body, 'state')) data.state = pickString(body.state)
    if (hasOwn(body, 'postalCode')) data.postalCode = pickString(body.postalCode)
    if (hasOwn(body, 'countryCode')) data.countryCode = pickString(body.countryCode)

    if (hasOwn(body, 'lat')) {
      if (body.lat === null) data.lat = null
      else {
        const n = pickNumber(body.lat)
        if (n == null) return jsonFail(400, 'lat must be a number or null')
        data.lat = new Prisma.Decimal(String(n))
      }
    }

    if (hasOwn(body, 'lng')) {
      if (body.lng === null) data.lng = null
      else {
        const n = pickNumber(body.lng)
        if (n == null) return jsonFail(400, 'lng must be a number or null')
        data.lng = new Prisma.Decimal(String(n))
      }
    }

    if (hasOwn(body, 'timeZone')) {
      data.timeZone = pickString(body.timeZone)
    }

    if (hasOwn(body, 'workingHours')) {
      const wh = body.workingHours
      if (!isJsonValue(wh) || wh === null || Array.isArray(wh) || !isRecord(wh)) {
        return jsonFail(400, 'workingHours must be a JSON object')
      }
      data.workingHours = wh
    }

    const nextIsBookable = typeof data.isBookable === 'boolean' ? data.isBookable : Boolean(existing.isBookable)

    const nextTimeZone =
      typeof data.timeZone === 'string' || data.timeZone === null ? data.timeZone : existing.timeZone ?? null

    const nextPlaceId =
      typeof data.placeId === 'string' || data.placeId === null ? data.placeId : existing.placeId ?? null

    const nextFormattedAddress =
      typeof data.formattedAddress === 'string' || data.formattedAddress === null
        ? data.formattedAddress
        : existing.formattedAddress ?? null

    const nextLat =
      data.lat === null ? null : data.lat instanceof Prisma.Decimal ? data.lat : existing.lat ?? null

    const nextLng =
      data.lng === null ? null : data.lng instanceof Prisma.Decimal ? data.lng : existing.lng ?? null

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

export async function DELETE(_req: NextRequest, ctx: Params) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const { id } = await readParams(ctx)
    const locationId = pickString(id)
    if (!locationId) return jsonFail(400, 'Missing id')

    try {
      const deleted = await prisma.professionalLocation.deleteMany({
        where: { id: locationId, professionalId },
      })

      if (deleted.count !== 1) return jsonFail(404, 'Location not found')
      return jsonOk({})
    } catch (e: unknown) {
      const code = isRecord(e) ? pickString((e as Record<string, unknown>).code) : null
      const message =
        e instanceof Error ? e.message : isRecord(e) ? pickString((e as Record<string, unknown>).message) : null

      if (
        code === 'P2003' ||
        (message && (message.includes('Foreign key constraint') || message.includes('violates foreign key')))
      ) {
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