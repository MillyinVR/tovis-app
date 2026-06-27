// app/api/v1/pro/allowed-services/route.ts
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { loadAllowedServices } from '@/lib/services/allowedServices'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const services = await loadAllowedServices(auth.professionalId)
    return jsonOk({ services }, 200)
  } catch (error) {
    console.error('Allowed services error', error)
    return jsonFail(500, 'Internal server error')
  }
}
