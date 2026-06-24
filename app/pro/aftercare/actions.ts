// app/pro/aftercare/actions.ts
'use server'

import { revalidatePath } from 'next/cache'

import { requirePro } from '@/app/api/_utils/auth/requirePro'
import {
  nudgeAftercareRebook,
  sendExistingAftercareDraft,
} from '@/lib/booking/writeBoundary'
import { isBookingError } from '@/lib/booking/errors'
import { COPY } from '@/lib/copy'
import { kickNotificationDrain } from '@/lib/notifications/delivery/kickNotificationDrain'
import { enforceRateLimit } from '@/lib/rateLimit/enforce'
import { rateLimitKey } from '@/lib/rateLimit/identity'

const PRO_AFTERCARE_ROUTE = '/pro/aftercare'

export type AftercareActionResult = { ok: true } | { ok: false; error: string }

function normalizeBookingId(value: unknown): string | null {
  const id = typeof value === 'string' ? value.trim() : ''
  return id ? id : null
}

async function runAftercareAction(
  bookingId: unknown,
  fallbackError: string,
  run: (args: {
    bookingId: string
    professionalId: string
    actorUserId: string
  }) => Promise<unknown>,
): Promise<AftercareActionResult> {
  const id = normalizeBookingId(bookingId)
  if (!id) return { ok: false, error: fallbackError }

  const auth = await requirePro()
  if (!auth.ok) return { ok: false, error: fallbackError }

  // Spam protection — share the same write bucket the aftercare API uses.
  const decision = await enforceRateLimit({
    bucket: 'pro:bookings:write',
    key: rateLimitKey([auth.professionalId, auth.userId]),
  })
  if (!decision.allowed) {
    return { ok: false, error: fallbackError }
  }

  try {
    await run({
      bookingId: id,
      professionalId: auth.professionalId,
      actorUserId: auth.userId,
    })
  } catch (error: unknown) {
    if (isBookingError(error)) {
      return { ok: false, error: error.userMessage || fallbackError }
    }
    console.error('pro aftercare action failed', { bookingId: id, error })
    return { ok: false, error: fallbackError }
  }

  // The magic-link email/SMS was enqueued inside the committed transaction —
  // deliver it now rather than waiting for the cron tick.
  kickNotificationDrain()
  revalidatePath(PRO_AFTERCARE_ROUTE)
  return { ok: true }
}

/** Send a saved aftercare draft to the client (the draft-card "Send" action). */
export async function sendAftercareAction(
  bookingId: string,
): Promise<AftercareActionResult> {
  return runAftercareAction(
    bookingId,
    COPY.proAftercareList.sendError,
    sendExistingAftercareDraft,
  )
}

/** Re-ping a client about an already-sent aftercare (the "Nudge" action). */
export async function nudgeAftercareAction(
  bookingId: string,
): Promise<AftercareActionResult> {
  return runAftercareAction(
    bookingId,
    COPY.proAftercareList.nudgeError,
    nudgeAftercareRebook,
  )
}
