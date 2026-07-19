// app/api/v1/bookings/[id]/status/route.ts
//
// Gone-stub for the retired status endpoint. The successor it named —
// `PATCH /api/v1/pro/bookings/[id]/status` — has never existed; the real
// handler is `PATCH /api/v1/pro/bookings/[id]` (app/api/v1/pro/bookings/[id]/
// route.ts), which takes the status transition in its body. Kept as a 410 (not
// deleted) so an old client gets a directed error instead of a bare 404.
import { jsonFail } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

export async function PATCH() {
  return jsonFail(
    410,
    'This endpoint has moved. Use PATCH /api/v1/pro/bookings/[id]',
  )
}
