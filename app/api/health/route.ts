import { jsonOk } from '@/app/api/_utils'
import { getRuntimeFlags } from '@/lib/runtimeFlags'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const flags = await getRuntimeFlags()
  const redisStatus = flags.backendAvailable ? 'ok' : 'degraded'
  const overallStatus = redisStatus === 'ok' ? 'ok' : 'degraded'
  const statusCode = overallStatus === 'ok' ? 200 : 503

  return jsonOk(
    {
      service: 'tovis-app',
      status: overallStatus,
      timestamp: new Date().toISOString(),
      checks: {
        app: { status: 'ok' as const },
        redis: {
          status: redisStatus,
          backendAvailable: flags.backendAvailable,
        },
      },
    },
    statusCode,
  )
}