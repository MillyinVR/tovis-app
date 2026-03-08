// app/api/client/addresses/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import { ClientAddressKind, Prisma } from '@prisma/client'
import { isRecord } from '@/lib/guards'
import { pickNumber, pickString } from '@/lib/pick'
import { decimalToNullableNumber } from '@/lib/booking/snapshots'

export const dynamic = 'force-dynamic'

function normalizeKind(value: unknown): ClientAddressKind | null {
  const s = pickString(value)?.toUpperCase() ?? ''
  if (s === ClientAddressKind.SEARCH_AREA) return ClientAddressKind.SEARCH_AREA
  if (s === ClientAddressKind.SERVICE_ADDRESS) return ClientAddressKind.SERVICE_ADDRESS
  return null
}

function normalizeOptionalString(value: unknown, max = 255): string | null | undefined | 'invalid' {
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

function sortAddresses<T extends { kind: ClientAddressKind; isDefault: boolean; createdAt: Date }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => {
    if (a.kind !== b.kind) {
      if (a.kind === ClientAddressKind.SEARCH_AREA) return -1
      if (b.kind === ClientAddressKind.SEARCH_AREA) return 1
    }
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
    return a.createdAt.getTime() - b.createdAt.getTime()
  })
}

async function loadAddresses(clientId: string) {
  const rows = await prisma.clientAddress.findMany({
    where: { clientId },
    select: {
      id: true,
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
    },
  })

  return sortAddresses(rows).map((row) => ({
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
  }))
}

export async function GET() {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const addresses = await loadAddresses(auth.clientId)
    return jsonOk({ addresses }, 200)
  } catch (error) {
    console.error('GET /api/client/addresses error', error)
    return jsonFail(500, 'Failed to load client addresses.')
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const rawBody: unknown = await req.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}

    const kind = normalizeKind(body.kind)
    if (!kind) {
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
      label === 'invalid' ? 'label' :
      formattedAddress === 'invalid' ? 'formattedAddress' :
      addressLine1 === 'invalid' ? 'addressLine1' :
      addressLine2 === 'invalid' ? 'addressLine2' :
      city === 'invalid' ? 'city' :
      state === 'invalid' ? 'state' :
      postalCode === 'invalid' ? 'postalCode' :
      countryCode === 'invalid' ? 'countryCode' :
      placeId === 'invalid' ? 'placeId' :
      lat === 'invalid' ? 'lat' :
      lng === 'invalid' ? 'lng' :
      isDefault === 'invalid' ? 'isDefault' :
      null

    if (invalidField) {
      return jsonFail(400, `Invalid ${invalidField}.`)
    }

    const normalized = {
        label: label ?? null,
        formattedAddress: formattedAddress ?? null,
        addressLine1: addressLine1 ?? null,
        addressLine2: addressLine2 ?? null,
        city: city ?? null,
        state: state ?? null,
        postalCode: postalCode ?? null,
        countryCode: countryCode ?? null,
        placeId: placeId ?? null,
        lat: coerceLatLng(lat),
        lng: coerceLatLng(lng),
      }

    if (kind === ClientAddressKind.SEARCH_AREA) {
      if (!hasZipLikeData(normalized)) {
        return jsonFail(
          400,
          'Search area needs at least a ZIP/postal code, city/state, place, or map location.',
        )
      }
    }

    if (kind === ClientAddressKind.SERVICE_ADDRESS) {
      if (!hasFullServiceAddress(normalized)) {
        return jsonFail(
          400,
          'Service address needs a real address or formatted address before mobile booking.',
        )
      }
    }

    const existingCountForKind = await prisma.clientAddress.count({
      where: {
        clientId: auth.clientId,
        kind,
      },
    })

    const shouldBeDefault =
      isDefault === true || existingCountForKind === 0

    const created = await prisma.$transaction(async (tx) => {
      if (shouldBeDefault) {
        await tx.clientAddress.updateMany({
          where: {
            clientId: auth.clientId,
            kind,
            isDefault: true,
          },
          data: { isDefault: false },
        })
      }

      return tx.clientAddress.create({
        data: {
          clientId: auth.clientId,
          kind,
          isDefault: shouldBeDefault,
          label: normalized.label,
          formattedAddress: normalized.formattedAddress,
          addressLine1: normalized.addressLine1,
          addressLine2: normalized.addressLine2,
          city: normalized.city,
          state: normalized.state,
          postalCode: normalized.postalCode,
          countryCode: normalized.countryCode,
          placeId: normalized.placeId,
          lat: toDecimalOrNull(normalized.lat),
          lng: toDecimalOrNull(normalized.lng),
        },
        select: {
          id: true,
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
        },
      })
    })

    return jsonOk(
      {
        address: {
          id: created.id,
          kind: created.kind,
          label: created.label ?? null,
          isDefault: created.isDefault,
          formattedAddress: created.formattedAddress ?? null,
          addressLine1: created.addressLine1 ?? null,
          addressLine2: created.addressLine2 ?? null,
          city: created.city ?? null,
          state: created.state ?? null,
          postalCode: created.postalCode ?? null,
          countryCode: created.countryCode ?? null,
          placeId: created.placeId ?? null,
          lat: decimalToNullableNumber(created.lat),
          lng: decimalToNullableNumber(created.lng),
          createdAt: created.createdAt.toISOString(),
          updatedAt: created.updatedAt.toISOString(),
        },
      },
      201,
    )
  } catch (error) {
    console.error('POST /api/client/addresses error', error)
    return jsonFail(500, 'Failed to create client address.')
  }
}