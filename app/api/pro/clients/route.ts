// app/api/pro/clients/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro, pickString, lower } from '@/app/api/_utils'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

function normalizeEmail(v: unknown) {
  const s = pickString(v)
  if (!s) return null
  return lower(s)
}

export async function POST(request: Request) {
  try {
    const auth = await requirePro()
    if (auth.res) return auth.res

    const body = (await request.json().catch(() => ({}))) as any

    const firstName = pickString(body?.firstName)
    const lastName = pickString(body?.lastName)
    const email = normalizeEmail(body?.email)
    const phone = pickString(body?.phone)

    if (!firstName || !lastName || !email) {
      return jsonFail(400, 'First name, last name, and email are required.')
    }

    const result = await prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({
        where: { email },
        select: { id: true, role: true, email: true },
      })

      if (existingUser && existingUser.role !== 'CLIENT') {
        return { ok: false as const, status: 400, error: 'This email is already used by a non-client account.' }
      }

      const clientUser =
        existingUser ??
        (await tx.user.create({
          data: {
            email,
            password: crypto.randomBytes(16).toString('hex'),
            role: 'CLIENT',
          } as any,
          select: { id: true, email: true, role: true },
        }))

      const existingProfile = await tx.clientProfile.findUnique({
        where: { userId: clientUser.id },
        select: { id: true },
      })

      const clientProfile = existingProfile
        ? await tx.clientProfile.update({
            where: { id: existingProfile.id },
            data: {
              firstName,
              lastName,
              phone: phone ?? null,
            },
            select: { id: true, userId: true },
          })
        : await tx.clientProfile.create({
            data: {
              userId: clientUser.id,
              firstName,
              lastName,
              phone: phone ?? null,
            },
            select: { id: true, userId: true },
          })

      return {
        ok: true as const,
        clientProfileId: clientProfile.id,
        userId: clientUser.id,
        email: clientUser.email,
      }
    })

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

    return jsonOk(
      {
        id: result.clientProfileId,
        userId: result.userId,
        email: result.email,
      },
      201,
    )
  } catch (error) {
    console.error('POST /api/pro/clients error', error)
    return jsonFail(500, 'Internal server error')
  }
}
