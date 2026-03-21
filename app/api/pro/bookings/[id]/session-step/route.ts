// app/api/pro/bookings/[id]/session-step/route.ts
import { SessionStep } from '@prisma/client'
import { transitionSessionStep } from '@/lib/booking/writeBoundary'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

function parseStep(v: unknown): SessionStep | null {
  if (typeof v !== 'string') return null
  const s = v.trim().toUpperCase()
  return (Object.values(SessionStep) as string[]).includes(s)
    ? (s as SessionStep)
    : null
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId

    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString(params?.id)
    if (!bookingId) return jsonFail(400, 'Missing booking id.')

    const body = (await req.json().catch(() => ({}))) as { step?: unknown }
    const nextStep = parseStep(body?.step)
    if (!nextStep) return jsonFail(400, 'Missing or invalid step.')

    const result = await transitionSessionStep({
      bookingId,
      professionalId,
      nextStep,
    })

    if (!result.ok) {
      return jsonFail(result.status, result.error, {
        forcedStep: result.forcedStep ?? null,
      })
    }

    return jsonOk({ booking: result.booking }, 200)
  } catch (error) {
    console.error('POST /api/pro/bookings/[id]/session-step error', error)
    return jsonFail(500, 'Internal server error')
  }
}