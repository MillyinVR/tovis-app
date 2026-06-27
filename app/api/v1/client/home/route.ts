// app/api/v1/client/home/route.ts
import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { safeError } from '@/lib/security/logging'
import { getClientHomeData } from '@/app/client/(gated)/_data/getClientHomeData'
import { serializeClientHomeData } from '@/lib/dto/clientHome'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const data = await getClientHomeData({
      clientId: auth.clientId,
      userId: auth.user.id,
    })

    return jsonOk({ home: serializeClientHomeData(data) }, 200)
  } catch (error: unknown) {
    console.error('GET /api/v1/client/home error', { error: safeError(error) })
    return jsonFail(500, 'Failed to load client home.')
  }
}
