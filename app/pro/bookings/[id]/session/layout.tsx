import Link from 'next/link'
import { loadBookingLookBriefLink } from '@/lib/consult/bookingLookBrief'
// app/pro/bookings/[id]/session/layout.tsx
//
// Mounts the session state poller once for every page in the Pro session
// segment (hub, before-photos, after-photos). The poller refreshes the
// server-rendered route when the booking's session state changes, so client
// actions (consultation approval, checkout, cancel) appear within seconds.
//
// The pages below own auth redirects and not-found handling; this layout
// only decides whether polling is worthwhile. It renders the poller solely
// for the booking's owning Pro on a non-terminal booking.

import type { ReactNode } from 'react'

import { getCurrentUser } from '@/lib/currentUser'
import { prisma } from '@/lib/prisma'
import {
  PRO_SESSION_STATE_SELECT,
  buildProSessionState,
  computeProSessionStateHash,
} from '@/lib/proSession/sessionState'

import SessionStatePoller from './SessionStatePoller'

export const dynamic = 'force-dynamic'

type LayoutProps = {
  children: ReactNode
  params: Promise<{ id: string }>
}

async function resolvePoller(bookingId: string): Promise<ReactNode> {
  const user = await getCurrentUser().catch(() => null)
  const professionalId =
    user?.role === 'PRO' ? user.professionalProfile?.id ?? null : null

  if (!professionalId) return null

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: PRO_SESSION_STATE_SELECT,
  })

  if (!booking || booking.professionalId !== professionalId) return null

  const state = buildProSessionState(booking)
  if (state.terminal) return null

  const brief = await loadBookingLookBriefLink(bookingId, professionalId)
  return <>
    <SessionStatePoller bookingId={bookingId} initialStateHash={computeProSessionStateHash(state)} />
    {brief && <Link className="mx-auto my-3 block max-w-4xl rounded-card border border-textPrimary/10 bg-bgSurface p-4 text-sm text-textPrimary"
      href={`/pro/consults/${encodeURIComponent(brief.consultId)}`}>
      Look brief · Version {brief.version} · {brief.confirmed ? 'Both confirmed' : 'Confirmation needed'} — review together
    </Link>}
  </>
}

export default async function ProBookingSessionLayout(props: LayoutProps) {
  const { id } = await props.params
  const bookingId = String(id || '').trim()

  const poller = bookingId ? await resolvePoller(bookingId) : null

  return (
    <>
      {poller}
      {props.children}
    </>
  )
}
