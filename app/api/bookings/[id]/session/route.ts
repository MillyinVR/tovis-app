// app/api/bookings/[id]/session/route.ts
import { prisma } from '@/lib/prisma'
import { jsonOk, jsonFail } from '@/app/api/_utils/responses'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { pickString } from '@/app/api/_utils/pick'
import { rateLimitRedis } from '@/lib/rateLimitRedis'
import {
  startBookingSession,
  finishBookingSession,
  transitionSessionStep,
} from '@/lib/booking/writeBoundary'
import {
  recordStepTransition,
  LifecycleViolationError,
} from '@/lib/booking/lifecycleContract'
import { Role, SessionStep, MediaPhase } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Params = { id: string }
type Ctx = { params: Params | Promise<Params> }

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const auth = await requireUser({ roles: [Role.PRO, Role.CLIENT, Role.ADMIN] })
    if (!auth.ok) return auth.res

    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString(params?.id)
    if (!bookingId) return jsonFail(400, 'Booking ID is required.')

    const user = auth.user
    const clientId = user.clientProfile?.id ?? null
    const professionalId = user.professionalProfile?.id ?? null
    const isAdmin = user.role === Role.ADMIN

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        status: true,
        sessionStep: true,
        clientId: true,
        professionalId: true,
        consultationApproval: { select: { status: true } },
      },
    })

    if (!booking) return jsonFail(404, 'Booking not found.')

    const isClient = clientId != null && booking.clientId === clientId
    const isPro = professionalId != null && booking.professionalId === professionalId

    if (!isAdmin && !isClient && !isPro) {
      return jsonFail(403, 'Forbidden.')
    }

    const [beforeCount, afterCount] = await Promise.all([
      prisma.mediaAsset.count({ where: { bookingId, phase: MediaPhase.BEFORE } }),
      prisma.mediaAsset.count({ where: { bookingId, phase: MediaPhase.AFTER } }),
    ])

    return jsonOk({
      sessionStep: booking.sessionStep,
      status: booking.status,
      consultationApprovalStatus: booking.consultationApproval?.status ?? null,
      mediaPhases: {
        beforeCount,
        afterCount,
      },
    })
  } catch (err) {
    console.error('GET /api/bookings/[id]/session error', err)
    return jsonFail(500, 'Failed to fetch session.')
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const auth = await requireUser({ roles: [Role.PRO, Role.CLIENT, Role.ADMIN] })
    if (!auth.ok) return auth.res

    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString(params?.id)
    if (!bookingId) return jsonFail(400, 'Booking ID is required.')

    // Rate limit: 20 requests per 60 seconds per booking
    const rl = await rateLimitRedis({
      key: `session-step:${bookingId}`,
      limit: 20,
      windowSeconds: 60,
    })
    if (!rl.success) return jsonFail(429, 'Too many requests.')

    const body: unknown = await req.json().catch(() => ({}))
    const step = (body && typeof body === 'object' && 'step' in body)
      ? (body as Record<string, unknown>).step
      : null

    if (!step || typeof step !== 'string') {
      return jsonFail(400, 'step is required.')
    }

    // Validate the step value is a valid SessionStep
    if (!Object.values(SessionStep).includes(step as SessionStep)) {
      return jsonFail(400, `Invalid step: ${step}.`)
    }

    const nextStep = step as SessionStep

    const user = auth.user
    const clientId = user.clientProfile?.id ?? null
    const professionalId = user.professionalProfile?.id ?? null
    const isAdmin = user.role === Role.ADMIN
    const isPro = user.role === Role.PRO
    const isClient = user.role === Role.CLIENT

    // Fetch current booking
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        status: true,
        sessionStep: true,
        clientId: true,
        professionalId: true,
      },
    })

    if (!booking) return jsonFail(404, 'Booking not found.')

    // Access check
    const isProOnBooking = professionalId != null && booking.professionalId === professionalId
    const isClientOnBooking = clientId != null && booking.clientId === clientId

    if (!isAdmin && !isProOnBooking && !isClientOnBooking) {
      return jsonFail(403, 'Forbidden.')
    }

    const currentStep = booking.sessionStep ?? SessionStep.NONE

    // AFTER_PHOTOS → DONE: handled via aftercare finalize
    if (currentStep === SessionStep.AFTER_PHOTOS && nextStep === SessionStep.DONE) {
      return jsonFail(409, 'Use POST /api/bookings/[id]/aftercare to complete.')
    }

    // CONSULTATION_PENDING_CLIENT → BEFORE_PHOTOS: client OR pro allowed
    // All other transitions: only PRO or ADMIN
    const isClientAllowedTransition =
      currentStep === SessionStep.CONSULTATION_PENDING_CLIENT &&
      nextStep === SessionStep.BEFORE_PHOTOS

    if (!isAdmin && !isProOnBooking && !(isClientOnBooking && isClientAllowedTransition)) {
      return jsonFail(403, 'Only a professional may advance session steps.')
    }

    // Determine actor for lifecycle contract
    const actor = isAdmin ? 'ADMIN' : isProOnBooking ? 'PRO' : 'CLIENT'

    // Record the transition (validates or emits drift)
    try {
      recordStepTransition({
        from: currentStep,
        to: nextStep,
        actor,
        route: 'app/api/bookings/[id]/session/route.ts',
        bookingId,
        professionalId: booking.professionalId,
      })
    } catch (err) {
      if (err instanceof LifecycleViolationError) {
        return jsonFail(409, err.message)
      }
      throw err
    }

    // Route to the correct write boundary function
    if (currentStep === SessionStep.NONE && nextStep === SessionStep.CONSULTATION) {
      if (!professionalId) return jsonFail(403, 'Only a professional may start a session.')
      const result = await startBookingSession({ bookingId, professionalId })
      return jsonOk({
        sessionStep: result.booking.sessionStep,
        status: result.booking.status,
        meta: result.meta,
      })
    }

    if (currentStep === SessionStep.SERVICE_IN_PROGRESS && nextStep === SessionStep.FINISH_REVIEW) {
      if (!professionalId) return jsonFail(403, 'Only a professional may finish a service.')
      const result = await finishBookingSession({ bookingId, professionalId })
      return jsonOk({
        sessionStep: result.booking.sessionStep,
        status: result.booking.status,
        meta: result.meta,
      })
    }

    // For all other transitions, use the generic transitionSessionStep
    const proId = isProOnBooking ? professionalId : booking.professionalId
    if (!proId) return jsonFail(403, 'Could not resolve professional for this booking.')

    const result = await transitionSessionStep({
      bookingId,
      professionalId: proId,
      nextStep,
    })

    if (!result.ok) {
      return jsonFail(result.status ?? 409, result.error ?? 'Transition failed.')
    }

    return jsonOk({
      sessionStep: result.booking.sessionStep,
      meta: result.meta,
    })
  } catch (err) {
    console.error('PATCH /api/bookings/[id]/session error', err)
    return jsonFail(500, 'Failed to advance session step.')
  }
}
