// app/api/pro/profile/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

function pickNonEmptyStringOrUndefined(v: unknown): string | undefined {
  if (v === undefined) return undefined
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t ? t : undefined
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
    const auth = await requirePro()
    if (auth.res) return auth.res
    const proProfileId = auth.professionalId

    const body = await req.json().catch(() => ({} as any))

    // IMPORTANT:
    // - For required string fields in Prisma, NEVER pass null.
    // - If UI sends empty string, we treat as "no update".
    const businessName = pickNonEmptyStringOrUndefined(body.businessName)
    const bio = pickNonEmptyStringOrUndefined(body.bio)
    const location = pickNonEmptyStringOrUndefined(body.location)
    const avatarUrl = pickNonEmptyStringOrUndefined(body.avatarUrl)

    const professionType = typeof body.professionType === 'string' ? body.professionType : undefined

    // Handle (optional)
    // - send handle: "my_name" to set
    // - send handle: "" to clear (null)
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
          return jsonFail(400, 'Handle must be 3-20 chars and use only letters, numbers, ., _, or -')
        }

        const existing = await prisma.professionalProfile.findFirst({
          where: {
            handleNormalized: normalized,
            id: { not: proProfileId },
          },
          select: { id: true },
        })

        if (existing) return jsonFail(409, 'That handle is taken.')

        handle = normalized
        handleNormalized = normalized
      }
    }

    const data: Prisma.ProfessionalProfileUpdateInput = {
      ...(businessName !== undefined ? { businessName } : {}),
      ...(bio !== undefined ? { bio } : {}),
      ...(location !== undefined ? { location } : {}),
      ...(avatarUrl !== undefined ? { avatarUrl } : {}),
      ...(professionType !== undefined ? { professionType: professionType as any } : {}),
      ...(wantsHandleUpdate ? { handle, handleNormalized } : {}),
    }

    const updated = await prisma.professionalProfile.update({
      where: { id: proProfileId },
      data,
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

    return jsonOk({ ok: true, profile: updated }, 200)
  } catch (e) {
    console.error('PATCH /api/pro/profile error', e)
    return jsonFail(500, 'Failed to update profile')
  }
}
