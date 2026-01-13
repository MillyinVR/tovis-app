// app/api/pro/profile/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

function pickString(v: unknown) {
  return typeof v === 'string' ? v.trim() : null
}

function normalizeHandle(raw: string) {
  return raw.trim().toLowerCase()
}

function isValidHandleNormalized(h: string) {
  if (h.length < 3 || h.length > 20) return false
  if (!/^[a-z0-9._-]+$/.test(h)) return false
  if (!/[a-z0-9]/.test(h)) return false
  return true
}

export async function PATCH(req: Request) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'PRO' || !user.professionalProfile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))

    const businessName = pickString(body.businessName)
    const bio = pickString(body.bio)
    const location = pickString(body.location)
    const avatarUrl = pickString(body.avatarUrl)

    const professionType = typeof body.professionType === 'string' ? body.professionType : undefined

    // Handle (optional)
    // - send handle: "my_name" to set
    // - send handle: "" to clear
    const handleRaw = typeof body.handle === 'string' ? body.handle : undefined
    const wantsHandleUpdate = handleRaw !== undefined

    let handle: string | null | undefined = undefined
    let handleNormalized: string | null | undefined = undefined

    if (wantsHandleUpdate) {
      const trimmed = handleRaw.trim()

      if (!trimmed) {
        // clearing
        handle = null
        handleNormalized = null
      } else {
        const normalized = normalizeHandle(trimmed)
        if (!isValidHandleNormalized(normalized)) {
          return NextResponse.json(
            { error: 'Handle must be 3-20 chars and use only letters, numbers, ., _, or -' },
            { status: 400 },
          )
        }

        // Collision check (case-insensitive via normalized)
        const existing = await prisma.professionalProfile.findFirst({
          where: {
            handleNormalized: normalized,
            id: { not: user.professionalProfile.id },
          },
          select: { id: true },
        })

        if (existing) {
          return NextResponse.json({ error: 'That handle is taken.' }, { status: 409 })
        }

        // store display handle however you want (you can keep original casing later if you want)
        handle = normalized
        handleNormalized = normalized
      }
    }

    const updated = await prisma.professionalProfile.update({
      where: { id: user.professionalProfile.id },
      data: {
        ...(businessName !== null ? { businessName } : {}),
        ...(bio !== null ? { bio } : {}),
        ...(location !== null ? { location } : {}),
        ...(avatarUrl !== null ? { avatarUrl } : {}),
        ...(professionType !== undefined ? { professionType: professionType as any } : {}),
        ...(wantsHandleUpdate ? { handle, handleNormalized } : {}),
      },
      select: {
        id: true,
        businessName: true,
        handle: true,
        bio: true,
        location: true,
        avatarUrl: true,
        professionType: true,
      },
    })

    return NextResponse.json({ ok: true, profile: updated }, { status: 200 })
  } catch (e) {
    console.error('PATCH /api/pro/profile error', e)
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
  }
}
