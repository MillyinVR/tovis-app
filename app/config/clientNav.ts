// app/config/clientNav.ts
import { Sparkles, Compass, House, Mail, User } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface ClientNavTab {
  id: string
  label: string
  href: string
  icon: LucideIcon
  center?: boolean
  hasBadge?: boolean
}

/**
 * Looks is the client's home base, so it takes the raised center mark
 * (rendered as the tovis feather — see ClientSessionFooter). The `icon`
 * on the center tab is unused for the feather but kept for completeness.
 *
 * ⚠️ There is deliberately NO `bookings` tab here — bookings live on Home
 * instead. That moves a load-bearing constraint rather than deleting it:
 * /client/bookings is the ONLY surface listing a client's PENDING bookings (the
 * home Upcoming card shows the next ACCEPTED one, Me → HISTORY filters to
 * ACCEPTED/IN_PROGRESS/COMPLETED), so the route to it must stay UNCONDITIONAL
 * wherever it lives. It now lives in UpcomingAppointmentCard, which links to the
 * list from BOTH its populated and its empty state — the empty state being the
 * one a pending-only client actually sees. Pinned by
 * UpcomingAppointmentCard.test.tsx; do not make that link conditional (an
 * earlier "N more upcoming →" link needed 2+ bookings, which stranded the
 * one-booking client entirely).
 */
export const CLIENT_TABS: ClientNavTab[] = [
  { id: 'home', label: 'Home', href: '/client', icon: House },
  { id: 'discover', label: 'Discover', href: '/search', icon: Compass },
  { id: 'looks', label: 'Looks', href: '/looks', icon: Sparkles, center: true },
  { id: 'inbox', label: 'Inbox', href: '/messages', icon: Mail, hasBadge: true },
  { id: 'me', label: 'Me', href: '/client/me', icon: User },
]

// CENTER_BUTTON removed — the center is now <TovisFeatherMark /> (ring + sphere
// coin + feather + orb). Its look is theme-driven via brand CSS variables.
