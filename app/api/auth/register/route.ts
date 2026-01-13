// app/api/auth/register/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword, createToken } from '@/lib/auth'
import { consumeTapIntent } from '@/lib/tapIntentConsume'

type RegisterBody = {
  email: string
  password: string
  role: 'CLIENT' | 'PRO'
  firstName?: string
  lastName?: string
  phone?: string
  tapIntentId?: string
  timeZone?: string // ✅ add
}

function cleanString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s ? s : null
}

function cleanPhone(v: unknown): string | null {
  const raw = cleanString(v)
  if (!raw) return null
  const cleaned = raw.replace(/[^\d+]/g, '')
  return cleaned ? cleaned : null
}

function isValidIanaTimeZone(tz: string | null | undefined) {
  if (!tz || typeof tz !== 'string') return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date())
    return true
  } catch {
    return false
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RegisterBody

    const email = cleanString(body.email)
    const password = cleanString(body.password)
    const role = body.role

    const firstName = cleanString(body.firstName)
    const lastName = cleanString(body.lastName)
    const phone = cleanPhone(body.phone)
    const tapIntentId = cleanString(body.tapIntentId)

    // ✅ timezone capture (client-provided)
    const tzRaw = cleanString(body.timeZone)
    const timeZone = isValidIanaTimeZone(tzRaw) ? (tzRaw as string) : null

    if (!email || !password || !role) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    if (role !== 'CLIENT' && role !== 'PRO') {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
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

                  // ✅ store timezone if provided/valid, else null (UI will prompt)
                  timeZone,

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
