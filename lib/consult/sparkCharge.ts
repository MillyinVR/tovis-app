// lib/consult/sparkCharge.ts
//
// P7a-5 — "what is this tap about to charge?", asked BEFORE she taps.
//
// Until now the spark told a client nothing about money: the CTA said "Book the
// look", the availability drawer never mentions a deposit (grep it), and the
// first she heard of one was the deposit card on her booking detail page, after
// the appointment was made. A pro who takes a $25 deposit on colour was
// invisible until the money was already owed.
//
// 🔴 THE SAME FUNCTION AS THE CHARGE. This does not re-derive whether a deposit
// applies — it calls `resolveDiscoveryFinalize`, the finalize path's own trust
// boundary, with the arguments the CTA's href will actually produce, and reads
// the answer. One function, two call sites (Tori, 2026-09-07). A second
// implementation here would be a preview that is right by coincidence, and the
// coincidence would end the first time either scope rule changed.
//
// What that buys, concretely: a pro on the default NEW_DISCOVERY_ONLY scope
// takes no deposit from a client she has seen before — so a returning client's
// CTA correctly says nothing about a deposit, without this file knowing the
// first thing about relationship history.
//
// COST. It is roughly eight indexed reads, and it runs only when the CTA is
// actually on offer (see `previewConsultSparkCharge`'s early return in
// thread.ts). It deliberately does NOT run once she is booked, which is the
// only state in which the thread is polled — the 5s analysis poll refetches the
// thread, and by then the CTA is ALREADY_BOOKED and this is skipped.

import 'server-only'

import { BookingSource } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import {
  describeUpfrontChargeDisclosure,
  type UpfrontChargeDisclosure,
} from '@/lib/booking/categoryDeposit'
import { resolveDiscoveryFinalize } from '@/lib/booking/resolveDiscoveryFinalize'

/**
 * What the sticky CTA should disclose, or null when there is nothing to say.
 *
 * Null covers three different situations on purpose — no offering, nothing owed
 * up front, and a resolution that failed — because the client-visible outcome
 * is the same in all three and it is the honest one: the price line renders
 * alone and she meets any deposit on her booking, exactly as she does today.
 * A failure here must never take the consult thread down.
 */
export async function previewConsultSparkCharge(args: {
  clientId: string
  /** For NFC attribution, the same value `resolveDiscoveryFinalize` expects. */
  clientUserId: string | null
  professionalId: string
  /** The look's linked service — what the ordinary booking path would book. */
  serviceId: string | null
  /** The consult's anchor look, which the CTA's href carries. */
  lookPostId: string | null
}): Promise<UpfrontChargeDisclosure | null> {
  if (!args.serviceId || !args.lookPostId) return null

  try {
    // The offering is the pro's row for that catalog service — the same lookup
    // the booking path performs, scoped to this pro so a service she does not
    // offer resolves to nothing rather than to somebody else's price.
    const offering = await prisma.professionalServiceOffering.findFirst({
      where: { professionalId: args.professionalId, serviceId: args.serviceId },
      select: { id: true },
    })
    if (!offering) return null

    // The arguments the tap will produce. Two of them decide the answer and
    // one deliberately does not:
    //
    //   * `lookPostId` + `offeringId` DO. Provenance is resolved from the
    //     validated LookPost (`resolveDiscoveryProvenance` → LOOKS_FEED), and
    //     that is what the NEW_DISCOVERY_ONLY scope reads. The offering is what
    //     carries the per-service prepay rule and the category deposit.
    //
    //   * `source` does NOT. 🔴 Worth stating because the two clients disagree
    //     about it: the web CTA's href sends `source=DISCOVERY`
    //     (ClientConsultFlow's `bookTheLookHref`), the iOS book sheet sends the
    //     `BookingService` default of `REQUESTED`. `resolveDiscoveryProvenance`
    //     does not take `source` at all — inside `resolveDiscoveryFinalize` it
    //     feeds only the AFTERCARE short-circuit (neither client is aftercare)
    //     and the NR/RR relationship LABEL. So the preview is right for both
    //     clients, and the value chosen here cannot make it lie about money.
    //     Do not "fix" either client to match the other on the strength of this
    //     call — they are independently correct, and this comment is not a
    //     licence to change one.
    const directive = await resolveDiscoveryFinalize({
      clientId: args.clientId,
      clientUserId: args.clientUserId,
      professionalId: args.professionalId,
      offeringId: offering.id,
      lookPostId: args.lookPostId,
      mediaId: null,
      source: BookingSource.DISCOVERY,
      aftercare: false,
    })

    return describeUpfrontChargeDisclosure({
      requirement: directive.depositRequirement,
      settings: directive.depositSettings,
    })
  } catch (error) {
    // Telemetry, not a failure state. The thread is a read path and a client
    // whose consult will not open has lost more than a client who was not shown
    // a deposit line she will meet again at checkout.
    console.warn('consult spark charge preview failed', {
      professionalId: args.professionalId,
      serviceId: args.serviceId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
