// app/api/v1/bookings/[id]/status/route.ts
import { jsonFail } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

export async function PATCH() {
  return jsonFail(
    410,
    'This endpoint has moved. Use PATCH /api/v1/pro/bookings/[id]/status',
  )
}
