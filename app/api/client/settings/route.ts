// app/api/client/settings/route.ts

import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { pickString } from '@/lib/pick'
import { prisma } from '@/lib/prisma'
import {
  CLIENT_ADDRESS_SELECT,
  mapClientAddress,
  sortClientAddresses,
} from '@/lib/clientAddresses/addressInput'
import { buildClientProfileContactLookupData } from '@/lib/security/contactLookup'
import { buildPhoneEncryptionWriteData } from '@/lib/security/phonePrivacy'
import { normalizeSettingsPhoneFromBody } from '@/lib/security/settingsContactInput'

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

  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return 'invalid'
  }

  return dt
}

function normalizeRequiredishName(
  value: unknown,
): string | undefined | 'invalid' {
  if (value === undefined) return undefined
  if (value === null) return 'invalid'

  const s = pickString(value)
  if (!s) return ''
  if (s.length > 80) return 'invalid'

  return s
}


function normalizeAvatarUrl(
  value: unknown,
): string | null | undefined | 'invalid' {
  if (value === undefined) return undefined
  if (value === null) return null

  const s = pickString(value)
  if (!s) return null
  if (s.length > 2000) return 'invalid'

  return s
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
        select: CLIENT_ADDRESS_SELECT,
      },
    },
  })

  if (!profile) return null

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
    addresses: sortClientAddresses(profile.addresses).map(mapClientAddress),
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

    const body = await readJsonRecord(req)

    const firstName = normalizeRequiredishName(body.firstName)
    const lastName = normalizeRequiredishName(body.lastName)
    // pii-plaintext-read-ok: client settings PATCH accepts plaintext phone from request body so it can be normalized and lookup-hashed before storage
    const phone = normalizeSettingsPhoneFromBody(body)
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
        ...(phone !== undefined
          ? {
              phone,
              ...buildClientProfileContactLookupData({ phone }),
              ...buildPhoneEncryptionWriteData({ phone }),
            }
          : {}),
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