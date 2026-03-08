// app/api/client/addresses/[id]/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import { ClientAddressKind, Prisma } from '@prisma/client'
import { isRecord } from '@/lib/guards'
import { pickNumber, pickString } from '@/lib/pick'
import { decimalToNullableNumber } from '@/lib/booking/snapshots'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

const ADDRESS_SELECT = {
  id: true,
  clientId: true,
  kind: true,
  label: true,
  isDefault: true,
  formattedAddress: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  postalCode: true,
  countryCode: true,
  placeId: true,
  lat: true,
  lng: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ClientAddressSelect

type ClientAddressRow = Prisma.ClientAddressGetPayload<{
  select: typeof ADDRESS_SELECT
}>

function normalizeKind(value: unknown): ClientAddressKind | null {
  const s = pickString(value)?.toUpperCase() ?? ''
  if (s === ClientAddressKind.SEARCH_AREA) return ClientAddressKind.SEARCH_AREA
  if (s === ClientAddressKind.SERVICE_ADDRESS) {
    return ClientAddressKind.SERVICE_ADDRESS
  }
  return null
}

function normalizeOptionalString(
  value: unknown,
  max = 255,
): string | null | undefined | 'invalid' {
  if (value === undefined) return undefined
  if (value === null) return null

  const s = pickString(value)
  if (!s) return null
  if (s.length > max) return 'invalid'
  return s
}

function normalizeBoolean(value: unknown): boolean | undefined | 'invalid' {
  if (value === undefined) return undefined
  if (typeof value === 'boolean') return value
  return 'invalid'
}

function normalizeLatLng(value: unknown): number | null | undefined | 'invalid' {
  if (value === undefined) return undefined
  if (value === null || value === '') return null

  const n = pickNumber(value)
  if (n == null || !Number.isFinite(n)) return 'invalid'
  return n
}

function coerceLatLng(
  value: number | null | undefined | 'invalid',
): number | null | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value === null) return null
  return undefined
}

function toDecimalOrNull(value: number | null | undefined) {
  if (value == null) return null
  return new Prisma.Decimal(String(value))
}

function hasZipLikeData(args: {
  formattedAddress?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  placeId?: string | null
  lat?: number | null
  lng?: number | null
}) {
  return Boolean(
    args.formattedAddress ||
      args.city ||
      args.state ||
      args.postalCode ||
      args.placeId ||
      (args.lat != null && args.lng != null),
  )
}

function hasFullServiceAddress(args: {
  formattedAddress?: string | null
  addressLine1?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  placeId?: string | null
  lat?: number | null
  lng?: number | null
}) {
  const hasAddressLine = Boolean(args.formattedAddress || args.addressLine1)
  const hasLocationAnchor = Boolean(
    args.placeId ||
      (args.lat != null && args.lng != null) ||
      args.postalCode ||
      (args.city && args.state),
  )

  return hasAddressLine && hasLocationAnchor
}

