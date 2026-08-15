// app/api/v1/auth/logout/route.ts
import { jsonOk } from '@/app/api/_utils'
import { clearSessionCookie } from '@/app/api/_utils/auth/sessionCookie'

export async function POST(request: Request) {
  const res = jsonOk({ ok: true }, 200)

  clearSessionCookie({ response: res, request })

  return res
}
