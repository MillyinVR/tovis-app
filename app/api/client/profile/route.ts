// app/api/client/profile/route.ts
//
// Client public-creator identity: claim an @handle, opt into a public profile,
// set a public bio. Mirrors the pro handle-claim pattern (app/api/pro/profile)
// but for ClientProfile — clients self-serve their public/private state (no
// approval gate). The public profile lives at /u/[handle].

import { Prisma } from '@prisma/client'

import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import {
  HANDLE_MAX,
  HANDLE_MIN,
  isHandleReserved,
  isValidHandle,
  normalizeHandle,
} from '@/lib/handles'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const PUBLIC_BIO_MAX = 280

const clientPublicProfileSelect = {
  id: true,
  handle: true,
  isPublicProfile: true,
  publicBio: true,
} satisfies Prisma.ClientProfileSelect

function prismaErrorToResponse(e: unknown): Response | null {
  if (typeof e === 'object' && e !== null && 'code' in e && e.code === 'P2002') {
    return jsonFail(409, 'That handle is taken.')
  }
  return null
}

export async function GET() {
  const auth = await requireClient()
  if (!auth.ok) return auth.res

  const profile = await prisma.clientProfile.findUnique({
    where: { id: auth.clientId },
    select: clientPublicProfileSelect,
  })

  if (!profile) return jsonFail(404, 'Client profile not found.')

  return jsonOk({ profile })
}

export async function PATCH(req: Request) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const body = await readJsonRecord(req)

    const current = await prisma.clientProfile.findUnique({
      where: { id: auth.clientId },
      select: clientPublicProfileSelect,
    })
    if (!current) return jsonFail(404, 'Client profile not found.')

    // Handle (optional update; empty string clears it).
    const handleRaw = typeof body.handle === 'string' ? body.handle : undefined
    const wantsHandleUpdate = handleRaw !== undefined
    let nextHandle: string | null | undefined
    let nextHandleNormalized: string | null | undefined

    if (wantsHandleUpdate) {
      const trimmed = handleRaw.trim()
      if (!trimmed) {
        nextHandle = null
        nextHandleNormalized = null
      } else {
        const normalized = normalizeHandle(trimmed)
        if (!isValidHandle(normalized)) {
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

    // Public bio (optional; empty string clears it).
    const bioRaw = typeof body.publicBio === 'string' ? body.publicBio : undefined
    let nextBio: string | null | undefined
    if (bioRaw !== undefined) {
      const trimmed = bioRaw.trim()
      if (trimmed.length > PUBLIC_BIO_MAX) {
        return jsonFail(400, `Bio must be ${PUBLIC_BIO_MAX} characters or fewer.`)
      }
      nextBio = trimmed ? trimmed : null
    }

    // Public toggle.
    const wantsPublicUpdate = typeof body.isPublicProfile === 'boolean'
    const nextIsPublic = wantsPublicUpdate
      ? (body.isPublicProfile as boolean)
      : undefined

    // A public profile must have a handle. Compute the resulting state and reject
    // "go public without a handle".
    const resultingHandle =
      nextHandleNormalized !== undefined
        ? nextHandleNormalized
        : current.handle
          ? normalizeHandle(current.handle)
          : null
    const resultingIsPublic =
      nextIsPublic !== undefined ? nextIsPublic : current.isPublicProfile

    if (resultingIsPublic && !resultingHandle) {
      return jsonFail(400, 'Choose a handle before making your profile public.')
    }

    const data: Prisma.ClientProfileUpdateInput = {
      ...(wantsHandleUpdate
        ? { handle: nextHandle, handleNormalized: nextHandleNormalized }
        : {}),
      ...(nextBio !== undefined ? { publicBio: nextBio } : {}),
      ...(nextIsPublic !== undefined ? { isPublicProfile: nextIsPublic } : {}),
    }

    try {
      const updated = await prisma.clientProfile.update({
        where: { id: auth.clientId },
        data,
        select: clientPublicProfileSelect,
      })

      return jsonOk({ ok: true, profile: updated }, 200)
    } catch (e: unknown) {
      const res = prismaErrorToResponse(e)
      if (res) return res
      throw e
    }
  } catch (e: unknown) {
    console.error('PATCH /api/client/profile error', e)
    return jsonFail(500, 'Failed to update profile.')
  }
}
