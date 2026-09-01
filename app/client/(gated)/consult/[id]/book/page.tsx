// app/client/(gated)/consult/[id]/book/page.tsx
//
// Book the Look, slice B4b — the client's booking door on a look-anchored
// consult (docs/product/BOOK-THE-LOOK-DIRECTION.md, decisions 3, 4 and 5).
//
// 🔴 THE SERVER COMPOSES; THE CLIENT RENDERS. Both modes are derived here,
// through the same `loadAuthorizedConsultBookingProposal` the API twin runs, so
// the page's price, duration, mode availability and its "what happens when you
// tap" sentence all come from one derivation. Nothing below is re-derived in
// React — a second reading of "does this book instantly?" is exactly how a
// preview ends up promising something the commit does not do.
//
// Both modes are asked, and NEITHER is preselected. The proposal endpoint
// refuses to default a mode for the same reason: SALON is not a safe guess, and
// handing a client a salon price for what she meant as a mobile appointment is
// the miss B4's mode reconciliation exists to prevent. So the page shows both
// answers — including both refusals — and she picks.

import { notFound, redirect } from 'next/navigation'

import { ServiceLocationType } from '@prisma/client'

import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import {
  ConsultProposalEntryError,
  loadAuthorizedConsultBookingProposal,
} from '@/lib/consult/proposalEntry'
import { getCurrentUser } from '@/lib/currentUser'
import { resolveTenantContextForLayout } from '@/lib/tenant/layoutContext'

import ClientConsultBooking from './ClientConsultBooking'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ id: string }> | { id: string }
}

export default async function ClientConsultBookingPage({ params }: PageProps) {
  const { id } = await Promise.resolve(params)
  const from = `/client/consult/${encodeURIComponent(id)}/book`
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
    redirect(`/login?from=${encodeURIComponent(from)}`)
  }

  const args = {
    consultSessionId: id,
    clientId: user.clientProfile.id,
    actorUserId: user.id,
    // Book the Look, B7 — this door quotes the LOOK, and nothing else. The
    // analysis's enhancements are offered on the review step, where she is one
    // tap from committing and the slot is already held for the widest case; an
    // empty selection here is what makes "Starting at" a starting price rather
    // than a number that then drops (decision 10, opt-in never pre-checked).
    enhancementSelection: [] as const,
  }

  let salon
  let mobile
  try {
    // Sequential, not parallel: each call takes `FOR UPDATE` on the SAME consult
    // row, so running them together would only make one wait on the other.
    salon = await loadAuthorizedConsultBookingProposal({
      ...args,
      locationType: ServiceLocationType.SALON,
    })
    mobile = await loadAuthorizedConsultBookingProposal({
      ...args,
      locationType: ServiceLocationType.MOBILE,
    })
  } catch (error: unknown) {
    // The same no-leak refusal the results page gives: not yours, not found,
    // and "the pilot is dark for that pro" are one answer.
    if (error instanceof ConsultProposalEntryError) notFound()
    throw error
  }

  const brand = getBrandForTenantContext(await resolveTenantContextForLayout())

  return (
    <ClientConsultBooking
      consultId={id}
      salon={salon}
      mobile={mobile}
      copy={brand.clientConsultBooking}
    />
  )
}
