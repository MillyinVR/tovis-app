// app/api/v1/pro/profile/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { Prisma, ProfessionType, ProNameDisplay } from '@prisma/client'
import { canEditPublicPublishingFields } from '@/lib/proTrustState'
import {
  handleFormatError,
  handleFormatMessage,
  normalizeHandle,
} from '@/lib/handles'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import {
  normalizeSocialHandle,
  normalizeWebsiteUrl,
} from '@/lib/profiles/socialLinks'

export const dynamic = 'force-dynamic'

function pickNonEmptyStringOrUndefined(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t ? t : undefined
}


function isProfessionTypeValue(value: string): value is ProfessionType {
  return Object.values(ProfessionType).some((candidate) => candidate === value)
}

function isNameDisplayValue(value: string): value is ProNameDisplay {
  return Object.values(ProNameDisplay).some((candidate) => candidate === value)
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

// The editable-profile selection shared by GET (read) and PATCH (write) so the
// native pro-profile editor reads exactly the fields it can write back. Native
// has no other way to learn its own professionalId (the web server-renders it).
const PRO_PROFILE_SELECT = {
  id: true,
  businessName: true,
  handle: true,
  bio: true,
  location: true,
  avatarUrl: true,
  professionType: true,
  nameDisplay: true,
  isPremium: true,
  instagramHandle: true,
  tiktokHandle: true,
  websiteUrl: true,
} satisfies Prisma.ProfessionalProfileSelect

export async function GET() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const profile = await prisma.professionalProfile.findUnique({
      where: { id: auth.professionalId },
      select: PRO_PROFILE_SELECT,
    })

    if (!profile) {
      return jsonFail(404, 'Professional profile not found.')
    }

    return jsonOk({ profile }, 200)
  } catch (e: unknown) {
    const res = prismaErrorToResponse(e)
    if (res) return res
    console.error('GET /api/v1/pro/profile error', e)
    return jsonFail(500, 'Failed to load profile.')
  }
}

export async function PATCH(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const proProfileId = auth.professionalId

    const body = await readJsonRecord(req)

    const current = await prisma.professionalProfile.findUnique({
      where: { id: proProfileId },
      select: {
        id: true,
        verificationStatus: true,
        handle: true,
        handleNormalized: true,
        isPremium: true,
      },
    })

    if (!current) {
      return jsonFail(404, 'Professional profile not found.')
    }

    const businessName = pickNonEmptyStringOrUndefined(body.businessName)
    const bio = pickNonEmptyStringOrUndefined(body.bio)
    const location = pickNonEmptyStringOrUndefined(body.location)
    const avatarUrl = pickNonEmptyStringOrUndefined(body.avatarUrl)

    // Social presence: absent = untouched, empty string = clear, otherwise
    // normalized (handles stored without "@"; website coerced to https).
    let instagramHandle: string | null | undefined = undefined
    if (typeof body.instagramHandle === 'string') {
      const trimmed = body.instagramHandle.trim()
      if (!trimmed) {
        instagramHandle = null
      } else {
        instagramHandle = normalizeSocialHandle(trimmed)
        if (!instagramHandle) {
          return jsonFail(400, 'Invalid Instagram handle.')
        }
      }
    }

    let tiktokHandle: string | null | undefined = undefined
    if (typeof body.tiktokHandle === 'string') {
      const trimmed = body.tiktokHandle.trim()
      if (!trimmed) {
        tiktokHandle = null
      } else {
        tiktokHandle = normalizeSocialHandle(trimmed)
        if (!tiktokHandle) {
          return jsonFail(400, 'Invalid TikTok handle.')
        }
      }
    }

    let websiteUrl: string | null | undefined = undefined
    if (typeof body.websiteUrl === 'string') {
      const trimmed = body.websiteUrl.trim()
      if (!trimmed) {
        websiteUrl = null
      } else {
        websiteUrl = normalizeWebsiteUrl(trimmed)
        if (!websiteUrl) {
          return jsonFail(400, 'Invalid website URL.')
        }
      }
    }

    const professionTypeRaw = pickNonEmptyStringOrUndefined(body.professionType)
    let professionType: ProfessionType | undefined = undefined

    if (professionTypeRaw !== undefined) {
      if (!isProfessionTypeValue(professionTypeRaw)) {
        return jsonFail(400, 'Invalid profession type.')
      }
      professionType = professionTypeRaw
    }

    const nameDisplayRaw = pickNonEmptyStringOrUndefined(body.nameDisplay)
    let nameDisplay: ProNameDisplay | undefined = undefined
    if (nameDisplayRaw !== undefined) {
      if (!isNameDisplayValue(nameDisplayRaw)) {
        return jsonFail(400, 'Invalid name display option.')
      }
      nameDisplay = nameDisplayRaw
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

        const formatError = handleFormatError(normalized)
        if (formatError) {
          return jsonFail(400, handleFormatMessage(formatError))
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
      ...(instagramHandle !== undefined ? { instagramHandle } : {}),
      ...(tiktokHandle !== undefined ? { tiktokHandle } : {}),
      ...(websiteUrl !== undefined ? { websiteUrl } : {}),
      ...(professionType !== undefined ? { professionType } : {}),
      ...(nameDisplay !== undefined ? { nameDisplay } : {}),
      ...(handleActuallyChanges
        ? {
            handle: nextHandle,
            handleNormalized: nextHandleNormalized,
            // Stamp a reservation only when a non-premium pro claims a handle, so the
            // release cron can reclaim it if they never subscribe. Premium pros (link
            // already live) and handle clears carry no reservation timer.
            handleReservedAt:
              nextHandleNormalized && !current.isPremium ? new Date() : null,
          }
        : {}),
    }

    try {
      const updated = await prisma.professionalProfile.update({
        where: { id: proProfileId },
        data,
        select: PRO_PROFILE_SELECT,
      })

      return jsonOk({ ok: true, profile: updated }, 200)
    } catch (e: unknown) {
      const res = prismaErrorToResponse(e)
      if (res) return res

      console.error('PATCH /api/v1/pro/profile prisma error', e)
      return jsonFail(500, 'Failed to update profile', {
        message: e instanceof Error ? e.message : String(e),
      })
    }
  } catch (e: unknown) {
    console.error('PATCH /api/v1/pro/profile error', e)
    return jsonFail(500, 'Failed to update profile', {
      message: e instanceof Error ? e.message : String(e),
    })
  }
}