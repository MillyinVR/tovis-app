// app/api/pro/profile/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { Prisma, ProfessionType } from '@prisma/client'
import { canEditPublicPublishingFields } from '@/lib/proTrustState'
import { isHandleReserved } from '@/lib/handles'

export const dynamic = 'force-dynamic'

function pickNonEmptyStringOrUndefined(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t ? t : undefined
}

/**
 * Vanity handle rules (DNS-safe for {handle}.tovis.me):
 * - 3–24 chars
 * - lowercase letters, numbers, hyphen
 * - must start + end with letter/number
 */
const HANDLE_MIN = 3
const HANDLE_MAX = 24


function normalizeHandle(raw: string) {
  return raw.trim().toLowerCase()
}

function isValidHandleNormalized(h: string) {
  if (h.length < HANDLE_MIN || h.length > HANDLE_MAX) return false
  if (!/^[a-z0-9-]+$/.test(h)) return false
  if (!/^[a-z0-9]/.test(h)) return false
  if (!/[a-z0-9]$/.test(h)) return false
  return true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isProfessionTypeValue(value: string): value is ProfessionType {
  return Object.values(ProfessionType).some((candidate) => candidate === value)
}

function prismaErrorToResponse(e: unknown) {
  if (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    e.code === 'P2002'
  ) {
    return jsonFail(409, 'That handle is taken.')
  }

  if (e instanceof Prisma.PrismaClientValidationError) {
    return jsonFail(400, 'Invalid profile update payload.', {
      detail: e.message,
    })
  }

  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    return jsonFail(400, 'Database rejected the update.', {
      code: e.code,
      detail: e.message,
    })
  }

  return null
}

export async function PATCH(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const proProfileId = auth.professionalId

    const rawBody: unknown = await req.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}

    const current = await prisma.professionalProfile.findUnique({
      where: { id: proProfileId },
      select: {
        id: true,
        verificationStatus: true,
        handle: true,
        handleNormalized: true,
      },
    })

    if (!current) {
      return jsonFail(404, 'Professional profile not found.')
    }

    const businessName = pickNonEmptyStringOrUndefined(body.businessName)
    const bio = pickNonEmptyStringOrUndefined(body.bio)
    const location = pickNonEmptyStringOrUndefined(body.location)
    const avatarUrl = pickNonEmptyStringOrUndefined(body.avatarUrl)

    const professionTypeRaw = pickNonEmptyStringOrUndefined(body.professionType)
    let professionType: ProfessionType | undefined = undefined

    if (professionTypeRaw !== undefined) {
      if (!isProfessionTypeValue(professionTypeRaw)) {
        return jsonFail(400, 'Invalid profession type.')
      }
      professionType = professionTypeRaw
    }

    const handleRaw = typeof body.handle === 'string' ? body.handle : undefined
    const wantsHandleUpdate = handleRaw !== undefined

    let nextHandle: string | null | undefined = undefined
    let nextHandleNormalized: string | null | undefined = undefined

    if (wantsHandleUpdate) {
      const trimmed = handleRaw.trim()

      if (!trimmed) {
        nextHandle = null
        nextHandleNormalized = null
      } else {
        const normalized = normalizeHandle(trimmed)

        if (!isValidHandleNormalized(normalized)) {
          return jsonFail(
            400,
            `Handle must be ${HANDLE_MIN}-${HANDLE_MAX} chars and use only letters, numbers, and hyphens.`,
          )
        }

        if (isHandleReserved(normalized)) {
          return jsonFail(400, 'That handle is reserved.')
        }

        nextHandle = normalized
        nextHandleNormalized = normalized
      }
    }

    const handleActuallyChanges =
      wantsHandleUpdate &&
      (current.handleNormalized ?? null) !== (nextHandleNormalized ?? null)

    if (
      handleActuallyChanges &&
      !canEditPublicPublishingFields(current.verificationStatus)
    ) {
      return jsonFail(
        403,
        'Your public profile link becomes available after approval.',
      )
    }

    const data: Prisma.ProfessionalProfileUpdateInput = {
      ...(businessName !== undefined ? { businessName } : {}),
      ...(bio !== undefined ? { bio } : {}),
      ...(location !== undefined ? { location } : {}),
      ...(avatarUrl !== undefined ? { avatarUrl } : {}),
      ...(professionType !== undefined ? { professionType } : {}),
      ...(handleActuallyChanges
        ? {
            handle: nextHandle,
            handleNormalized: nextHandleNormalized,
          }
        : {}),
    }

    try {
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
          isPremium: true,
        },
      })

      return jsonOk({ ok: true, profile: updated }, 200)
    } catch (e: unknown) {
      const res = prismaErrorToResponse(e)
      if (res) return res

      console.error('PATCH /api/pro/profile prisma error', e)
      return jsonFail(500, 'Failed to update profile', {
        message: e instanceof Error ? e.message : String(e),
      })
    }
  } catch (e: unknown) {
    console.error('PATCH /api/pro/profile error', e)
    return jsonFail(500, 'Failed to update profile', {
      message: e instanceof Error ? e.message : String(e),
    })
  }
}