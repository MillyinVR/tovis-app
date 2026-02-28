// app/api/pro/reminders/run/[id]/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, props: Params) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const { id } = await props.params
    const reminderId = String(id || '').trim()
    if (!reminderId) return jsonFail(400, 'Missing reminder id.')

    const body = await req.json().catch(() => ({} as any))
    const completed = body?.completed

    if (typeof completed !== 'boolean') {
      return jsonFail(400, 'completed:boolean is required')
    }

    const existing = await prisma.reminder.findUnique({
      where: { id: reminderId },
      select: { id: true, professionalId: true },
    })

    if (!existing || existing.professionalId !== professionalId) {
      return jsonFail(404, 'Not found')
    }

    const updated = await prisma.reminder.update({
      where: { id: reminderId },
      data: { completedAt: completed ? new Date() : null },
      select: { id: true, completedAt: true },
    })

    return jsonOk(
      {
        id: updated.id,
        completedAt: updated.completedAt?.toISOString() ?? null,
      },
      200,
    )
  } catch (e) {
    console.error('PATCH /api/pro/reminders/run/[id] error', e)
    return jsonFail(500, 'Internal server error')
  }
}
