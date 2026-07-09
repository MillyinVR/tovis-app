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

import AppointmentsList from './AppointmentsList'

export const dynamic = 'force-dynamic'

export default async function ClientBookingsPage() {
  const user = await getCurrentUser().catch(() => null)
  const clientId = user?.clientProfile?.id

  if (!user || user.role !== Role.CLIENT || !clientId) {
    redirect('/login?from=/client/bookings')
  }

  const { buckets } = await loadClientBookingBuckets(clientId)

  return <AppointmentsList buckets={buckets} />
}
