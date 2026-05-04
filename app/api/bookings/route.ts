import { jsonFail } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

export async function GET() {
  return jsonFail(404, 'Not implemented. Use /api/bookings/* routes.')
}

export async function POST() {
  return jsonFail(404, 'Not implemented. Use /api/bookings/* routes.')
}
