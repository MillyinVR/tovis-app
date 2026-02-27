// app/api/pro/bookings/[id]/session-step/route.ts
import { SessionStep } from '@prisma/client'
import { transitionSessionStep } from '@/lib/booking/transitions'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

function parseStep(v: unknown): SessionStep | null {
  if (typeof v !== 'string') return null
  const s = v.trim().toUpperCase()
  return (Object.values(SessionStep) as string[]).includes(s) ? (s as SessionStep) : null
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (auth.res) return auth.res
    const proId = auth.professionalId

    const { id } = await Promise.resolve(ctx.params)
    const bookingId = pickString(id)
    if (!bookingId) return jsonFail(400, 'Missing booking id.')

    const body = (await req.json().catch(() => ({}))) as { step?: unknown }
    const nextStep = parseStep(body?.step)
    if (!nextStep) return jsonFail(400, 'Missing or invalid step.')

    const result = await transitionSessionStep({ bookingId, proId, nextStep })

    if (!result.ok) {
      // If a forced step is returned, send it back for UI healing
      return jsonFail(result.status, result.error, { forcedStep: result.forcedStep ?? null })
    }

    return jsonOk({ ok: true, booking: result.booking }, 200)
  } catch (e) {
    console.error('POST /api/pro/bookings/[id]/session-step error', e)
    return jsonFail(500, 'Internal server error')
  }
}