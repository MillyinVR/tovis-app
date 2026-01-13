// app/pro/_components/ProSessionFooter/ProSessionFooter.tsx
'use client'

import { usePathname } from 'next/navigation'
import { useProSession } from './useProSession'
import NavItem from './NavItem'

const ROUTES = {
  home: '/pro/dashboard',
  calendar: '/pro/calendar',
  messages: '/pro/messages',
  profile: '/pro/profile/public-profile',
} as const

function isActivePath(pathname: string, href: string) {
  if (href === '/pro') return pathname === '/pro'
  return pathname === href || pathname.startsWith(href + '/')
}

function shouldHideOnPath(pathname: string) {
  // Hide on auth routes so login/signup pages are clean.
  if (pathname.startsWith('/login') || pathname.startsWith('/signup')) return true
  return false
}

export default function ProSessionFooter() {
  const pathname = usePathname()
  if (!pathname) return null
  if (shouldHideOnPath(pathname)) return null

  const { mode, booking, error, centerDisabled, displayLabel, handleCenterClick } = useProSession()

  const label = (displayLabel || 'Start').trim()
  const showCameraIcon = label.toLowerCase() === 'camera'
  const isSessionActive = mode === 'ACTIVE'

  return (
    <div
      data-testid="pro-session-footer"
      className="fixed inset-x-0 bottom-0 z-200"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {error ? (
        <div className="mx-auto mb-2 w-[min(520px,92vw)] rounded-[18px] bg-toneDanger px-3 py-2 text-[12px] font-extrabold text-white">
          {error}
        </div>
      ) : null}

      <div className="tovis-glass border-t border-white/10">
        <div className="mx-auto flex h-18 w-full max-w-140 items-center justify-between px-4">
          <NavItem label="Home" href={ROUTES.home} icon="🏠" active={isActivePath(pathname, ROUTES.home)} />

          <NavItem
            label="Calendar"
            href={ROUTES.calendar}
            icon="📅"
            active={isActivePath(pathname, ROUTES.calendar)}
          />

          {/* center action */}
          <div className="relative -mt-8 flex w-22 justify-center">
            <button
              type="button"
              onClick={handleCenterClick}
              disabled={centerDisabled}
              title={
                booking
                  ? `${booking.serviceName ?? 'Service'}${booking.clientName ? ` • ${booking.clientName}` : ''}`
                  : 'No upcoming session'
              }
              className={[
                'tovis-glass',
                'grid h-16 w-16 place-items-center rounded-full border border-white/15',
                'text-[11px] font-black text-textPrimary',
                centerDisabled ? 'cursor-not-allowed opacity-50' : 'hover:border-white/25 active:scale-[0.98]',
                isSessionActive ? 'ring-2 ring-toneDanger/60' : 'ring-2 ring-white/10',
              ].join(' ')}
            >
              <span className="leading-none">{showCameraIcon ? '📷' : label}</span>
            </button>
          </div>

          <NavItem
            label="Messages"
            href={ROUTES.messages}
            icon="💬"
            active={isActivePath(pathname, ROUTES.messages)}
          />

          <NavItem label="Profile" href={ROUTES.profile} icon="👤" active={isActivePath(pathname, ROUTES.profile)} />
        </div>
      </div>
    </div>
  )
}
