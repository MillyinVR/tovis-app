// app/api/pro/profile/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

function pickNonEmptyStringOrUndefined(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t ? t : undefined
}

function pickStringOrNullOrUndefined(v: unknown): string | null | undefined {
  // undefined => don't change
  // "" => clear to null
  // "abc" => "abc"
  if (v === undefined) return undefined
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t ? t : null
}

/**
 * Vanity handle rules (DNS-safe for {handle}.tovis.me):
 * - 3–24 chars
 * - lowercase letters, numbers, hyphen
 * - must start + end with letter/number
 */
const HANDLE_MIN = 3
const HANDLE_MAX = 24

const RESERVED_HANDLES = new Set([
  'admin',
  'api',
  'www',
  'app',
  'support',
  'billing',
  'pricing',
  'login',
  'logout',
  'signup',
  'pro',
  'pros',
  'client',
  'clients',
  't',
  'c',
  'p',
  'nfc',
  'book',
  'booking',
  'messages',
  'looks',
  'professional',
  'professionals',
])

function normalizeHandle(raw: string) {
  return raw.trim().toLowerCase()
}

function isValidHandleNormalized(h: string) {
  if (h.length < HANDLE_MIN || h.length > HANDLE_MAX) return false
  if (!/^[a-z0-9-]+$/.test(h)) return false
  if (!/^[a-z0-9]/.test(h)) return false
  if (!/[a-z0-9]$/.test(h)) return false
  // NOTE: double hyphens are allowed (keeping your previous behavior)
  return true
}

function prismaErrorToResponse(e: any) {
  // Unique constraint
  if (e?.code === 'P2002') {
    return jsonFail(409, 'That handle is taken.')
  }

  // Prisma validation/known request errors
  if (e instanceof Prisma.PrismaClientValidationError) {
    return jsonFail(400, 'Invalid profile update payload.', { detail: e.message })
  }

  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    return jsonFail(400, 'Database rejected the update.', { code: e.code, detail: e.message })
  }

  // Fallback
  return null
}

export async function PATCH(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const proProfileId = auth.professionalId

    const body = await req.json().catch(() => ({} as any))

    const businessName = pickNonEmptyStringOrUndefined(body.businessName)
    const bio = pickNonEmptyStringOrUndefined(body.bio)
    const location = pickNonEmptyStringOrUndefined(body.location)
    const avatarUrl = pickNonEmptyStringOrUndefined(body.avatarUrl)

    // ✅ FIX: do NOT write "" into Prisma for an enum field
    // If they leave it blank, we simply don't update it.
    const professionType = pickNonEmptyStringOrUndefined(body.professionType)

    // Handle (optional)
    // - send handle: "tori" to set
    // - send handle: "" to clear (null)
    const handleRaw = typeof body.handle === 'string' ? body.handle : undefined
    const wantsHandleUpdate = handleRaw !== undefined

    let handle: string | null | undefined = undefined
    let handleNormalized: string | null | undefined = undefined

    if (wantsHandleUpdate) {
      const trimmed = handleRaw.trim()

      if (!trimmed) {
        handle = null
        handleNormalized = null
      } else {
        const normalized = normalizeHandle(trimmed)

        if (!isValidHandleNormalized(normalized)) {
          return jsonFail(
            400,
            `Handle must be ${HANDLE_MIN}-${HANDLE_MAX} chars and use only letters, numbers, and hyphens.`,
          )
        }
        if (RESERVED_HANDLES.has(normalized)) {
          return jsonFail(400, 'That handle is reserved.')
        }

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
    } catch (e: any) {
      const res = prismaErrorToResponse(e)
      if (res) return res
      console.error('PATCH /api/pro/profile prisma error', e)
      return jsonFail(500, 'Failed to update profile', {
        code: e?.code ?? null,
        message: e?.message ?? String(e),
      })
    }
  } catch (e: any) {
    console.error('PATCH /api/pro/profile error', e)
    return jsonFail(500, 'Failed to update profile', {
      message: e?.message ?? String(e),
    })
  }
}