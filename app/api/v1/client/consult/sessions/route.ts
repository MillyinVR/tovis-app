import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import { loadClientConsultSessions } from '@/lib/consult/clientSessions'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const auth = await requireClient()
  if (!auth.ok) return auth.res
  const cursor = new URL(req.url).searchParams.get('cursor') ?? undefined
  if (cursor && (cursor.length > 100 || !/^[a-zA-Z0-9_-]+$/.test(cursor))) return jsonFail(400, 'Invalid cursor.')
  try {
    return jsonOk(await loadClientConsultSessions(auth.clientId, cursor))
  } catch (error) {
    console.error('GET consult sessions', { error: safeError(error) })
    return jsonFail(500, 'Internal server error')
  }
}
