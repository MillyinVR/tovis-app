'use client'

import { usePathname } from 'next/navigation'
import { useMemo } from 'react'
import { useProSession } from './useProSession'
import NavItem from '../navigation/FooterNavItem'
import BadgeDot from '../ClientSessionFooter/BadgeDot'
import { useUnreadBadge } from '@/app/_components/_hooks/useUnreadBadge'

const ROUTES = {
  calendar: '/pro/calendar',
  looks: '/looks',
  messages: '/messages',
  profile: '/pro/profile/public-profile',
  dashboard: '/pro/dashboard',
} as const

function isActivePath(pathname: string, href: string) {
  const base = href.split('?')[0]
  return pathname === base || pathname.startsWith(base + '/')
}

function clampCenterLabel(raw: string) {
  const s = (raw || '').trim()
  if (!s) return 'Start'
  if (s.length <= 8) return s
  return s.slice(0, 8) + '…'
}

export default function ProSessionFooter({ messagesBadge }: { messagesBadge?: string | null }) {
  const pathname = usePathname()
  const path = pathname ?? ''

  const { mode, booking, center, error, centerDisabled, displayLabel, handleCenterClick, loading } = useProSession()

  const isActive = mode === 'ACTIVE'
  const isUpcoming = mode === 'UPCOMING'
  const showCameraIcon = center.action === 'CAPTURE_BEFORE' || center.action === 'CAPTURE_AFTER'

  const title = useMemo(() => {
    if (booking) {
      const service = booking.serviceName?.trim() || 'Service'
      const client = booking.clientName?.trim()
      return client ? `${service} • ${client}` : service
    }
    if ((isUpcoming || isActive) && (loading || center.action !== 'NONE')) return 'Loading session…'
    return 'No upcoming session'
  }, [booking, isUpcoming, isActive, loading, center.action])

  const rawLabel = (displayLabel || center.label || 'Start').trim()
  const label = clampCenterLabel(rawLabel)

  const badge = useUnreadBadge({ initialBadge: messagesBadge ?? null })

  const centerRingClass = isActive
    ? 'ring-2 ring-toneDanger/60'
    : isUpcoming
      ? 'ring-2 ring-accentPrimary/30'
      : 'ring-2 ring-white/10'

  const centerHoverClass = centerDisabled ? 'cursor-not-allowed opacity-50' : 'hover:border-white/25 active:scale-[0.98]'
  const centerBgClass = 'bg-bgSecondary'
  const activePulseClass = !centerDisabled && isActive ? 'animate-pulse' : ''

  return (
    <div className="w-full pt-8" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {error ? (
        <div className="mx-auto mb-2 w-[min(520px,92vw)] rounded-[18px] bg-toneDanger px-3 py-2 text-[12px] font-extrabold text-white">
          {error}
        </div>
      ) : null}

      <div className="tovis-glass border-t border-white/10">
        <div className="mx-auto flex h-18 w-full max-w-140 items-center justify-between px-4">
          <NavItem label="Looks" href={ROUTES.looks} icon="✨" active={isActivePath(path, ROUTES.looks)} />
          <NavItem label="Calendar" href={ROUTES.calendar} icon="📅" active={isActivePath(path, ROUTES.calendar)} />

          <div className="relative -mt-8 flex w-22 justify-center">
            <button
              type="button"
              onClick={handleCenterClick}
              disabled={centerDisabled}
              aria-disabled={centerDisabled}
              aria-label={showCameraIcon ? 'Open camera' : rawLabel || 'Start'}
              title={title}
              className={[
                'tovis-glass',
                'grid h-16 w-16 place-items-center rounded-full border border-white/15',
                centerBgClass,
                'text-[11px] font-black text-textPrimary',
                centerHoverClass,
                centerRingClass,
              ].join(' ')}
            >
              <span className={['leading-none', showCameraIcon ? 'text-lg' : '', activePulseClass].join(' ')}>
                {showCameraIcon ? '📷' : label}
              </span>
            </button>
          </div>

          <NavItem
            label="Messages"
            href={ROUTES.messages}
            icon="💬"
            active={isActivePath(path, ROUTES.messages)}
            rightSlot={badge ? <BadgeDot label={badge} /> : null}
          />

          <NavItem label="Profile" href={ROUTES.profile} icon="👤" active={isActivePath(path, ROUTES.profile)} />
        </div>
      </div>
    </div>
  )
}