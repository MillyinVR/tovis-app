// POST /api/v1/pro/camera/set-critique — a photographer's review of the
// captured before/after session set, for the native camera's wrap-up screen:
// what's strong, what to retake and why, which shots are portfolio-worthy.
// Claude vision judges the downscaled set the app sends; per-photo notes are
// keyed back to the caller's photo ids.
//
// Images are analyzed in-flight and never stored or logged; the pro consents
// in-app before anything leaves the device. Free with a daily cap (see
// lib/rateLimit/policies.ts).
import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { enforceRateLimit, rateLimitIdentity } from '@/app/api/_utils/rateLimit'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { isRecord } from '@/lib/guards'
import {
  enforceCameraImageQuota,
  recordCameraImageUse,
} from '@/lib/pro/cameraQuota'
import { cameraQuotaExceededResponse } from '@/lib/pro/cameraQuotaResponse'
import {
  CRITIQUE_MAX_PHOTOS,
  CRITIQUE_MIN_PHOTOS,
  CRITIQUE_PHOTO_MAX_BASE64_CHARS,
  CRITIQUE_TOTAL_MAX_BASE64_CHARS,
  CameraVisionError,
  critiqueSessionSet,
  parseCameraVisionImage,
  type SetCritiquePhase,
  type SetCritiquePhotoInput,
} from '@/lib/pro/cameraVision'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// Vision analysis is a single long upstream call, not CPU work.
export const maxDuration = 60

type ParsedPhotos =
  | { ok: true; photos: SetCritiquePhotoInput[] }
  | { ok: false; error: string }

function parsePhase(value: unknown): SetCritiquePhase | null {
  const raw = pickString(value)
  if (raw === 'BEFORE' || raw === 'AFTER') return raw
  return null
}

function parsePhotos(value: unknown): ParsedPhotos {
  if (!Array.isArray(value) || value.length < CRITIQUE_MIN_PHOTOS) {
    return { ok: false, error: 'Send at least one photo to review.' }
  }
  if (value.length > CRITIQUE_MAX_PHOTOS) {
    return {
      ok: false,
      error: `Send at most ${CRITIQUE_MAX_PHOTOS} photos per review.`,
    }
  }

  const photos: SetCritiquePhotoInput[] = []
  const seenIds = new Set<string>()
  let totalBase64Chars = 0

  for (const item of value) {
    if (!isRecord(item)) {
      return { ok: false, error: 'Invalid photo entry.' }
    }

    const id = pickString(item.id)
    if (!id || id.length > 100) {
      return { ok: false, error: 'Each photo needs an id.' }
    }
    if (seenIds.has(id)) {
      return { ok: false, error: 'Photo ids must be unique.' }
    }
    seenIds.add(id)

    const phase = parsePhase(item.phase)
    if (!phase) {
      return { ok: false, error: 'Each photo needs a BEFORE or AFTER phase.' }
    }

    const parsed = parseCameraVisionImage(
      item.image,
      CRITIQUE_PHOTO_MAX_BASE64_CHARS,
    )
    if (!parsed.ok) return { ok: false, error: parsed.error }

    totalBase64Chars += parsed.image.base64.length
    if (totalBase64Chars > CRITIQUE_TOTAL_MAX_BASE64_CHARS) {
      return { ok: false, error: 'The photo set is too large.' }
    }

    photos.push({ id, phase, image: parsed.image })
  }

  return { ok: true, photos }
}

export async function POST(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const limited = await enforceRateLimit({
      bucket: 'pro:camera:set-critique',
      identity: await rateLimitIdentity(auth.userId),
    })
    if (limited) return limited

    const body = await readJsonRecord(req)

    const parsed = parsePhotos(body.photos)
    if (!parsed.ok) return jsonFail(400, parsed.error)

    const quota = await enforceCameraImageQuota({
      professionalId: auth.professionalId,
      imageCount: parsed.photos.length,
    })
    if (!quota.allowed) return cameraQuotaExceededResponse(quota)

    const critique = await critiqueSessionSet({
      photos: parsed.photos,
      serviceName: pickString(body.serviceName),
    })

    await recordCameraImageUse({
      professionalId: auth.professionalId,
      imageCount: parsed.photos.length,
    })

    return jsonOk({ critique })
  } catch (error) {
    if (error instanceof CameraVisionError) {
      // Never log request bodies here — they carry the image bytes.
      console.error(
        'POST /api/v1/pro/camera/set-critique vision error',
        error.kind,
        error.message,
      )
      if (error.kind === 'unavailable') {
        return jsonFail(
          502,
          'The AI photographer is unavailable right now. Please try again.',
        )
      }
      return jsonFail(
        422,
        'The AI photographer couldn’t review this set. Please try again.',
      )
    }

    console.error('POST /api/v1/pro/camera/set-critique error', error)
    return jsonFail(500, 'Internal server error')
  }
}
