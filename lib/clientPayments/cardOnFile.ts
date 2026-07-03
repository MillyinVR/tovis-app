// lib/clientPayments/cardOnFile.ts
//
// Single source of truth for client card-on-file (Phase 2 revenue protection).
// Clients get a Stripe Billing customer + saved PaymentMethods via a SetupIntent
// flow, so a no-show fee can (in a later slice) be charged off-session. This
// module owns customer creation, SetupIntent creation, persisting a confirmed
// card, listing, and removal. NOTHING here charges a card — that is slice 2.2.
//
// The customer id is stored on ClientProfile.stripeCustomerId (distinct from
// ProfessionalSubscription's, which is pro membership billing). Stripe stays the
// source of truth for the card itself; ClientPaymentMethod caches display
// metadata so the app can list cards without a Stripe round-trip.
//
// Gating: callers must check noShowProtectionEnabled() before exposing any of
// this to clients — the module itself is flag-agnostic so tests can exercise it.

import type Stripe from 'stripe'

import { prisma } from '@/lib/prisma'
import { getStripe } from '@/lib/stripe/server'
import type { ClientPaymentMethodDTO } from '@/lib/dto/clientPaymentMethods'

type ClientPaymentMethodRow = {
  id: string
  brand: string | null
  last4: string | null
  expMonth: number | null
  expYear: number | null
  isDefault: boolean
  createdAt: Date
}

export function toClientPaymentMethodDTO(
  row: ClientPaymentMethodRow,
): ClientPaymentMethodDTO {
  return {
    id: row.id,
    brand: row.brand,
    last4: row.last4,
    expMonth: row.expMonth,
    expYear: row.expYear,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
  }
}

/**
 * Return the client's Stripe Billing customer id, creating the customer on first
 * use. The ClientProfile row is the source of truth: a created customer is
 * persisted immediately so repeat calls reuse it.
 */
export async function ensureClientStripeCustomer(args: {
  clientId: string
  email?: string | null
}): Promise<string> {
  const existing = await prisma.clientProfile.findUnique({
    where: { id: args.clientId },
    select: { id: true, stripeCustomerId: true },
  })

  if (!existing) {
    throw new Error(`ClientProfile ${args.clientId} not found`)
  }

  // stripeCustomerId is an opaque Stripe billing id, not decryptable PII (same
  // access as lib/membership/subscription.ts); reads are marked ok inline below.
  if (existing.stripeCustomerId) return existing.stripeCustomerId // pii-plaintext-read-ok: opaque Stripe billing id

  const stripe = getStripe()
  const customer = await stripe.customers.create({
    email: args.email?.trim() || undefined,
    metadata: { clientId: args.clientId, kind: 'TOVIS_CLIENT' },
  })

  await prisma.clientProfile.update({
    where: { id: args.clientId },
    data: { stripeCustomerId: customer.id },
  })

  return customer.id
}

/**
 * Start a SetupIntent so the client can save a card with Stripe.js. The card is
 * saved for off-session reuse (no-show fees). Returns the client secret the front
 * end confirms against, plus the SetupIntent id to echo back on confirm.
 */
export async function createClientSetupIntent(args: {
  clientId: string
  email?: string | null
}): Promise<{ clientSecret: string; setupIntentId: string; customerId: string }> {
  const customerId = await ensureClientStripeCustomer({
    clientId: args.clientId,
    email: args.email,
  })

  const stripe = getStripe()
  const setupIntent = await stripe.setupIntents.create({
    customer: customerId,
    usage: 'off_session',
    payment_method_types: ['card'],
    metadata: { clientId: args.clientId },
  })

  if (!setupIntent.client_secret) {
    throw new Error('Stripe did not return a SetupIntent client secret')
  }

  return {
    clientSecret: setupIntent.client_secret,
    setupIntentId: setupIntent.id,
    customerId,
  }
}

function stripeIdOf(
  value: string | { id?: string | null } | null | undefined,
): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  return typeof value.id === 'string' ? value.id : null
}

function cardDetailsOf(paymentMethod: Stripe.PaymentMethod): {
  brand: string | null
  last4: string | null
  expMonth: number | null
  expYear: number | null
} {
  const card = paymentMethod.card
  return {
    brand: card?.brand ?? null,
    last4: card?.last4 ?? null,
    expMonth: card?.exp_month ?? null,
    expYear: card?.exp_year ?? null,
  }
}

