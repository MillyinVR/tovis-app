// app/_components/ProSessionFooter/ProSessionFooter.tsx 
'use client'

import { usePathname } from 'next/navigation'
import { useMemo } from 'react'
import { CalendarDays, Camera, MessageCircle, Sparkles, User } from 'lucide-react'
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

function formatBookingPickerLine(args: {
  serviceName?: string
  clientName?: string
  scheduledFor?: string | null
}) {
  const service = args.serviceName?.trim() || 'Service'
  const client = args.clientName?.trim() || 'Client'

  let when = ''
  if (args.scheduledFor) {
    const date = new Date(args.scheduledFor)
    if (!Number.isNaN(date.getTime())) {
      when = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    }
  }

  return when ? `${service} • ${client} • ${when}` : `${service} • ${client}`
}

export default function ProSessionFooter({ messagesBadge }: { messagesBadge?: string | null }) {
  const pathname = usePathname()
  const path = pathname ?? ''

  const {
    mode,
    booking,
    eligibleBookings,
    center,
    error,
    centerDisabled,
    displayLabel,
    handleCenterClick,
    loading,
    actionLoading,
    pickerOpen,
    setPickerOpen,
    startSelectedBooking,
  } = useProSession()

  const isActive = mode === 'ACTIVE'
  const isUpcoming = mode === 'UPCOMING'
  const isUpcomingPicker = mode === 'UPCOMING_PICKER'
  const showCameraIcon = center.action === 'CAPTURE_BEFORE' || center.action === 'CAPTURE_AFTER'

  const title = useMemo(() => {
    if (booking) {
      const service = booking.serviceName?.trim() || 'Service'
      const client = booking.clientName?.trim()
      return client ? `${service} • ${client}` : service
    }

    if (isUpcomingPicker && eligibleBookings.length > 1) {
      return `${eligibleBookings.length} eligible bookings — choose one to start`
    }

    if ((isUpcoming || isActive) && (loading || center.action !== 'NONE')) return 'Loading session…'
    return 'No upcoming session'
  }, [booking, eligibleBookings.length, isUpcoming, isUpcomingPicker, isActive, loading, center.action])

  const rawLabel = (displayLabel || center.label || 'Start').trim()
  const label = clampCenterLabel(rawLabel)

  const badge = useUnreadBadge({ initialBadge: messagesBadge ?? null })

  const centerRingClass = isActive
    ? 'ring-2 ring-toneDanger/60'
    : isUpcoming || isUpcomingPicker
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

      {pickerOpen && isUpcomingPicker && eligibleBookings.length > 1 ? (
        <div className="mx-auto mb-2 w-[min(520px,92vw)] rounded-[22px] border border-white/10 bg-bgSecondary p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[13px] font-extrabold text-textPrimary">Choose booking to start</div>
            <button
              type="button"
              onClick={() => setPickerOpen(false)}
              className="rounded-full px-2 py-1 text-[12px] font-bold text-textSecondary hover:bg-white/5"
              aria-label="Close booking picker"
            >
              ✕
            </button>
          </div>

          <div className="space-y-2">
            {eligibleBookings.map((item) => {
              const busy = actionLoading === 'start'
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void startSelectedBooking(item.id)}
                  disabled={busy}
                  className={[
                    'w-full rounded-[16px] border border-white/10 px-3 py-3 text-left',
                    'bg-white/5 hover:bg-white/8',
                    busy ? 'cursor-wait opacity-70' : '',
                  ].join(' ')}
                  title={formatBookingPickerLine(item)}
                >
                  <div className="text-[13px] font-extrabold text-textPrimary">
                    {item.serviceName?.trim() || 'Service'}
                  </div>
                  <div className="mt-1 text-[12px] text-textSecondary">
                    {formatBookingPickerLine(item)}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      <div className="tovis-glass border-t border-textPrimary/10">
        <div className="mx-auto flex h-18 w-full max-w-140 items-center justify-between px-4">
          <NavItem label="Looks" href={ROUTES.looks} icon={<Sparkles size={20} />} active={isActivePath(path, ROUTES.looks)} />
          <NavItem label="Calendar" href={ROUTES.calendar} icon={<CalendarDays size={20} />} active={isActivePath(path, ROUTES.calendar)} />

          <div className="relative -mt-8 flex w-22 justify-center">
            <button
              type="button"
              onClick={() => void handleCenterClick()}
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
              <span className={['leading-none flex items-center justify-center', activePulseClass].join(' ')}>
                {showCameraIcon ? <Camera size={22} /> : label}
              </span>
            </button>
          </div>

          <NavItem
            label="Messages"
            href={ROUTES.messages}
            icon={<MessageCircle size={20} />}
            active={isActivePath(path, ROUTES.messages)}
            rightSlot={badge ? <BadgeDot label={badge} /> : null}
          />

          <NavItem label="Profile" href={ROUTES.profile} icon={<User size={20} />} active={isActivePath(path, ROUTES.profile)} />
        </div>
      </div>
    </div>
  )
}