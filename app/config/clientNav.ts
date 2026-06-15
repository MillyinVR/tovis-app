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
  { id: 'looks', label: 'Looks', href: '/looks', icon: Sparkles },
  { id: 'discover', label: 'Discover', href: '/search', icon: Compass },
  { id: 'home', label: 'Home', href: '/client', icon: House, center: true },
  { id: 'inbox', label: 'Inbox', href: '/messages', icon: Mail, hasBadge: true },
  { id: 'me', label: 'Me', href: '/client/me', icon: User },
]

/**
 * Center button: accent when active (home page), paper when elsewhere.
 * Colors resolve through the brand CSS variables set by BrandProvider, so a
 * white-label palette swap updates this button automatically.
 */
export const CENTER_BUTTON = {
  bgActive: 'rgb(var(--accent-primary))',
  bgInactive: 'rgb(var(--surface-glass))',
  colorActive: 'rgb(var(--on-accent))',
  colorInactive: 'rgb(var(--bg-primary))',
  shadowActive: '0 10px 30px rgb(var(--accent-primary) / 0.55)',
  shadowInactive: '0 10px 30px rgb(var(--surface-glass) / 0.15)',
} as const