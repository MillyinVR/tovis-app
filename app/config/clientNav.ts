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

export const CLIENT_TABS: ClientNavTab[] = [
  { id: 'looks',    label: 'Looks',    href: '/looks',           icon: Sparkles },
  { id: 'discover', label: 'Discover', href: '/search',          icon: Compass },
  { id: 'home',     label: 'Home',     href: '/client',          icon: House,    center: true },
  { id: 'inbox',    label: 'Inbox',    href: '/messages',        icon: Mail,     hasBadge: true },
  { id: 'me',       label: 'Me',       href: '/client/bookings', icon: User },
]

/** Center button: terra when active (home page), paper when elsewhere. */
export const CENTER_BUTTON = {
  bgActive:       '#E05A28',
  bgInactive:     '#F4EFE7',
  colorActive:    '#ffffff',
  colorInactive:  '#0A0907',
  shadowActive:   '0 10px 30px rgba(224,90,40,0.55)',
  shadowInactive: '0 10px 30px rgba(244,239,231,0.15)',
} as const
