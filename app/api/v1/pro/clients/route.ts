// app/api/v1/pro/clients/route.ts
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { upsertProClient } from '@/lib/clients/upsertProClient'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const body = await readJsonRecord(request)

    const result = await upsertProClient({
      professionalId: auth.professionalId,
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email,
      phone: body.phone,
    })

    if (!result.ok) {
      return jsonFail(result.status, result.error, { code: result.code })
    }

    return jsonOk(
      {
        id: result.clientId,
        clientId: result.clientId,
        userId: result.userId,
        email: result.email,
      },
      200,
    )
  } catch (error) {
    console.error('POST /api/v1/pro/clients error', error)
    return jsonFail(500, 'Internal server error')
  }
}