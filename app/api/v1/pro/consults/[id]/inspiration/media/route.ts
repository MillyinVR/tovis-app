import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { consultNotFoundResponse, consultWriteErrorResponse } from '@/lib/consult/apiErrors'
import { loadProInspirationSignedRead } from '@/lib/consult/inspirationContract'
import type { ConsultInspirationSignedReadResponseDTO } from '@/lib/dto/consult'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export async function GET(_request: Request, context: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const { id } = await resolveRouteParams(context)
    if (!id) return consultNotFoundResponse()
    return jsonOk<ConsultInspirationSignedReadResponseDTO>(
      await loadProInspirationSignedRead({
        consultSessionId: id,
        professionalId: auth.professionalId,
      }),
    )
  } catch (error) {
    const known = consultWriteErrorResponse(error)
    if (known) return known
    console.error('GET pro consult inspiration media error', {
      name: error instanceof Error ? error.name : 'UnknownError',
    })
    return jsonFail(500, 'Internal server error')
  }
}
