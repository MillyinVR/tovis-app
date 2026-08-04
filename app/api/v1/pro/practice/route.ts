// app/api/v1/pro/practice/route.ts
//
// The pro PRACTICE library — shots taken with the standalone camera, i.e. the
// pro footer's centre button when NO session is live.
//
//   GET  → the library (newest first), each with a short-lived signed render URL
//   POST → confirm a signed upload into a PracticeShot
//
// Custody: no booking, nothing owed. A practice shot is not a MediaAsset (see
// the PracticeShot model), so creating one advances no session, touches no
// booking, and cannot surface in any portfolio / Looks / chart query. It becomes
// real media only via POST /pro/practice/[id]/attach.
//
// Like every other attach route, the storage pointer is read back from the
// UploadSession the signing route minted — never from the request body.

import { MediaType, UploadSurface } from '@prisma/client'

import { jsonFail, jsonOk, pickString, requirePro, upper } from '@/app/api/_utils'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import type {
  ProPracticeCreateResponseDTO,
  ProPracticeListResponseDTO,
} from '@/lib/dto/proPractice'
import { resolveFocalPoint } from '@/lib/media/focalPoint'
import {
  consumeUploadSession,
  UploadSessionError,
  validateUploadSession,
} from '@/lib/media/uploadSession'
import { prisma } from '@/lib/prisma'
import {
  isProPracticeDisabled,
  PRACTICE_CAPTION_MAX,
  PRACTICE_DISABLED_MESSAGE,
  PRACTICE_LIST_LIMIT,
  PRACTICE_SHOT_SELECT,
  toPracticeShotDTO,
  toPracticeShotDTOs,
} from '@/lib/proPractice'
import { safeError } from '@/lib/security/logging'
import { BUCKETS } from '@/lib/storageBuckets'
import { resolveProTenantId } from '@/lib/tenant/bookingAttribution'

export const dynamic = 'force-dynamic'

function parseMediaType(value: unknown): MediaType {
  return upper(value) === 'VIDEO' ? MediaType.VIDEO : MediaType.IMAGE
}

export async function GET() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    if (await isProPracticeDisabled()) {
      return jsonFail(503, PRACTICE_DISABLED_MESSAGE, {
        code: 'PRO_PRACTICE_DISABLED',
      })
    }

    const shots = await prisma.practiceShot.findMany({
      where: { professionalId: auth.professionalId },
      orderBy: { createdAt: 'desc' },
      take: PRACTICE_LIST_LIMIT,
      select: PRACTICE_SHOT_SELECT,
    })

    return jsonOk(
      { items: await toPracticeShotDTOs(shots) } satisfies ProPracticeListResponseDTO,
      200,
    )
  } catch (e) {
    console.error('GET /api/v1/pro/practice error', { error: safeError(e) })
    return jsonFail(500, 'Internal server error')
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    if (await isProPracticeDisabled()) {
      return jsonFail(503, PRACTICE_DISABLED_MESSAGE, {
        code: 'PRO_PRACTICE_DISABLED',
      })
    }

    const professionalId = auth.professionalId
    const body = await readJsonRecord(req)

    const uploadSessionId = pickString(body.uploadSessionId)
    if (!uploadSessionId) return jsonFail(400, 'Missing uploadSessionId.')

    const caption = pickString(body.caption)
    if (caption && caption.length > PRACTICE_CAPTION_MAX) {
      return jsonFail(400, `Caption must be ${PRACTICE_CAPTION_MAX} characters or fewer.`)
    }

    const mediaType = parseMediaType(body.mediaType)

    // Lenient like the booking-media route: a missing/malformed focal degrades
    // to null (center crop), never a 400 — it's a hint, not load-bearing.
    const focal = resolveFocalPoint(
      typeof body.focalX === 'number' ? body.focalX : null,
      typeof body.focalY === 'number' ? body.focalY : null,
    )

    let session
    try {
      session = await validateUploadSession(prisma, {
        uploadSessionId,
        surface: UploadSurface.PRO_PRACTICE,
        professionalId,
        now: new Date(),
      })
    } catch (sessionError: unknown) {
      if (sessionError instanceof UploadSessionError) {
        return jsonFail(sessionError.httpStatus, sessionError.message)
      }
      throw sessionError
    }

    // A practice shot is private, full stop — there is no consent conversation
    // behind it and no client in it by default. The signing route only ever
    // mints media-private for PRACTICE_PRIVATE; this refuses anything else
    // rather than trusting that, because a public-bucket practice shot would be
    // world-readable by URL.
    if (session.storageBucket !== BUCKETS.mediaPrivate) {
      return jsonFail(400, 'Practice shots must be uploaded to the private bucket.')
    }

    const shot = await prisma.$transaction(async (tx) => {
      const proTenantId = await resolveProTenantId(tx, professionalId)

      const created = await tx.practiceShot.create({
        data: {
          professionalId,
          proTenantId,
          storageBucket: session.storageBucket,
          storagePath: session.storagePath,
          contentType: session.contentType,
          mediaType,
          caption: caption ?? null,
          focalX: focal?.x ?? null,
          focalY: focal?.y ?? null,
        },
        select: PRACTICE_SHOT_SELECT,
      })

      // Consume in the same transaction: a concurrent second confirm updates 0
      // rows and rolls this create back, so one upload can never mint two shots.
      // No mediaAssetId — a practice shot deliberately isn't one.
      await consumeUploadSession(tx, { uploadSessionId, now: new Date() })

      return created
    })

    return jsonOk(
      { shot: await toPracticeShotDTO(shot) } satisfies ProPracticeCreateResponseDTO,
      201,
    )
  } catch (e) {
    if (e instanceof UploadSessionError) {
      return jsonFail(e.httpStatus, e.message)
    }
    console.error('POST /api/v1/pro/practice error', { error: safeError(e) })
    return jsonFail(500, 'Internal server error')
  }
}
