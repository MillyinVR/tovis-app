// app/client/(gated)/bookings/page.tsx
//
// The client's standalone Appointments list (W2 — restored to match iOS
// AppointmentsView). The gated layout mounts LiveRefresh + RefreshOnFocus, so
// this force-dynamic page re-renders on a realtime signal / focus without any
// polling of its own.
import { redirect } from 'next/navigation'
import { Role } from '@prisma/client'

import { getCurrentUser } from '@/lib/currentUser'
import { loadClientBookingBuckets } from '@/lib/booking/clientBookingBuckets'
import { loadClientAftercareInbox } from '@/lib/aftercare/loadClientAftercareInbox'

import AppointmentsList, { AFTERCARE_STRIP_SIZE } from './AppointmentsList'

export const dynamic = 'force-dynamic'

export default async function ClientBookingsPage() {
  const user = await getCurrentUser().catch(() => null)
  const clientId = user?.clientProfile?.id

  if (!user || user.role !== Role.CLIENT || !clientId) {
    redirect('/login?from=/client/bookings')
  }

  // Aftercare rides along with the buckets. Its own inbox page (/client/aftercare)
  // has no nav entry, so without this strip a client's summaries were reachable
  // only per-booking via ?step=aftercare. The strip caps at AFTERCARE_STRIP_SIZE
  // and always hands off to that inbox, so there is nothing to learn from a
  // lookahead row — fetch exactly what gets rendered.
  const [{ buckets }, aftercare] = await Promise.all([
    loadClientBookingBuckets(clientId),
    loadClientAftercareInbox(clientId, { limit: AFTERCARE_STRIP_SIZE }),
  ])

  return <AppointmentsList buckets={buckets} aftercare={aftercare} />
}
