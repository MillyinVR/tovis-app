// app/config/clientNav.ts
import { Sparkles, CalendarDays, Compass, House, Mail, User } from 'lucide-react'
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
 * `bookings` is UNCONDITIONAL by design. /client/bookings is the only surface
 * that lists a client's PENDING bookings — the home Upcoming card shows just the
 * next ACCEPTED one, and Me → HISTORY filters to ACCEPTED/IN_PROGRESS/COMPLETED.
 * Before this tab, every route into that list was conditional: the home card's
 * link needed 2+ upcoming bookings, and the /client/notifications link only
 * rendered in that page's zero-notifications empty state. A client with one
 * booking — the common case — could not reach their own appointments at all.
 * An entry point to a client's own bookings must never depend on how many they
 * have. Covered by ClientSessionFooter.test.tsx.
 */
export const CLIENT_TABS: ClientNavTab[] = [
  { id: 'home', label: 'Home', href: '/client', icon: House },
  { id: 'discover', label: 'Discover', href: '/search', icon: Compass },
  { id: 'looks', label: 'Looks', href: '/looks', icon: Sparkles, center: true },
  {
    id: 'bookings',
    label: 'Bookings',
    href: '/client/bookings',
    icon: CalendarDays,
  },
  { id: 'inbox', label: 'Inbox', href: '/messages', icon: Mail, hasBadge: true },
  { id: 'me', label: 'Me', href: '/client/me', icon: User },
]

// CENTER_BUTTON removed — the center is now <TovisFeatherMark /> (ring + sphere
// coin + feather + orb). Its look is theme-driven via brand CSS variables.
