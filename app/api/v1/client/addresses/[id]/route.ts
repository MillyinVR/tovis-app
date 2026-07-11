// app/api/v1/client/addresses/[id]/route.ts

import { ClientAddressKind, Prisma } from '@prisma/client'

import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { resolveServiceAddressValues } from '@/lib/clientAddresses/resolveServiceAddress'
import { type RouteContext } from '@/app/api/_utils/routeContext'
import { prisma } from '@/lib/prisma'
import { buildAddressPrivacyWriteData } from '@/lib/security/addressEncryption'
import {
  CLIENT_ADDRESS_SELECT,
  buildNextClientAddressValues,
  clientAddressNumberToDecimalOrNull,
  getInvalidClientAddressField,
  hasClientAddressZipLikeData,
  hasFullClientServiceAddress,
  mapClientAddress,
  normalizeClientAddressBoolean,
  normalizeClientAddressKind,
  normalizeClientAddressLatLng,
  normalizeClientAddressOptionalString,
  normalizeClientAddressRadiusMiles,
} from '@/lib/clientAddresses/addressInput'

export const dynamic = 'force-dynamic'

async function loadOwnedAddress(clientId: string, addressId: string) {
  return prisma.clientAddress.findFirst({
    where: {
      id: addressId,
      clientId,
    },
    select: CLIENT_ADDRESS_SELECT,
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

function pickAddressId(params: { id: string } | Promise<{ id: string }>) {
  return Promise.resolve(params).then((resolved) => resolved.id.trim())
}

function hasPatchChange(body: Record<string, unknown>): boolean {
  return (
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
    body.radiusMiles !== undefined ||
    body.isDefault !== undefined
  )
}

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const addressId = await pickAddressId(ctx.params)

    if (!addressId) {
      return jsonFail(400, 'Missing address id.')
    }

    const address = await loadOwnedAddress(auth.clientId, addressId)
    if (!address) {
      return jsonFail(404, 'Address not found.')
    }

    return jsonOk({ address: mapClientAddress(address) }, 200)
  } catch (error) {
    console.error('GET /api/v1/client/addresses/[id] error', error)
    return jsonFail(500, 'Failed to load client address.')
  }
}

export async function PATCH(req: Request, ctx: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const addressId = await pickAddressId(ctx.params)

    if (!addressId) {
      return jsonFail(400, 'Missing address id.')
    }

    const existing = await loadOwnedAddress(auth.clientId, addressId)
    if (!existing) {
      return jsonFail(404, 'Address not found.')
    }

    const body = await readJsonRecord(req)

    const kindRaw =
      body.kind !== undefined
        ? normalizeClientAddressKind(body.kind)
        : undefined

    if (body.kind !== undefined && !kindRaw) {
      return jsonFail(400, 'Invalid kind. Use SEARCH_AREA or SERVICE_ADDRESS.')
    }

    const label = normalizeClientAddressOptionalString(body.label, 80)
    const formattedAddress = normalizeClientAddressOptionalString(
      body.formattedAddress,
      500,
    )
    const addressLine1 = normalizeClientAddressOptionalString(
      body.addressLine1, // pii-plaintext-read-ok: client address patch accepts plaintext request address before centralized normalization/encryption
      200,
    )
    const addressLine2 = normalizeClientAddressOptionalString(
      body.addressLine2, // pii-plaintext-read-ok: client address patch accepts plaintext request address before centralized normalization/encryption
      200,
    )
    const city = normalizeClientAddressOptionalString(body.city, 120)
    const state = normalizeClientAddressOptionalString(body.state, 120)
    const postalCode = normalizeClientAddressOptionalString(
      body.postalCode, // pii-plaintext-read-ok: client address patch accepts plaintext request postal code before centralized normalization/encryption
      40,
    )
    const countryCode = normalizeClientAddressOptionalString(body.countryCode, 8)
    const placeId = normalizeClientAddressOptionalString(body.placeId, 255)
    const lat = normalizeClientAddressLatLng(body.lat)
    const lng = normalizeClientAddressLatLng(body.lng)
    const isDefault = normalizeClientAddressBoolean(body.isDefault)
    const radiusMiles = normalizeClientAddressRadiusMiles(body.radiusMiles)

    if (radiusMiles === 'invalid') {
      return jsonFail(400, 'Invalid radiusMiles.')
    }

    const invalidField = getInvalidClientAddressField({
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

    if (!hasPatchChange(body)) {
      return jsonOk({ address: mapClientAddress(existing) }, 200)
    }

    const nextKind = kindRaw ?? existing.kind
    const nextIsDefault =
      typeof isDefault === 'boolean' ? isDefault : existing.isDefault

    const nextValues = buildNextClientAddressValues({
      existing,
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

    if (nextKind === ClientAddressKind.SEARCH_AREA) {
      if (!hasClientAddressZipLikeData(nextValues)) {
        return jsonFail(
          400,
          'Search area needs at least a ZIP/postal code, city/state, place, or map location.',
        )
      }
    }

    let resolvedValues = nextValues

    if (nextKind === ClientAddressKind.SERVICE_ADDRESS) {
      if (!hasFullClientServiceAddress(nextValues)) {
        return jsonFail(
          400,
          'Service address needs a real address or formatted address before mobile booking.',
        )
      }

      // Canonicalize a hand-typed service address into a formatted address +
      // coordinates so it is bookable for mobile (autocomplete picks skip this).
      const resolved = await resolveServiceAddressValues(nextValues)
      if (!resolved.ok) {
        return jsonFail(400, resolved.error)
      }
      resolvedValues = resolved.values
    }

    const addressPrivacyData = buildAddressPrivacyWriteData({
      formattedAddress: resolvedValues.formattedAddress,
      addressLine1: resolvedValues.addressLine1,
      addressLine2: resolvedValues.addressLine2,
      city: resolvedValues.city,
      state: resolvedValues.state,
      postalCode: resolvedValues.postalCode,
      countryCode: resolvedValues.countryCode,
      placeId: resolvedValues.placeId,
      lat: resolvedValues.lat,
      lng: resolvedValues.lng,
    })

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
          label: resolvedValues.label,
          isDefault: nextIsDefault,
          formattedAddress: resolvedValues.formattedAddress,
          addressLine1: resolvedValues.addressLine1,
          addressLine2: resolvedValues.addressLine2,
          city: resolvedValues.city,
          state: resolvedValues.state,
          postalCode: resolvedValues.postalCode,
          countryCode: resolvedValues.countryCode,
          placeId: resolvedValues.placeId,
          lat: clientAddressNumberToDecimalOrNull(resolvedValues.lat),
          lng: clientAddressNumberToDecimalOrNull(resolvedValues.lng),
          radiusMiles:
            nextKind === ClientAddressKind.SEARCH_AREA
              ? radiusMiles === undefined
                ? existing.radiusMiles
                : radiusMiles
              : null,
          ...addressPrivacyData,
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
        select: CLIENT_ADDRESS_SELECT,
      })

      if (!refreshed) {
        throw new Error('ADDRESS_NOT_FOUND_AFTER_UPDATE')
      }

      return refreshed
    })

    return jsonOk({ address: mapClientAddress(updated) }, 200)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''

    if (message === 'ADDRESS_NOT_FOUND_AFTER_UPDATE') {
      return jsonFail(404, 'Address not found.')
    }

    console.error('PATCH /api/v1/client/addresses/[id] error', error)
    return jsonFail(500, 'Failed to update client address.')
  }
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const addressId = await pickAddressId(ctx.params)

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
    console.error('DELETE /api/v1/client/addresses/[id] error', error)
    return jsonFail(500, 'Failed to delete client address.')
  }
}