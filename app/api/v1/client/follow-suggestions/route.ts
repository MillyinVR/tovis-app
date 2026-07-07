// GET /api/v1/client/follow-suggestions — "creators to follow" for the signed-in
// client (social-first D3). Ranks public client authors whose looks the viewer
// has liked, excluding the viewer and anyone they already follow.
import { jsonFail, jsonOk, pickInt, requireClient } from '@/app/api/_utils'
import { loadClientFollowSuggestions } from '@/lib/creator/followSuggestions'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const rawLimit = pickInt(new URL(req.url).searchParams.get('limit'))
    const limit =
      typeof rawLimit === 'number'
        ? Math.min(Math.max(rawLimit, 1), 20)
        : undefined

    const items = await loadClientFollowSuggestions(prisma, {
      viewerUserId: auth.user.id,
      viewerClientId: auth.clientId,
      limit,
    })

    return jsonOk({ ok: true, items })
  } catch (error) {
    console.error('GET /api/v1/client/follow-suggestions error', error)
    return jsonFail(500, 'Failed to load suggestions.')
  }
}
