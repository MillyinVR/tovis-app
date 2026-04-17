// app/api/auth/session/next-url/route.ts
import { jsonOk } from '@/app/api/_utils'
import { requireUser } from '@/app/api/_utils/auth/requireUser'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const auth = await requireUser({ allowVerificationSession: true })
  if (!auth.ok) return auth.res

  // Replace this lookup with the same persisted source written by consumeTapIntent().
  // Do not use getPostVerificationNextUrl() here.
  const nextUrl = null

  return jsonOk({ nextUrl })
}