// app/api/auth/login/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyPassword, createToken } from '@/lib/auth'
import { consumeTapIntent } from '@/lib/tapIntentConsume'

type LoginBody = {
  email: string
  password: string
  tapIntentId?: string
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as LoginBody
    const { email, password, tapIntentId } = body

    if (!email || !password) {
      return NextResponse.json({ error: 'Missing email or password' }, { status: 400 })
    }

    const db: any = prisma

    const user = await db.user.findUnique({
      where: { email },
    })

    if (!user) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const isValid = await verifyPassword(password, user.password)

    if (!isValid) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const token = createToken({ userId: user.id, role: user.role })

    // ✅ If this login came from an NFC tap flow, consume it (claim card, log attribution, get nextUrl)
    const consumed = await consumeTapIntent({
      tapIntentId: tapIntentId ?? null,
      userId: user.id,
    })

    const response = NextResponse.json(
      {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
        nextUrl: consumed.nextUrl,
      },
      { status: 200 },
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
    console.error('Login error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
