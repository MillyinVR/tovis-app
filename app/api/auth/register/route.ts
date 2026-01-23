// app/api/auth/register/route.ts
import { prisma } from '@/lib/prisma'
import { hashPassword, createToken } from '@/lib/auth'
import { consumeTapIntent } from '@/lib/tapIntentConsume'
import { sanitizeTimeZone, isValidIanaTimeZone } from '@/lib/timeZone'
import { jsonFail, jsonOk, pickString, normalizeEmail } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

type RegisterBody = {
  email?: unknown
  password?: unknown
  role?: unknown
  firstName?: unknown
  lastName?: unknown
  phone?: unknown
  tapIntentId?: unknown
  timeZone?: unknown
}

function cleanPhone(v: unknown): string | null {
  const raw = pickString(v)
  if (!raw) return null
  const cleaned = raw.replace(/[^\d+]/g, '')
  return cleaned ? cleaned : null
}

function normalizeRole(v: unknown): 'CLIENT' | 'PRO' | null {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  if (s === 'CLIENT') return 'CLIENT'
  if (s === 'PRO') return 'PRO'
  return null
}

function normalizeTimeZone(v: unknown): string | null {
  const raw = pickString(v)
  if (!raw) return null
  const tz = sanitizeTimeZone(raw, 'UTC')
  if (!tz) return null
  return isValidIanaTimeZone(tz) ? tz : null
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as RegisterBody

    const email = normalizeEmail(body.email)
    const password = pickString(body.password)
    const role = normalizeRole(body.role)

    const firstName = pickString(body.firstName)
    const lastName = pickString(body.lastName)
    const phone = cleanPhone(body.phone)
    const tapIntentId = pickString(body.tapIntentId)

    const timeZone = normalizeTimeZone(body.timeZone)

    if (!email || !password || !role) {
      return jsonFail(400, 'Missing required fields.', { code: 'MISSING_FIELDS' })
    }

    if (!firstName || !lastName) {
      return jsonFail(400, 'First and last name are required.', { code: 'MISSING_NAME' })
    }

    if (role === 'PRO' && !phone) {
      return jsonFail(400, 'Phone number is required for professionals.', { code: 'PHONE_REQUIRED' })
    }

    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } })
    if (existing) {
      return jsonFail(400, 'Email already in use.', { code: 'EMAIL_IN_USE' })
    }

    const passwordHash = await hashPassword(password)

    const user = await prisma.user.create({
      data: {
        email,
        password: passwordHash,
        role,

        clientProfile:
          role === 'CLIENT'
            ? { create: { firstName, lastName, phone: phone ?? null } }
            : undefined,

        professionalProfile:
          role === 'PRO'
            ? {
                create: {
                  firstName,
                  lastName,
                  phone: phone ?? null,
                  timeZone: timeZone ?? null,

                  bio: '',
                  location: '',
                  professionType: null,
                  licenseNumber: null,
                  licenseState: null,
                  licenseExpiry: null,
                },
              }
            : undefined,
      },
      select: { id: true, email: true, role: true },
    })

    const token = createToken({ userId: user.id, role: user.role })

    const consumed = await consumeTapIntent({ tapIntentId, userId: user.id }).catch(() => null)

    const res = jsonOk(
      {
        user: { id: user.id, email: user.email, role: user.role },
        nextUrl: consumed?.nextUrl ?? null,
      },
      201,
    )

    res.cookies.set('tovis_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    })

    return res
  } catch (error) {
    console.error('Register error', error)
    return jsonFail(500, 'Internal server error', { code: 'INTERNAL' })
  }
}