/**
 * Persist the card the client just confirmed via a SetupIntent. Server-verified:
 * the SetupIntent must belong to this client's customer and have succeeded. The
 * new card becomes the client's default (both in Stripe invoice settings and the
 * local `isDefault` flag), superseding any previous default.
 *
 * Idempotent on the Stripe PaymentMethod id — re-confirming the same SetupIntent
 * updates the existing row rather than duplicating it.
 */
export async function persistConfirmedClientCard(args: {
  clientId: string
  setupIntentId: string
}): Promise<ClientPaymentMethodDTO> {
  const client = await prisma.clientProfile.findUnique({
    where: { id: args.clientId },
    select: { id: true, stripeCustomerId: true },
  })

  if (!client?.stripeCustomerId) { // pii-plaintext-read-ok: opaque Stripe billing id
    throw new Error('Client has no Stripe customer; start a SetupIntent first')
  }

  const stripe = getStripe()
  const setupIntent = await stripe.setupIntents.retrieve(args.setupIntentId)

  if (stripeIdOf(setupIntent.customer) !== client.stripeCustomerId) { // pii-plaintext-read-ok: opaque Stripe billing id
    throw new Error('SetupIntent does not belong to this client')
  }
  if (setupIntent.status !== 'succeeded') {
    throw new Error(`SetupIntent is not confirmed (status: ${setupIntent.status})`)
  }

  const paymentMethodId = stripeIdOf(setupIntent.payment_method)
  if (!paymentMethodId) {
    throw new Error('SetupIntent has no payment method')
  }

  const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId)
  const card = cardDetailsOf(paymentMethod)

  // Make the new card the default for future off-session charges.
  await stripe.customers.update(client.stripeCustomerId, { // pii-plaintext-read-ok: opaque Stripe billing id
    invoice_settings: { default_payment_method: paymentMethodId },
  })

  const row = await prisma.$transaction(async (tx) => {
    await tx.clientPaymentMethod.updateMany({
      where: { clientId: args.clientId, isDefault: true },
      data: { isDefault: false },
    })

    return tx.clientPaymentMethod.upsert({
      where: { stripePaymentMethodId: paymentMethodId },
      create: {
        clientId: args.clientId,
        stripePaymentMethodId: paymentMethodId,
        brand: card.brand,
        last4: card.last4,
        expMonth: card.expMonth,
        expYear: card.expYear,
        isDefault: true,
      },
      update: {
        brand: card.brand,
        last4: card.last4,
        expMonth: card.expMonth,
        expYear: card.expYear,
        isDefault: true,
      },
      select: {
        id: true,
        brand: true,
        last4: true,
        expMonth: true,
        expYear: true,
        isDefault: true,
        createdAt: true,
      },
    })
  })

  return toClientPaymentMethodDTO(row)
}

/** List a client's saved cards, default first, then newest. */
export async function listClientPaymentMethods(
  clientId: string,
): Promise<ClientPaymentMethodDTO[]> {
  const rows = await prisma.clientPaymentMethod.findMany({
    where: { clientId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      brand: true,
      last4: true,
      expMonth: true,
      expYear: true,
      isDefault: true,
      createdAt: true,
    },
  })

  return rows.map(toClientPaymentMethodDTO)
}

/**
 * Remove a saved card. Ownership-scoped (clientId), detaches from Stripe, and if
 * the removed card was the default, promotes the next-newest card to default so a
 * client is never left with cards but no default. Returns null if no such card.
 */
export async function removeClientPaymentMethod(args: {
  clientId: string
  paymentMethodId: string
}): Promise<{ removedId: string } | null> {
  const row = await prisma.clientPaymentMethod.findFirst({
    where: { id: args.paymentMethodId, clientId: args.clientId },
    select: { id: true, stripePaymentMethodId: true, isDefault: true },
  })

  if (!row) return null

  const stripe = getStripe()
  // Best-effort detach; a Stripe-side miss must not strand the local row.
  try {
    await stripe.paymentMethods.detach(row.stripePaymentMethodId)
  } catch {
    // Already detached / unknown to Stripe — proceed with local removal.
  }

  await prisma.$transaction(async (tx) => {
    await tx.clientPaymentMethod.delete({ where: { id: row.id } })

    if (row.isDefault) {
      const next = await tx.clientPaymentMethod.findFirst({
        where: { clientId: args.clientId },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      })
      if (next) {
        await tx.clientPaymentMethod.update({
          where: { id: next.id },
          data: { isDefault: true },
        })
      }
    }
  })

  return { removedId: row.id }
}
