// app/api/v1/client/self-profile/route.ts
//
// The client's personalization self-profile (spec §6.6): optional, fully
// user-entered chips — hair type/length/color, skin type/concern, and declared
// category interests. GET returns the validated profile; PATCH applies
// per-field updates (null / '' clears a field). Validation lives in
// lib/personalization/selfProfile.ts (the SSOT); this route never stores or
// serves anything that module wouldn't validate.

import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { parseSelfProfileInput } from '@/lib/personalization/selfProfile'
import {
  readClientSelfProfile,
  writeClientSelfProfilePatch,
} from '@/lib/personalization/selfProfileStore'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requireClient()
  if (!auth.ok) return auth.res

  const record = await readClientSelfProfile(prisma, auth.clientId)
  if (!record) return jsonFail(404, 'Client profile not found.')

  return jsonOk({
    selfProfile: record.selfProfile,
    updatedAt: record.selfProfileUpdatedAt?.toISOString() ?? null,
  })
}

export async function PATCH(req: Request) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const body = await readJsonRecord(req)

    const parsed = parseSelfProfileInput(body)
    if (!parsed.ok) {
      return jsonFail(400, parsed.error.message, { code: parsed.error.code })
    }

    const record = await writeClientSelfProfilePatch(prisma, {
      clientId: auth.clientId,
      patch: parsed.value,
      now: new Date(),
    })
    if (!record) return jsonFail(404, 'Client profile not found.')

    return jsonOk({
      ok: true,
      selfProfile: record.selfProfile,
      updatedAt: record.selfProfileUpdatedAt?.toISOString() ?? null,
    })
  } catch (e: unknown) {
    console.error('PATCH /api/v1/client/self-profile error', e)
    return jsonFail(500, 'Failed to update your profile.')
  }
}
