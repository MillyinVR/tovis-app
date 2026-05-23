// app/api/client/addresses/route.ts

import { ClientAddressKind, Prisma } from '@prisma/client'

import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import { decimalToNullableNumber } from '@/lib/booking/snapshots'
import { isRecord } from '@/lib/guards'
import { pickNumber, pickString } from '@/lib/pick'
import { prisma } from '@/lib/prisma'
import { buildAddressPrivacyWriteData } from '@/lib/security/addressEncryption'

export const dynamic = 'force-dynamic'

const ADDRESS_SELECT = {
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
} satisfies Prisma.ClientAddressSelect

type ClientAddressRow = Prisma.ClientAddressGetPayload<{
  select: typeof ADDRESS_SELECT
}>

type NormalizedAddressInput = {
  label: string | null
  formattedAddress: string | null
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  countryCode: string | null
  placeId: string | null
  lat: number | null | undefined
  lng: number | null | undefined
}

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

function getInvalidField(args: {
  label: string | null | undefined | 'invalid'
  formattedAddress: string | null | undefined | 'invalid'
  addressLine1: string | null | undefined | 'invalid'
  addressLine2: string | null | undefined | 'invalid'
  city: string | null | undefined | 'invalid'
  state: string | null | undefined | 'invalid'
  postalCode: string | null | undefined | 'invalid'
  countryCode: string | null | undefined | 'invalid'
  placeId: string | null | undefined | 'invalid'
  lat: number | null | undefined | 'invalid'
  lng: number | null | undefined | 'invalid'
  isDefault: boolean | undefined | 'invalid'
}): string | null {
  if (args.label === 'invalid') return 'label'
  if (args.formattedAddress === 'invalid') return 'formattedAddress'
  if (args.addressLine1 === 'invalid') return 'addressLine1'
  if (args.addressLine2 === 'invalid') return 'addressLine2'
  if (args.city === 'invalid') return 'city'
  if (args.state === 'invalid') return 'state'
  if (args.postalCode === 'invalid') return 'postalCode'
  if (args.countryCode === 'invalid') return 'countryCode'
  if (args.placeId === 'invalid') return 'placeId'
  if (args.lat === 'invalid') return 'lat'
  if (args.lng === 'invalid') return 'lng'
  if (args.isDefault === 'invalid') return 'isDefault'

  return null
}

function sortAddresses<
  T extends {
    kind: ClientAddressKind
    isDefault: boolean
    createdAt: Date
  },
>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.kind !== b.kind) {
      if (a.kind === ClientAddressKind.SEARCH_AREA) return -1
      if (b.kind === ClientAddressKind.SEARCH_AREA) return 1
    }

    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1

    return a.createdAt.getTime() - b.createdAt.getTime()
  })
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

async function loadAddresses(clientId: string) {
  const rows = await prisma.clientAddress.findMany({
    where: { clientId },
    select: ADDRESS_SELECT,
  })

  return sortAddresses(rows).map(mapAddress)
}

function normalizeAddressInput(args: {
  label: string | null | undefined | 'invalid'
  formattedAddress: string | null | undefined | 'invalid'
  addressLine1: string | null | undefined | 'invalid'
  addressLine2: string | null | undefined | 'invalid'
  city: string | null | undefined | 'invalid'
  state: string | null | undefined | 'invalid'
  postalCode: string | null | undefined | 'invalid'
  countryCode: string | null | undefined | 'invalid'
  placeId: string | null | undefined | 'invalid'
  lat: number | null | undefined | 'invalid'
  lng: number | null | undefined | 'invalid'
}): NormalizedAddressInput {
  return {
    label: args.label ?? null,
    formattedAddress: args.formattedAddress ?? null,
    addressLine1: args.addressLine1 ?? null,
    addressLine2: args.addressLine2 ?? null,
    city: args.city ?? null,
    state: args.state ?? null,
    postalCode: args.postalCode ?? null,
    countryCode: args.countryCode ?? null,
    placeId: args.placeId ?? null,
    lat: coerceLatLng(args.lat),
    lng: coerceLatLng(args.lng),
  }
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

    const invalidField = getInvalidField({
      label,
      formattedAddress,
      addressLine1,
      addressLine2,
      city,
      state,
      postalCode,
      countryCode,
      placeId,
      lat,
      lng,
      isDefault,
    })

    if (invalidField) {
      return jsonFail(400, `Invalid ${invalidField}.`)
    }

    const normalized = normalizeAddressInput({
      label,
      formattedAddress,
      addressLine1,
      addressLine2,
      city,
      state,
      postalCode,
      countryCode,
      placeId,
      lat,
      lng,
    })

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

    const shouldBeDefault = isDefault === true || existingCountForKind === 0

    const addressPrivacyData = buildAddressPrivacyWriteData({
      formattedAddress: normalized.formattedAddress,
      addressLine1: normalized.addressLine1,
      addressLine2: normalized.addressLine2,
      city: normalized.city,
      state: normalized.state,
      postalCode: normalized.postalCode,
      countryCode: normalized.countryCode,
      placeId: normalized.placeId,
      lat: normalized.lat,
      lng: normalized.lng,
    })

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
          ...addressPrivacyData,
        },
        select: ADDRESS_SELECT,
      })
    })

    return jsonOk(
      {
        address: mapAddress(created),
      },
      201,
    )
  } catch (error) {
    console.error('POST /api/client/addresses error', error)
    return jsonFail(500, 'Failed to create client address.')
  }
}