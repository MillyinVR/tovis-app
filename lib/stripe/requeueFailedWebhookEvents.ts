// lib/stripe/requeueFailedWebhookEvents.ts
//
// Requeue Stripe webhook events whose live delivery failed.
//
// The webhook route persists every event (StripeWebhookEvent) before handling
// it and, on a thrown processing error, stamps `failedAt` + `lastError` and
// returns 500 — which makes Stripe retry. Stripe's native retries (~3 days with
// backoff) cover transient failures, and the live retry, on success, sets
// `processedAt`. But an event whose failure outlives Stripe's retry window (a
// long outage, a bug fixed days later) would otherwise stay stuck forever.
//
// This sweep finds events that are still `failedAt != null, processedAt == null`
// and replays their stored payload through the SAME `handleStripeEvent` path the
// live route uses, in the same kind of transaction. handleStripeEvent is
// idempotent (the write boundary keys off stripeEventId / payment state), so a
// replay is safe even if Stripe's own retry lands at the same time.

import type Stripe from 'stripe'

import { handleStripeEvent } from '@/lib/stripe/handleWebhookEvent'
import { applyLateCaptureCancelRefund } from '@/lib/booking/cancelRefund'
import { captureBookingException } from '@/lib/observability/bookingEvents'
import { prisma } from '@/lib/prisma'

const ROUTE = 'GET /api/internal/jobs/stripe-webhook-requeue'

// Stripe retries a failed delivery for ~3 days; look a little past that so an
// event only requeues here once its native retries are exhausted, but stop
// scanning truly ancient failures.
export const REQUEUE_WINDOW_DAYS = 7

// Give the live path + Stripe's near-term retries first crack before we step in.
export const REQUEUE_MIN_AGE_MINUTES = 30

// Safety cap per run; `capped` is surfaced so truncation is never silent.
export const MAX_EVENTS_PER_RUN = 100

export type RequeueOutcome = 'reprocessed' | 'still_failing' | 'invalid_payload'

export type WebhookRequeueResult = {
  stripeWebhookEventId: string
  stripeEventId: string
  eventType: string
  outcome: RequeueOutcome
  handled: boolean
  message: string
}

export type WebhookRequeueRunResult = {
  candidatesScanned: number
  capped: boolean
  tally: Record<RequeueOutcome, number>
  results: WebhookRequeueResult[]
}

const EMPTY_TALLY: Record<RequeueOutcome, number> = {
  reprocessed: 0,
  still_failing: 0,
  invalid_payload: 0,
}

type FailedEventRow = {
  id: string
  stripeEventId: string
  eventType: string
  payload: unknown
}

// The stored payload is a JSON round-trip of the original Stripe.Event. Replay
// needs the same fields handleStripeEvent reads: a string `id`, a string `type`,
// and a `data.object`. Validate that shape before trusting the cast.
function parseStoredStripeEvent(payload: unknown): Stripe.Event | null {
  if (!payload || typeof payload !== 'object') return null

  const record = payload as Record<string, unknown>
  if (typeof record.id !== 'string' || typeof record.type !== 'string') {
    return null
  }

  const data = record.data
  if (!data || typeof data !== 'object') return null
  if (!('object' in (data as Record<string, unknown>))) return null

  return payload as Stripe.Event
}

async function requeueEvent(row: FailedEventRow): Promise<WebhookRequeueResult> {
  const base = {
    stripeWebhookEventId: row.id,
    stripeEventId: row.stripeEventId,
    eventType: row.eventType,
  }

  const stripeEvent = parseStoredStripeEvent(row.payload)
  if (!stripeEvent) {
    // Nothing to replay (pre-payload-storage row, or a malformed payload). Leave
    // it failed for inspection rather than masking it as processed.
    return {
      ...base,
      outcome: 'invalid_payload',
      handled: false,
      message: 'Stored payload is not a replayable Stripe event.',
    }
  }

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const handled = await handleStripeEvent(tx, stripeEvent)

        await tx.stripeWebhookEvent.update({
          where: { id: row.id },
          data: { processedAt: new Date(), failedAt: null, lastError: null },
        })

        return handled
      },
      { timeout: 30_000, maxWait: 10_000 },
    )

    // Same contract as the live webhook route: a payment that replayed onto an
    // already-CANCELLED booking settles by the cancel's refund policy, after
    // the transaction commits. Best-effort — never throws.
    if (result.lateCaptureRefund) {
      await applyLateCaptureCancelRefund(result.lateCaptureRefund)
    }

    return {
      ...base,
      outcome: 'reprocessed',
      handled: result.handled,
      message: result.message,
    }
  } catch (error: unknown) {
    captureBookingException({
      error,
      route: ROUTE,
      event: 'WEBHOOK_REQUEUE_FAILED',
    })

    // Re-stamp the failure so the next sweep can retry and the error stays
    // visible. Best-effort: if this write also fails, the row keeps its prior
    // failedAt and is simply picked up again next run.
    await prisma.stripeWebhookEvent
      .update({
        where: { id: row.id },
        data: {
          failedAt: new Date(),
          lastError: error instanceof Error ? error.message : String(error),
        },
      })
      .catch(() => {})

    return {
      ...base,
      outcome: 'still_failing',
      handled: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function requeueFailedStripeWebhookEvents(opts?: {
  now?: Date
}): Promise<WebhookRequeueRunResult> {
  const now = opts?.now ?? new Date()
  const windowStart = new Date(now.getTime() - REQUEUE_WINDOW_DAYS * 24 * 3_600_000)
  const minAge = new Date(now.getTime() - REQUEUE_MIN_AGE_MINUTES * 60_000)

  const rows = await prisma.stripeWebhookEvent.findMany({
    where: {
      processedAt: null,
      failedAt: { gte: windowStart, lte: minAge },
    },
    select: {
      id: true,
      stripeEventId: true,
      eventType: true,
      payload: true,
    },
    orderBy: { failedAt: 'asc' },
    take: MAX_EVENTS_PER_RUN,
  })

  const results: WebhookRequeueResult[] = []
  for (const row of rows) {
    results.push(await requeueEvent(row))
  }

  const tally = results.reduce<Record<RequeueOutcome, number>>(
    (acc, result) => {
      acc[result.outcome] += 1
      return acc
    },
    { ...EMPTY_TALLY },
  )

  return {
    candidatesScanned: rows.length,
    capped: rows.length === MAX_EVENTS_PER_RUN,
    tally,
    results,
  }
}
