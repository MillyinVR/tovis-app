// app/api/pro/clients/[id]/alert/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePro()
    if (auth.res) return auth.res

    const { id } = await context.params
    const clientId = pickString(id)
    if (!clientId) return jsonFail(400, 'Missing client id.')

    const body = (await req.json().catch(() => ({}))) as { alertBanner?: unknown }

    const raw = pickString(body.alertBanner)
    const alertBanner = raw ? raw.slice(0, 300) : null // keep it sane

    const updated = await prisma.clientProfile.update({
      where: { id: clientId },
      data: { alertBanner },
      select: { id: true, alertBanner: true },
    })

    return jsonOk(
      {
        client: {
          id: String(updated.id),
          alertBanner: updated.alertBanner ?? null,
        },
      },
      200,
    )
  } catch (err) {
    console.error('PATCH /api/pro/clients/[id]/alert error', err)
    return jsonFail(500, 'Failed to update client alert.')
  }
}
