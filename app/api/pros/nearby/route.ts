// app/api/pros/nearby/route.ts
import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import { loadNearbyPros } from '@/lib/discovery/nearbyPros'

export const dynamic = 'force-dynamic'

function pickNumber(value: string | null): number | null {
  if (!value) return null

  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)))
}

function normalizeOptionalId(value: string | null): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed.length > 0 ? trimmed : null
}

function isValidLatitude(value: number): boolean {
  return value >= -90 && value <= 90
}

function isValidLongitude(value: number): boolean {
  return value >= -180 && value <= 180
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)

    if (searchParams.has('radius')) {
      return jsonFail(400, 'Use radiusMiles. radius is not supported on this route.')
    }

    if (searchParams.has('category')) {
      return jsonFail(400, 'Use categoryId. category is not supported on this route.')
    }

    if (searchParams.has('offering') || searchParams.has('offeringId')) {
      return jsonFail(400, 'Use serviceId for exact offering matching on this route.')
    }

    if (searchParams.has('cursor')) {
      return jsonFail(400, 'Cursor pagination is not supported on this route yet.')
    }

    const lat = pickNumber(searchParams.get('lat'))
    const lng = pickNumber(searchParams.get('lng'))

    if (lat == null || !isValidLatitude(lat)) {
      return jsonFail(400, 'Valid lat is required.')
    }

    if (lng == null || !isValidLongitude(lng)) {
      return jsonFail(400, 'Valid lng is required.')
    }

    const radiusMiles = (() => {
      const raw = pickNumber(searchParams.get('radiusMiles')) ?? 15
      return clampInt(raw, 1, 100)
    })()

    const limit = (() => {
      const raw = pickNumber(searchParams.get('limit')) ?? 20
      return clampInt(raw, 1, 50)
    })()

    const categoryId = normalizeOptionalId(
      pickString(searchParams.get('categoryId')),
    )

    const serviceId = normalizeOptionalId(
      pickString(searchParams.get('serviceId')),
    )

    const excludeProfessionalId = normalizeOptionalId(
      pickString(searchParams.get('excludeProfessionalId')),
    )

    const pros = await loadNearbyPros({
      lat,
      lng,
      radiusMiles,
      categoryId,
      serviceId,
      excludeProfessionalId,
      limit,
    })

    return jsonOk({
      ok: true,
      pros,
    })
  } catch (e) {
    console.error('GET /api/pros/nearby error', e)
    return jsonFail(500, 'Failed to load nearby pros.')
  }
}