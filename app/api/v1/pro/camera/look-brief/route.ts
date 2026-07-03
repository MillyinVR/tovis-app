// POST /api/v1/pro/camera/look-brief — AI-enhance a "Match a look" reference
// photo for the native AI-photographer camera. The on-device analyzer already
// measures geometry; Claude vision adds what geometry can't see (expression,
// head angle, hand styling, light direction) as pose rules in the camera's
// fixed vocabulary plus spoken direction lines.
//
// The image is analyzed in-flight and never stored or logged; the pro
// consents in-app before anything leaves the device. Free with a daily cap
// (see lib/rateLimit/policies.ts).
import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { enforceRateLimit, rateLimitIdentity } from '@/app/api/_utils/rateLimit'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import {
  enforceCameraImageQuota,
  recordCameraImageUse,
} from '@/lib/pro/cameraQuota'
import { cameraQuotaExceededResponse } from '@/lib/pro/cameraQuotaResponse'
import {
  CameraVisionError,
  LOOK_IMAGE_MAX_BASE64_CHARS,
  enhanceReferenceLook,
  parseCameraVisionImage,
} from '@/lib/pro/cameraVision'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// Vision analysis is a single long upstream call, not CPU work.
export const maxDuration = 60

export async function POST(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const limited = await enforceRateLimit({
      bucket: 'pro:camera:look-brief',
      identity: await rateLimitIdentity(auth.userId),
    })
    if (limited) return limited

    const quota = await enforceCameraImageQuota({
      professionalId: auth.professionalId,
      imageCount: 1,
    })
    if (!quota.allowed) return cameraQuotaExceededResponse(quota)

    const body = await readJsonRecord(req)

    const parsed = parseCameraVisionImage(
      body.image,
      LOOK_IMAGE_MAX_BASE64_CHARS,
    )
    if (!parsed.ok) return jsonFail(400, parsed.error)

    const brief = await enhanceReferenceLook({
      image: parsed.image,
      serviceName: pickString(body.serviceName),
      measuredSummary: pickString(body.measuredSummary),
    })

    await recordCameraImageUse({
      professionalId: auth.professionalId,
      imageCount: 1,
    })

    return jsonOk({ brief })
  } catch (error) {
    if (error instanceof CameraVisionError) {
      // Never log request bodies here — they carry the image bytes.
      console.error(
        'POST /api/v1/pro/camera/look-brief vision error',
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
        'The AI photographer couldn’t read this photo. Try a different one.',
      )
    }

    console.error('POST /api/v1/pro/camera/look-brief error', error)
    return jsonFail(500, 'Internal server error')
  }
}
