// GET /api/v1/pro/bookings/[id]/media/evidence-bundle
//
// Streams a PDF "evidence bundle" for a booking: the original session photos,
// a stamped reference copy of each, and the capture-attestation record for
// each one — for the pro to attach to a chargeback/dispute response. See
// lib/media/evidenceBundlePdf.ts for the exact honesty framing (what a
// server-computed hash proves vs. a device-claimed capture time).
import { jsonFail, requirePro } from '@/app/api/_utils'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { pickString } from '@/app/api/_utils'
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { resolveTenantContextForRequest } from '@/lib/tenant/requestContext'
import { gatherEvidenceBundleData } from '@/lib/media/evidenceBundleData'
import { buildEvidenceBundlePdf } from '@/lib/media/evidenceBundlePdf'
import { captureBookingException } from '@/lib/observability/bookingEvents'
import { safeError } from '@/lib/security/logging'
import { enforceRateLimit } from '@/lib/rateLimit/enforce'
import { proRateLimitKey } from '@/lib/rateLimit/identity'
import { rateLimitExceededResponse } from '@/lib/rateLimit/response'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request, ctx: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const params = await resolveRouteParams(ctx)
    const bookingId = pickString(params.id)

    if (!bookingId) {
      return jsonFail(400, 'Missing booking id.')
    }

    const rateLimit = await enforceRateLimit({
      bucket: 'pro:media:evidence-bundle',
      key: proRateLimitKey({
        professionalId,
        userId: auth.user.id,
        request: req,
      }),
    })

    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit)
    }

    const outcome = await gatherEvidenceBundleData({ bookingId, professionalId })

    if (!outcome.ok) {
      return jsonFail(outcome.status, outcome.error)
    }

    const tenantContext = await resolveTenantContextForRequest(req)
    const brand = getBrandForTenantContext(tenantContext)

    const { filename, bytes } = await buildEvidenceBundlePdf(
      outcome.data,
      brand.displayName,
    )

    return new Response(Buffer.from(bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error: unknown) {
    console.error('GET /api/v1/pro/bookings/[id]/media/evidence-bundle error', {
      error: safeError(error),
    })

    captureBookingException({
      error,
      route: 'GET /api/v1/pro/bookings/[id]/media/evidence-bundle',
    })

    return jsonFail(500, 'Internal server error')
  }
}
