import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword, createToken } from '@/lib/auth'

type RegisterBody = {
  email: string
  password: string
  role: 'CLIENT' | 'PRO'
  firstName?: string
  lastName?: string
  businessName?: string
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RegisterBody
    const { email, password, role, firstName, lastName, businessName } = body

    if (!email || !password || !role) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    if (role !== 'CLIENT' && role !== 'PRO') {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }

    // cast prisma to any so TS stops whining
    const db: any = prisma

    const existing = await db.user.findUnique({
      where: { email },
    })

    if (existing) {
      return NextResponse.json({ error: 'Email already in use' }, { status: 400 })
    }

    const passwordHash = await hashPassword(password)

    const user = await db.user.create({
      data: {
        email,
        password: passwordHash,
        role, // 'CLIENT' or 'PRO'
        clientProfile:
          role === 'CLIENT'
            ? {
                create: {
                  firstName: firstName ?? '',
                  lastName: lastName ?? '',
                },
              }
            : undefined,
        professionalProfile:
  role === 'PRO'
    ? {
        create: {
          businessName: businessName ?? null,
          bio: '',
          location: '',
          professionType: null,   // will be set in onboarding later
          licenseNumber: null,
          licenseState: null,
          licenseExpiry: null,
          // licenseVerified, verificationStatus, etc use defaults from schema
        },
      }
    : undefined,

      },
      include: {
        clientProfile: true,
        professionalProfile: true,
      },
    })

    const token = createToken({ userId: user.id, role: user.role })

    const response = NextResponse.json(
      {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
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
