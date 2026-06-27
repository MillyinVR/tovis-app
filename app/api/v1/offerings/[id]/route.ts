// app/api/v1/offerings/[id]/route.ts
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { pickString } from '@/app/api/_utils/pick'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { getCurrentUser } from '@/lib/currentUser'
import { safeError } from '@/lib/security/logging'
import { loadOfferingDetail } from '@/app/(main)/offerings/[offeringId]/_data/loadOfferingDetail'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, ctx: RouteContext<{ id: string }>) {
  try {
    const { id: offeringId } = await resolveRouteParams(ctx)

    const { searchParams } = new URL(req.url)
    const openingId = pickString(searchParams.get('openingId'))
    const scheduledForRaw = pickString(searchParams.get('scheduledFor'))

    // Optional client viewer — drives recipient-tier incentive + default address.
    const user = await getCurrentUser().catch(() => null)
    const clientId = user?.clientProfile?.id ?? null

    const detail = await loadOfferingDetail({
      offeringId,
      openingId,
      scheduledForRaw,
      clientId,
    })

    // loadOfferingDetail returns the already-JSON-safe DTO (openingDto mappers
    // convert Decimal -> string; instants serialized to ISO).
    if (!detail.claimable) {
      return jsonFail(404, 'This opening is no longer available.')
    }

    return jsonOk({ offering: detail }, 200)
  } catch (error: unknown) {
    console.error('GET /api/v1/offerings/[id] error', { error: safeError(error) })
    return jsonFail(500, 'Failed to load offering.')
  }
}
