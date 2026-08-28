// lib/waitlist/offerDestination.ts
//
// WHERE a mobile waitlist offer travels — answered once, server-side, for
// everything that needs to know.
//
// The pro does not choose this address and never receives it. They are offering
// a time to a client whose chart is closed to them (joining a waitlist creates a
// message thread and nothing else, which `getProClientVisibility` treats as
// CONTACT_ONLY), so "which of this client's addresses" is not a question the pro
// is entitled to answer. It is answered here instead, from the client's own
// saved list, in the client's own order of preference.
//
// 🔴 Two callers, and they MUST agree:
//
//   • `createWaitlistOffer` stores the resolved address on the offer and
//     measures the trip from it.
//   • `GET /api/v1/availability/day?waitlistEntryId=…` resolves the same address
//     so the pro's slot picker computes MOBILE placement against the real
//     destination — without that id ever reaching the pro's device.
//
// If those two picked differently, the picker would show slots for one address
// and the offer would promise a trip to another. Hence one resolver, not two
// `findFirst`s that happen to be spelled the same today.

import { ClientAddressKind, Prisma } from '@prisma/client'

import { CLIENT_ADDRESS_PREFERENCE_ORDER } from '@/lib/clientAddresses/addressInput'
import { prisma } from '@/lib/prisma'

type DbClient = Prisma.TransactionClient | typeof prisma

/**
 * The only columns of the destination anything on the offer path may read.
 *
 * 🔴 `formattedAddress` / `addressLine1` are deliberately absent. The radius
 * gate needs coordinates and the pro-facing summary needs a coarse area; nothing
 * on this path needs the street line, and a column that is never loaded cannot
 * be stored, logged, or serialized by mistake. `city` / `state` /
 * `postalCodePrefix` are the coarsened surrogates the address-privacy scheme
 * already maintains (lib/security/addressEncryption.ts).
 *
 * The exact coordinates ARE read, and are the one plaintext PII field here —
 * hence the inline `pii-plaintext-read-ok` markers below. They exist for a single
 * purpose and never leave the write boundary: `assertMobileBookingWithinRadius`
 * measures the trip from them and refuses an out-of-range client. What is stored
 * on the offer, and what the pro is ever shown, is the resulting distance and the
 * coarse area — no coordinate at any precision is persisted or serialized from
 * this row.
 *
 * ⚠️ Keep the marked lines adjacent to `id`. `check:pii-plaintext-reads` matches
 * `^\s*lat\s*:\s*true$` with `\s` spanning NEWLINES, so a comment line directly
 * above `lat:` makes the match start on the COMMENT — which carries no marker,
 * and the guard fails naming a line that reads like prose. Explanations go here.
 */
export const WAITLIST_OFFER_DESTINATION_SELECT = {
  id: true,
  lat: true, // pii-plaintext-read-ok: radius check only; never stored or returned
  lng: true, // pii-plaintext-read-ok: radius check only; never stored or returned
  city: true,
  state: true,
  postalCodePrefix: true,
} satisfies Prisma.ClientAddressSelect

export type WaitlistOfferDestination = Prisma.ClientAddressGetPayload<{
  select: typeof WAITLIST_OFFER_DESTINATION_SELECT
}>

/**
 * The client's current service address — their chosen default, else the most
 * recently touched — or null when they have saved none.
 *
 * null is a real, expected answer: a client can join a waitlist without ever
 * having saved an address. `createWaitlistOffer` turns it into a refusal aimed
 * at the pro, who can offer an in-salon time instead.
 */
export async function loadWaitlistOfferDestination(args: {
  clientId: string
  client?: DbClient
}): Promise<WaitlistOfferDestination | null> {
  const db = args.client ?? prisma

  return db.clientAddress.findFirst({
    where: {
      clientId: args.clientId,
      kind: ClientAddressKind.SERVICE_ADDRESS,
    },
    orderBy: CLIENT_ADDRESS_PREFERENCE_ORDER,
    select: WAITLIST_OFFER_DESTINATION_SELECT,
  })
}

/**
 * The destination for a waitlist entry the CALLING PRO owns, as an id only.
 *
 * For the availability picker, which needs MOBILE placement resolved against the
 * real address but must not be handed one. Returns null when the entry is not
 * this pro's, does not exist, or the client has saved no address — all
 * indistinguishable to the caller on purpose, so the parameter cannot be used to
 * probe whether a given entry id belongs to someone else.
 */
export async function resolveWaitlistOfferDestinationIdForPro(args: {
  professionalId: string
  waitlistEntryId: string
  client?: DbClient
}): Promise<string | null> {
  const db = args.client ?? prisma

  const entry = await db.waitlistEntry.findFirst({
    where: {
      id: args.waitlistEntryId,
      professionalId: args.professionalId,
    },
    select: { clientId: true },
  })
  if (!entry) return null

  const destination = await loadWaitlistOfferDestination({
    clientId: entry.clientId,
    client: db,
  })

  return destination?.id ?? null
}
