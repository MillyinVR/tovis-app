// app/api/client/settings/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import { ClientAddressKind } from '@prisma/client'
import { isRecord } from '@/lib/guards'
import { pickString } from '@/lib/pick'
import { decimalToNullableNumber } from '@/lib/booking/snapshots'

export const dynamic = 'force-dynamic'

function formatDateOnlyUtc(value: Date | null | undefined): string | null {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null
  const y = value.getUTCFullYear()
  const m = String(value.getUTCMonth() + 1).padStart(2, '0')
  const d = String(value.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function parseDateOnlyToUtcNoon(value: unknown): Date | null | 'invalid' {
  if (value === null) return null

  const raw = pickString(value)
  if (!raw) return null

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (!m) return 'invalid'

  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return 'invalid'
  }

  const dt = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0))
  if (Number.isNaN(dt.getTime())) return 'invalid'

  return dt
}

function normalizeOptionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null

  const s = pickString(value)
  if (!s) return null
  return s
}

function normalizeRequiredishName(value: unknown): string | undefined | 'invalid' {
  if (value === undefined) return undefined
  if (value === null) return 'invalid'

  const s = pickString(value)
  if (!s) return ''
  if (s.length > 80) return 'invalid'
  return s
}

function normalizePhone(value: unknown): string | null | undefined | 'invalid' {
  if (value === undefined) return undefined
  if (value === null) return null

  const s = pickString(value)
  if (!s) return null
  if (s.length > 40) return 'invalid'
  return s
}

function normalizeAvatarUrl(value: unknown): string | null | undefined | 'invalid' {
  if (value === undefined) return undefined
  if (value === null) return null

  const s = pickString(value)
  if (!s) return null
  if (s.length > 2000) return 'invalid'
  return s
}

function sortAddressesForSettings<T extends { kind: ClientAddressKind; isDefault: boolean; createdAt: Date }>(
  addresses: T[],
): T[] {
  return [...addresses].sort((a, b) => {
    if (a.kind !== b.kind) {
      if (a.kind === ClientAddressKind.SEARCH_AREA) return -1
      if (b.kind === ClientAddressKind.SEARCH_AREA) return 1
    }
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
    return a.createdAt.getTime() - b.createdAt.getTime()
  })
}

async function loadSettings(clientId: string, email: string | null) {
  const profile = await prisma.clientProfile.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      avatarUrl: true,
      dateOfBirth: true,
      addresses: {
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
      },
    },
  })

  if (!profile) return null

  const addresses = sortAddressesForSettings(profile.addresses)

  return {
    profile: {
      id: profile.id,
      email: email ?? null,
      firstName: profile.firstName ?? '',
      lastName: profile.lastName ?? '',
      phone: profile.phone ?? null,
      avatarUrl: profile.avatarUrl ?? null,
      dateOfBirth: formatDateOnlyUtc(profile.dateOfBirth),
    },
    addresses: addresses.map((address) => ({
      id: address.id,
      kind: address.kind,
      label: address.label ?? null,
      isDefault: address.isDefault,
      formattedAddress: address.formattedAddress ?? null,
      addressLine1: address.addressLine1 ?? null,
      addressLine2: address.addressLine2 ?? null,
      city: address.city ?? null,
      state: address.state ?? null,
      postalCode: address.postalCode ?? null,
      countryCode: address.countryCode ?? null,
      placeId: address.placeId ?? null,
      lat: decimalToNullableNumber(address.lat),
      lng: decimalToNullableNumber(address.lng),
      createdAt: address.createdAt.toISOString(),
      updatedAt: address.updatedAt.toISOString(),
    })),
  }
}

export async function GET() {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const data = await loadSettings(auth.clientId, auth.user.email ?? null)
    if (!data) return jsonFail(404, 'Client profile not found.')

    return jsonOk(data, 200)
  } catch (error) {
    console.error('GET /api/client/settings error', error)
    return jsonFail(500, 'Failed to load client settings.')
  }
}

export async function PATCH(req: Request) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const rawBody: unknown = await req.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}

    const firstName = normalizeRequiredishName(body.firstName)
    const lastName = normalizeRequiredishName(body.lastName)
    const phone = normalizePhone(body.phone)
    const avatarUrl = normalizeAvatarUrl(body.avatarUrl)
    const dateOfBirth = parseDateOnlyToUtcNoon(body.dateOfBirth)

    if (firstName === 'invalid') {
      return jsonFail(400, 'Invalid firstName.')
    }

    if (lastName === 'invalid') {
      return jsonFail(400, 'Invalid lastName.')
    }

    if (phone === 'invalid') {
      return jsonFail(400, 'Invalid phone.')
    }

    if (avatarUrl === 'invalid') {
      return jsonFail(400, 'Invalid avatarUrl.')
    }

    if (dateOfBirth === 'invalid') {
      return jsonFail(400, 'Invalid dateOfBirth. Use YYYY-MM-DD.')
    }

    const hasAnyChange =
      firstName !== undefined ||
      lastName !== undefined ||
      phone !== undefined ||
      avatarUrl !== undefined ||
      body.dateOfBirth !== undefined

    if (!hasAnyChange) {
      const current = await loadSettings(auth.clientId, auth.user.email ?? null)
      if (!current) return jsonFail(404, 'Client profile not found.')
      return jsonOk(current, 200)
    }

    await prisma.clientProfile.update({
      where: { id: auth.clientId },
      data: {
        ...(firstName !== undefined ? { firstName } : {}),
        ...(lastName !== undefined ? { lastName } : {}),
        ...(phone !== undefined ? { phone } : {}),
        ...(avatarUrl !== undefined ? { avatarUrl } : {}),
        ...(body.dateOfBirth !== undefined ? { dateOfBirth } : {}),
      },
      select: { id: true },
    })

    const updated = await loadSettings(auth.clientId, auth.user.email ?? null)
    if (!updated) return jsonFail(404, 'Client profile not found.')

    return jsonOk(updated, 200)
  } catch (error) {
    console.error('PATCH /api/client/settings error', error)
    return jsonFail(500, 'Failed to update client settings.')
  }
}