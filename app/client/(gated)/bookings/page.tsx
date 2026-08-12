// app/client/(gated)/bookings/page.tsx
//
// The client's standalone bookings list (W2 — restored to match iOS
// AppointmentsView, whose navigationTitle is likewise "Bookings"). The gated
// layout mounts LiveRefresh + RefreshOnFocus, so this force-dynamic page
// re-renders on a realtime signal / focus without any polling of its own.
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

  // Aftercare rides along with the buckets. Its own inbox page
  // (/client/aftercare) is linked from Home since #875, so this strip is a
  // convenience rather than the only route in — but it stays, because a client
  // who came here for a booking should see that visit's summary without a
  // second trip. The strip caps at AFTERCARE_STRIP_SIZE and always hands off to
  // that inbox, so there is nothing to learn from a lookahead row — fetch
  // exactly what gets rendered.
  const [{ buckets }, aftercare] = await Promise.all([
    loadClientBookingBuckets(clientId),
    loadClientAftercareInbox(clientId, { limit: AFTERCARE_STRIP_SIZE }),
  ])

  return <AppointmentsList buckets={buckets} aftercare={aftercare} />
}
