import type Stripe from 'stripe'
import { Prisma } from '@prisma/client'
import { safeError } from '@/lib/security/logging'
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { prisma } from '@/lib/prisma'
import { getStripe, getStripeWebhookSecret } from '@/lib/stripe/server'
import { handleStripeEvent } from '@/lib/stripe/handleWebhookEvent'
import { applyLateCaptureCancelRefund } from '@/lib/booking/cancelRefund'

export const dynamic = 'force-dynamic'

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

async function markEventFailed(args: {
  stripeEventId: string
  error: unknown
}): Promise<void> {
  await prisma.stripeWebhookEvent.update({
    where: { stripeEventId: args.stripeEventId },
    data: {
      failedAt: new Date(),
      lastError:
        args.error instanceof Error ? args.error.message : String(args.error),
    },
  })
}

export async function POST(req: Request) {
  const stripeSignature = req.headers.get('stripe-signature')

  if (!stripeSignature) {
    return jsonFail(400, 'Missing Stripe signature.', {
      code: 'STRIPE_SIGNATURE_REQUIRED',
    })
  }

  let event: Stripe.Event

  try {
    const rawBody = await req.text()

    event = getStripe().webhooks.constructEvent(
      rawBody,
      stripeSignature,
      getStripeWebhookSecret(),
    )
  } catch (error: unknown) {
    console.error(
      'POST /api/webhooks/stripe signature verification failed',
      {
        error: safeError(error),
      },
    )

    return jsonFail(400, 'Invalid Stripe webhook signature.', {
      code: 'STRIPE_SIGNATURE_INVALID',
    })
  }

  try {
    const createdEvent = await prisma.stripeWebhookEvent
      .create({
        data: {
          stripeEventId: event.id,
          eventType: event.type,
          livemode: Boolean(event.livemode),
          payload: toInputJsonValue(event),
        },
        select: {
          id: true,
          processedAt: true,
        },
      })
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          return prisma.stripeWebhookEvent.findUnique({
            where: { stripeEventId: event.id },
            select: {
              id: true,
              processedAt: true,
            },
          })
        }

        throw error
      })

    if (createdEvent?.processedAt) {
      return jsonOk(
        {
          ok: true,
          duplicate: true,
          stripeEventId: event.id,
          eventType: event.type,
        },
        200,
      )
    }

const result = await prisma.$transaction(
  async (tx) => {
    const handledResult = await handleStripeEvent(tx, event)

    await tx.stripeWebhookEvent.update({
      where: { stripeEventId: event.id },
      data: {
        processedAt: new Date(),
        failedAt: null,
        lastError: null,
      },
    })

    return handledResult
  },
  { timeout: 30_000, maxWait: 10_000 },
)

    // Payment landed on an already-CANCELLED booking: settle it by the cancel's
    // own refund policy, post-commit (Stripe I/O). Best-effort — never throws,
    // so it cannot flip a processed event back to failed.
    if (result.lateCaptureRefund) {
      await applyLateCaptureCancelRefund(result.lateCaptureRefund)
    }

    return jsonOk(
      {
        ok: true,
        stripeEventId: event.id,
        eventType: event.type,
        handled: result.handled,
        message: result.message,
      },
      200,
    )
  } catch (error: unknown) {
    console.error('POST /api/webhooks/stripe processing error', {
      error: safeError(error),
    })

    await markEventFailed({
      stripeEventId: event.id,
      error,
    }).catch((markError: unknown) => {
      console.error('POST /api/webhooks/stripe failed to mark event failed', {
        stripeEventId: event.id,
        error: safeError(markError),
      })
    })

    return jsonFail(500, 'Failed to process Stripe webhook.', {
      code: 'STRIPE_WEBHOOK_PROCESSING_FAILED',
    })
  }
}
