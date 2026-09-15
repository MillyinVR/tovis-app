// app/api/v1/pro/viral-requests/[id]/offer/route.ts
//
// A pro's answer to a matched viral look: POST to offer it, DELETE to withdraw.
//
// Both verbs run the SAME gate inside `lib/viralRequests/proLibrary` — the look
// must be live AND this pro must have been matched to it. The match check is
// load-bearing: without it, any pro could opt into any approved look by id, and
// the client-facing "N pros now offer this" would go back to being a number
// nobody earned.
//
// 🔴 Both refusals answer 404, not 403. Whether a given viral look exists, and
// whether it matched some other pro's services, is not this pro's business —
// distinguishing the two would turn the endpoint into a probe for looks the
// caller was never matched to.
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import {
  buildProViralRequestDTO,
  type ProViralRequestOfferResponseDTO,
} from '@/lib/dto/proViralRequests'
import {
  offerViralRequestAsPro,
  withdrawViralRequestOfferAsPro,
  type ProViralOfferResult,
} from '@/lib/viralRequests/proLibrary'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

function respond(result: ProViralOfferResult) {
  if (!result.ok) return jsonFail(404, 'Not found.')

  const response: ProViralRequestOfferResponseDTO = {
    request: buildProViralRequestDTO(result.entry),
  }
  return jsonOk(response)
}

export async function POST(_req: Request, ctx: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const { id } = await ctx.params
    const viralRequestId = id.trim()
    if (!viralRequestId) return jsonFail(404, 'Not found.')

    return respond(
      await offerViralRequestAsPro({
        professionalId: auth.professionalId,
        viralRequestId,
      }),
    )
  } catch (e) {
    console.error('POST /api/v1/pro/viral-requests/[id]/offer error', e)
    return jsonFail(500, 'Failed to update your answer.')
  }
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const { id } = await ctx.params
    const viralRequestId = id.trim()
    if (!viralRequestId) return jsonFail(404, 'Not found.')

    return respond(
      await withdrawViralRequestOfferAsPro({
        professionalId: auth.professionalId,
        viralRequestId,
      }),
    )
  } catch (e) {
    console.error('DELETE /api/v1/pro/viral-requests/[id]/offer error', e)
    return jsonFail(500, 'Failed to update your answer.')
  }
}
