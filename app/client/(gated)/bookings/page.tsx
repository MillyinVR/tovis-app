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
  // only per-booking via ?step=aftercare. Fetch one past the strip size purely to
  // learn whether there IS more — the extra row is dropped, never rendered, so
  // the "See all" door appears only when it leads somewhere new.
  const [{ buckets }, aftercare] = await Promise.all([
    loadClientBookingBuckets(clientId),
    loadClientAftercareInbox(clientId, { limit: AFTERCARE_STRIP_SIZE + 1 }),
  ])

  return (
    <AppointmentsList
      buckets={buckets}
      aftercare={aftercare.slice(0, AFTERCARE_STRIP_SIZE)}
      hasMoreAftercare={aftercare.length > AFTERCARE_STRIP_SIZE}
    />
  )
}
