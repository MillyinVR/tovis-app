// app/api/auth/register/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword, createToken } from '@/lib/auth'
import { consumeTapIntent } from '@/lib/tapIntentConsume'
import { sanitizeTimeZone, isValidIanaTimeZone } from '@/lib/timeZone'
import { pickString } from '@/app/api/_utils/pick'

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
  // keep digits and leading +
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

    const email = pickString(body.email)
    const password = pickString(body.password)
    const role = normalizeRole(body.role)

    const firstName = pickString(body.firstName)
    const lastName = pickString(body.lastName)
    const phone = cleanPhone(body.phone)
    const tapIntentId = pickString(body.tapIntentId)

    const timeZone = normalizeTimeZone(body.timeZone)

    if (!email || !password || !role) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    if (!firstName || !lastName) {
      return NextResponse.json({ error: 'First and last name are required' }, { status: 400 })
    }

    if (role === 'PRO' && !phone) {
      return NextResponse.json({ error: 'Phone number is required for professionals' }, { status: 400 })
    }

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json({ error: 'Email already in use' }, { status: 400 })
    }

    const passwordHash = await hashPassword(password)

    const user = await prisma.user.create({
      data: {
        email,
        password: passwordHash,
        role,

        clientProfile:
          role === 'CLIENT'
            ? {
                create: {
                  firstName,
                  lastName,
                  phone: phone ?? null,
                },
              }
            : undefined,

        professionalProfile:
          role === 'PRO'
            ? {
                create: {
                  firstName,
                  lastName,
                  phone: phone ?? null,

                  // ✅ store timezone if valid, else null
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
      include: { clientProfile: true, professionalProfile: true },
    })

    const token = createToken({ userId: user.id, role: user.role })

    const consumed = await consumeTapIntent({
      tapIntentId,
      userId: user.id,
    })

    const response = NextResponse.json(
      {
        user: { id: user.id, email: user.email, role: user.role },
        nextUrl: consumed.nextUrl,
      },
      { status: 201 },
    )

    response.cookies.set('tovis_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    })

    return response
  } catch (error) {
    console.error('Register error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
