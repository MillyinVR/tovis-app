import { SessionStep } from '@prisma/client'
import { transitionSessionStep } from '@/lib/booking/writeBoundary'
import {
  SESSION_STEP_TRANSITIONS,
} from '@/lib/booking/lifecycleContract'
import { captureBookingException } from '@/lib/observability/bookingEvents'
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

/**
 * Returns true if `to` is a valid destination step from _any_ source step in
 * the PRO-allowed transition matrix.  This is a coarse pre-filter that blocks
 * obviously illegal targets (e.g. DONE, NONE) before we even hit the DB.
 */
function isReachableByPro(to: SessionStep): boolean {
  if (to === SessionStep.NONE) return false
  if (to === SessionStep.DONE) return false

  for (const [, toMap] of SESSION_STEP_TRANSITIONS) {
    const allowedActors = toMap.get(to)
    if (allowedActors && allowedActors.includes('PRO')) {
      return true
    }
  }
  return false
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

    // Server-side lifecycle contract pre-check: reject steps that PROs are never
    // allowed to transition to directly (e.g. DONE, NONE).  The fine-grained
    // from→to check is enforced inside transitionSessionStep / writeBoundary.
    if (!isReachableByPro(nextStep)) {
      return jsonFail(422, `Step "${nextStep}" cannot be set directly by this route.`)
    }

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
    captureBookingException({ error, route: 'POST /api/pro/bookings/[id]/session-step' })
    return jsonFail(500, 'Internal server error')
  }
}