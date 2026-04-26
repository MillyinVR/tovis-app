// app/_components/ProSessionFooter/ProSessionFooter.tsx
'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useMemo } from 'react'
import {
  CalendarDays,
  Camera,
  MessageCircle,
  Sparkles,
  User,
} from 'lucide-react'

import BadgeDot from '../ClientSessionFooter/BadgeDot'
import { useUnreadBadge } from '@/app/_components/_hooks/useUnreadBadge'
import { useProSession } from './useProSession'

const ROUTES = {
  calendar: '/pro/calendar',
  looks: '/looks',
  messages: '/messages',
  profile: '/pro/profile/public-profile',
}

type FooterLinkProps = {
  label: string
  href: string
  icon: ReactNode
  active: boolean
  rightSlot?: ReactNode
}

function isActivePath(pathname: string, href: string): boolean {
  const [base = href] = href.split('?')
  return pathname === base || pathname.startsWith(`${base}/`)
}

function clampCenterLabel(raw: string): string {
  const label = raw.trim()

  if (!label) return 'Start'
  if (label.length <= 8) return label

  return `${label.slice(0, 8)}…`
}

function formatBookingPickerLine(args: {
  serviceName?: string
  clientName?: string
  scheduledFor?: string | null
}): string {
  const service = args.serviceName?.trim() || 'Service'
  const client = args.clientName?.trim() || 'Client'

  if (!args.scheduledFor) {
    return `${service} • ${client}`
  }

  const date = new Date(args.scheduledFor)
  const time = Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      })

  return time ? `${service} • ${client} • ${time}` : `${service} • ${client}`
}

function FooterLink({
  label,
  href,
  icon,
  active,
  rightSlot,
}: FooterLinkProps) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className="brand-pro-footer-item brand-focus"
      data-active={active ? 'true' : undefined}
    >
      <span aria-hidden="true">{icon}</span>
      <span className="brand-pro-footer-item-label">{label}</span>

      {rightSlot ? (
        <span className="brand-pro-footer-badge">{rightSlot}</span>
      ) : null}
    </Link>
  )
}

export default function ProSessionFooter({
  messagesBadge,
}: {
  messagesBadge?: string | null
}) {
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

  const showCameraIcon =
    center.action === 'CAPTURE_BEFORE' || center.action === 'CAPTURE_AFTER'

  const centerIsLive =
    !centerDisabled && (isActive || isUpcoming || isUpcomingPicker)

  const title = useMemo(() => {
    if (booking) {
      const service = booking.serviceName?.trim() || 'Service'
      const client = booking.clientName?.trim()

      return client ? `${service} • ${client}` : service
    }

    if (isUpcomingPicker && eligibleBookings.length > 1) {
      return `${eligibleBookings.length} eligible bookings — choose one to start`
    }

    if ((isUpcoming || isActive) && (loading || center.action !== 'NONE')) {
      return 'Loading session…'
    }

    return 'No upcoming session'
  }, [
    booking,
    center.action,
    eligibleBookings.length,
    isActive,
    isUpcoming,
    isUpcomingPicker,
    loading,
  ])

  const rawLabel = (displayLabel || center.label || 'Start').trim()
  const label = clampCenterLabel(rawLabel)
  const badge = useUnreadBadge({ initialBadge: messagesBadge ?? null })

  return (
    <div className="brand-pro-footer">
      {error ? (
        <div className="brand-pro-footer-error">{error}</div>
      ) : null}

      {pickerOpen && isUpcomingPicker && eligibleBookings.length > 1 ? (
        <div className="brand-pro-footer-picker">
          <div className="brand-pro-footer-picker-head">
            <div className="brand-pro-footer-picker-title">
              Choose booking to start
            </div>

            <button
              type="button"
              onClick={() => setPickerOpen(false)}
              className="brand-pro-footer-picker-close brand-focus"
              aria-label="Close booking picker"
            >
              ✕
            </button>
          </div>

          <div className="brand-pro-footer-picker-list">
            {eligibleBookings.map((item) => {
              const busy = actionLoading === 'start'
              const line = formatBookingPickerLine(item)

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void startSelectedBooking(item.id)}
                  disabled={busy}
                  className="brand-pro-footer-picker-item brand-focus"
                  title={line}
                >
                  <div className="brand-pro-footer-picker-item-title">
                    {item.serviceName?.trim() || 'Service'}
                  </div>

                  <div className="brand-pro-footer-picker-item-sub">
                    {line}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      <div className="brand-pro-footer-shell">
        <div className="brand-pro-footer-row">
          <FooterLink
            label="Looks"
            href={ROUTES.looks}
            icon={<Sparkles size={20} />}
            active={isActivePath(path, ROUTES.looks)}
          />

          <FooterLink
            label="Calendar"
            href={ROUTES.calendar}
            icon={<CalendarDays size={20} />}
            active={isActivePath(path, ROUTES.calendar)}
          />

          <div className="brand-pro-footer-center-wrap">
            {centerIsLive ? (
              <span className="brand-pro-footer-pulse" aria-hidden="true" />
            ) : null}

            <button
              type="button"
              onClick={() => void handleCenterClick()}
              disabled={centerDisabled}
              aria-disabled={centerDisabled}
              aria-label={showCameraIcon ? 'Open camera' : rawLabel || 'Start'}
              title={title}
              className="brand-pro-footer-center brand-focus"
              data-active={centerIsLive ? 'true' : undefined}
            >
              {showCameraIcon ? (
                <span className="brand-pro-footer-center-icon">
                  <Camera size={22} />
                </span>
              ) : (
                <span className="brand-pro-footer-center-label">{label}</span>
              )}
            </button>
          </div>

          <FooterLink
            label="Messages"
            href={ROUTES.messages}
            icon={<MessageCircle size={20} />}
            active={isActivePath(path, ROUTES.messages)}
            rightSlot={badge ? <BadgeDot label={badge} /> : null}
          />

          <FooterLink
            label="Profile"
            href={ROUTES.profile}
            icon={<User size={20} />}
            active={isActivePath(path, ROUTES.profile)}
          />
        </div>
      </div>
    </div>
  )
}