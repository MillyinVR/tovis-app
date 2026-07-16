// app/api/v1/support/tickets/route.ts
//
// Native support-ticket filing. The web `/support` page attributes a ticket from
// its session cookie, which a native caller can never present — bearer tokens are
// cookieless by design (see TovisClient), and an in-app browser pointed at
// `/support` would file every ticket as an anonymous GUEST. `SupportTicket` has
// no contact column, so an unattributed ticket reaches `/admin/support` with no
// way to reply. Hence a bearer-authenticated route: the ticket carries the real
// user and the admin queue can answer it.
//
// Create-only. There is no ticket read/list surface for clients yet.
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { pickStringOrEmpty } from '@/app/api/_utils/pick'
import { enforceRateLimit, rateLimitIdentity } from '@/app/api/_utils/rateLimit'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { serializeSupportTicket } from '@/lib/dto/supportTicket'
import { safeError } from '@/lib/security/logging'
import { createSupportTicket } from '@/lib/support/createSupportTicket'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = await requireUser()
  if (!auth.ok) return auth.res

  const limited = await enforceRateLimit({
    bucket: 'support:tickets:create',
    identity: await rateLimitIdentity(auth.user.id),
  })
  if (limited) return limited

  try {
    const body = await readJsonRecord(request)

    const result = await createSupportTicket({
      author: { id: auth.user.id, role: auth.user.role },
      subject: pickStringOrEmpty(body.subject),
      message: pickStringOrEmpty(body.message),
    })

    if (!result.ok) {
      return jsonFail(400, result.error.message, { code: result.error.code })
    }

    return jsonOk({ ticket: serializeSupportTicket(result.ticket) }, 201)
  } catch (error: unknown) {
    console.error('POST /api/v1/support/tickets error', { error: safeError(error) })
    return jsonFail(500, 'Failed to submit your request.')
  }
}
