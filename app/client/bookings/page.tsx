// app/client/bookings/page.tsx
// The bookings list page was retired in favor of the client home at /client,
// which renders live booking data. This redirect preserves old links/bookmarks.
import { redirect } from 'next/navigation'

export default function ClientBookingsPage() {
  redirect('/client')
}