function mapAddress(row: ClientAddressRow) {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label ?? null,
    isDefault: row.isDefault,
    formattedAddress: row.formattedAddress ?? null,
    addressLine1: row.addressLine1 ?? null,
    addressLine2: row.addressLine2 ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    postalCode: row.postalCode ?? null,
    countryCode: row.countryCode ?? null,
    placeId: row.placeId ?? null,
    lat: decimalToNullableNumber(row.lat),
    lng: decimalToNullableNumber(row.lng),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

async function loadOwnedAddress(clientId: string, addressId: string) {
  return prisma.clientAddress.findFirst({
    where: {
      id: addressId,
      clientId,
    },
    select: ADDRESS_SELECT,
  })
}

async function ensureDefaultForKind(args: {
  tx: Prisma.TransactionClient
  clientId: string
  kind: ClientAddressKind
}) {
  const { tx, clientId, kind } = args

  const existingDefault = await tx.clientAddress.findFirst({
    where: {
      clientId,
      kind,
      isDefault: true,
    },
    select: { id: true },
  })

  if (existingDefault) return

  const fallback = await tx.clientAddress.findFirst({
    where: {
      clientId,
      kind,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  })

  if (!fallback) return

  await tx.clientAddress.update({
    where: { id: fallback.id },
    data: { isDefault: true },
    select: { id: true },
  })
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const params = await Promise.resolve(ctx.params)
    const addressId = pickString(params?.id)

    if (!addressId) {
      return jsonFail(400, 'Missing address id.')
    }

    const address = await loadOwnedAddress(auth.clientId, addressId)
    if (!address) {
      return jsonFail(404, 'Address not found.')
    }

    return jsonOk({ address: mapAddress(address) }, 200)
  } catch (error) {
    console.error('GET /api/client/addresses/[id] error', error)
    return jsonFail(500, 'Failed to load client address.')
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const params = await Promise.resolve(ctx.params)
    const addressId = pickString(params?.id)

    if (!addressId) {
      return jsonFail(400, 'Missing address id.')
    }

    const existing = await loadOwnedAddress(auth.clientId, addressId)
    if (!existing) {
      return jsonFail(404, 'Address not found.')
    }

    const rawBody: unknown = await req.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}

    const kindRaw =
      body.kind !== undefined ? normalizeKind(body.kind) : undefined
    if (body.kind !== undefined && !kindRaw) {
      return jsonFail(400, 'Invalid kind. Use SEARCH_AREA or SERVICE_ADDRESS.')
    }

    const label = normalizeOptionalString(body.label, 80)
    const formattedAddress = normalizeOptionalString(body.formattedAddress, 500)
    const addressLine1 = normalizeOptionalString(body.addressLine1, 200)
    const addressLine2 = normalizeOptionalString(body.addressLine2, 200)
    const city = normalizeOptionalString(body.city, 120)
    const state = normalizeOptionalString(body.state, 120)
    const postalCode = normalizeOptionalString(body.postalCode, 40)
    const countryCode = normalizeOptionalString(body.countryCode, 8)
    const placeId = normalizeOptionalString(body.placeId, 255)
    const lat = normalizeLatLng(body.lat)
    const lng = normalizeLatLng(body.lng)
    const isDefault = normalizeBoolean(body.isDefault)

    const invalidField =
      label === 'invalid'
        ? 'label'
        : formattedAddress === 'invalid'
          ? 'formattedAddress'
          : addressLine1 === 'invalid'
            ? 'addressLine1'
            : addressLine2 === 'invalid'
              ? 'addressLine2'
              : city === 'invalid'
                ? 'city'
                : state === 'invalid'
                  ? 'state'
                  : postalCode === 'invalid'
                    ? 'postalCode'
                    : countryCode === 'invalid'
                      ? 'countryCode'
                      : placeId === 'invalid'
                        ? 'placeId'
                        : lat === 'invalid'
                          ? 'lat'
                          : lng === 'invalid'
                            ? 'lng'
                            : isDefault === 'invalid'
                              ? 'isDefault'
                              : null

    if (invalidField) {
      return jsonFail(400, `Invalid ${invalidField}.`)
    }

    const hasAnyChange =
      body.kind !== undefined ||
      body.label !== undefined ||
      body.formattedAddress !== undefined ||
      body.addressLine1 !== undefined ||
      body.addressLine2 !== undefined ||
      body.city !== undefined ||
      body.state !== undefined ||
      body.postalCode !== undefined ||
      body.countryCode !== undefined ||
      body.placeId !== undefined ||
      body.lat !== undefined ||
      body.lng !== undefined ||
      body.isDefault !== undefined

    if (!hasAnyChange) {
      return jsonOk({ address: mapAddress(existing) }, 200)
    }

    const nextKind = kindRaw ?? existing.kind
    const nextIsDefault =
        typeof isDefault === 'boolean' ? isDefault : existing.isDefault

    const nextValues = {
      label: label !== undefined ? label : existing.label,
      formattedAddress:
        formattedAddress !== undefined
          ? formattedAddress
          : existing.formattedAddress,
      addressLine1:
        addressLine1 !== undefined ? addressLine1 : existing.addressLine1,
      addressLine2:
        addressLine2 !== undefined ? addressLine2 : existing.addressLine2,
      city: city !== undefined ? city : existing.city,
      state: state !== undefined ? state : existing.state,
      postalCode: postalCode !== undefined ? postalCode : existing.postalCode,
      countryCode:
        countryCode !== undefined ? countryCode : existing.countryCode,
      placeId: placeId !== undefined ? placeId : existing.placeId,
      lat:
        lat !== undefined
          ? coerceLatLng(lat) ?? null
          : decimalToNullableNumber(existing.lat),
      lng:
        lng !== undefined
          ? coerceLatLng(lng) ?? null
          : decimalToNullableNumber(existing.lng),
    }

    if (nextKind === ClientAddressKind.SEARCH_AREA) {
      if (
        !hasZipLikeData({
          formattedAddress: nextValues.formattedAddress,
          city: nextValues.city,
          state: nextValues.state,
          postalCode: nextValues.postalCode,
          placeId: nextValues.placeId,
          lat: nextValues.lat,
          lng: nextValues.lng,
        })
      ) {
        return jsonFail(
          400,
          'Search area needs at least a ZIP/postal code, city/state, place, or map location.',
        )
      }
    }

    if (nextKind === ClientAddressKind.SERVICE_ADDRESS) {
      if (
        !hasFullServiceAddress({
          formattedAddress: nextValues.formattedAddress,
          addressLine1: nextValues.addressLine1,
          city: nextValues.city,
          state: nextValues.state,
          postalCode: nextValues.postalCode,
          placeId: nextValues.placeId,
          lat: nextValues.lat,
          lng: nextValues.lng,
        })
      ) {
        return jsonFail(
          400,
          'Service address needs a real address or formatted address before mobile booking.',
        )
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (nextIsDefault) {
        await tx.clientAddress.updateMany({
          where: {
            clientId: auth.clientId,
            kind: nextKind,
            isDefault: true,
            id: { not: existing.id },
          },
          data: { isDefault: false },
        })
      }

      await tx.clientAddress.update({
        where: { id: existing.id },
        data: {
          kind: nextKind,
          label: nextValues.label,
          isDefault: nextIsDefault,
          formattedAddress: nextValues.formattedAddress,
          addressLine1: nextValues.addressLine1,
          addressLine2: nextValues.addressLine2,
          city: nextValues.city,
          state: nextValues.state,
          postalCode: nextValues.postalCode,
          countryCode: nextValues.countryCode,
          placeId: nextValues.placeId,
          lat: toDecimalOrNull(nextValues.lat),
          lng: toDecimalOrNull(nextValues.lng),
        },
        select: { id: true },
      })

      await ensureDefaultForKind({
        tx,
        clientId: auth.clientId,
        kind: nextKind,
      })

      if (existing.kind !== nextKind) {
        await ensureDefaultForKind({
          tx,
          clientId: auth.clientId,
          kind: existing.kind,
        })
      }

      const refreshed = await tx.clientAddress.findUnique({
        where: { id: existing.id },
        select: ADDRESS_SELECT,
      })

      if (!refreshed) {
        throw new Error('ADDRESS_NOT_FOUND_AFTER_UPDATE')
      }

      return refreshed
    })

    return jsonOk({ address: mapAddress(updated) }, 200)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''

    if (message === 'ADDRESS_NOT_FOUND_AFTER_UPDATE') {
      return jsonFail(404, 'Address not found.')
    }

    console.error('PATCH /api/client/addresses/[id] error', error)
    return jsonFail(500, 'Failed to update client address.')
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const params = await Promise.resolve(ctx.params)
    const addressId = pickString(params?.id)

    if (!addressId) {
      return jsonFail(400, 'Missing address id.')
    }

    const existing = await loadOwnedAddress(auth.clientId, addressId)
    if (!existing) {
      return jsonFail(404, 'Address not found.')
    }

    await prisma.$transaction(async (tx) => {
      await tx.clientAddress.delete({
        where: { id: existing.id },
      })

      await ensureDefaultForKind({
        tx,
        clientId: auth.clientId,
        kind: existing.kind,
      })
    })

    return jsonOk(
      {
        deleted: true,
        id: existing.id,
      },
      200,
    )
  } catch (error) {
    console.error('DELETE /api/client/addresses/[id] error', error)
    return jsonFail(500, 'Failed to delete client address.')
  }
}