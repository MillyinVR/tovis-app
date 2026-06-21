// app/_components/ProSessionFooter/ProSessionFooter.tsx
'use client'

import { usePathname } from 'next/navigation'
import { useMemo } from 'react'
import {
  CalendarDays,
  Camera,
  MessageCircle,
  Sparkles,
  User,
} from 'lucide-react'

import NavItem from '../navigation/FooterNavItem'
import { isActivePath } from '../navigation/activePath'
import BadgeDot from '../ClientSessionFooter/BadgeDot'
import { useUnreadBadge } from '@/app/_components/_hooks/useUnreadBadge'
import { useProSession } from './useProSession'

const ROUTES = {
  calendar: '/pro/calendar',
  looks: '/looks',
  messages: '/messages',
  profile: '/pro/profile/public-profile',
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

  if (!args.scheduledFor) return `${service} • ${client}`

  const date = new Date(args.scheduledFor)
  const time = Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

  return time ? `${service} • ${client} • ${time}` : `${service} • ${client}`
}

const monoLabel = {
  fontFamily: 'var(--font-mono)',
} as const

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

  // surface the eligible-booking count on the center when picking
  const pickerCount =
    isUpcomingPicker && eligibleBookings.length > 1 ? eligibleBookings.length : 0

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
    <div className="tovis-footer-root">
      <nav className="tovis-footer-bar" aria-label="Primary">
        {/* error toast above the bar */}
        {error ? (
          <div
            role="alert"
            style={{
              position: 'absolute',
              left: '50%',
              bottom: '100%',
              transform: 'translateX(-50%)',
              marginBottom: 12,
              maxWidth: 'min(92vw, 380px)',
              background: 'rgb(var(--bg-surface))',
              border: '1px solid rgb(var(--tone-danger))',
              borderRadius: 12,
              padding: '10px 14px',
              fontSize: 13,
              color: 'rgb(var(--text-primary))',
              boxShadow: '0 18px 40px rgba(0,0,0,0.35)',
            }}
          >
            {error}
          </div>
        ) : null}

        {/* booking picker sheet */}
        {pickerOpen && isUpcomingPicker && eligibleBookings.length > 1 ? (
          <div
            style={{
              position: 'absolute',
              left: '50%',
              bottom: '100%',
              transform: 'translateX(-50%)',
              marginBottom: 12,
              width: 'min(92vw, 380px)',
              background: 'rgb(var(--bg-surface))',
              border: '1px solid var(--line)',
              borderRadius: 16,
              padding: '14px 14px 12px',
              boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 12,
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 600,
                  fontSize: 15,
                  color: 'rgb(var(--text-primary))',
                }}
              >
                Choose booking to start
              </span>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                aria-label="Close booking picker"
                className="tovis-focus"
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  border: '1px solid var(--line)',
                  background: 'transparent',
                  color: 'rgb(var(--text-muted))',
                  fontSize: 13,
                  cursor: 'pointer',
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {eligibleBookings.map((item) => {
                const busy = actionLoading === 'start'
                const line = formatBookingPickerLine(item)
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => void startSelectedBooking(item.id)}
                    disabled={busy}
                    className="tovis-focus"
                    title={line}
                    style={{
                      textAlign: 'left',
                      border: '1px solid var(--line)',
                      borderRadius: 12,
                      padding: '12px 14px',
                      background: 'rgb(var(--bg-secondary))',
                      cursor: busy ? 'not-allowed' : 'pointer',
                      opacity: busy ? 0.6 : 1,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: 'var(--font-display)',
                        fontWeight: 600,
                        fontSize: 14,
                        color: 'rgb(var(--text-primary))',
                        marginBottom: 3,
                      }}
                    >
                      {item.serviceName?.trim() || 'Service'}
                    </div>
                    <div style={{ ...monoLabel, fontSize: 11, color: 'rgb(var(--text-muted))' }}>
                      {line}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}

        <NavItem
          label="Looks"
          href={ROUTES.looks}
          icon={<Sparkles size={22} />}
          active={isActivePath(path, ROUTES.looks)}
        />
        <NavItem
          label="Calendar"
          href={ROUTES.calendar}
          icon={<CalendarDays size={22} />}
          active={isActivePath(path, ROUTES.calendar)}
        />

        {/* Center: the live appointment-flow button */}
        <div
          className="tovis-center-lift-lg"
          style={{ display: 'grid', placeItems: 'center' }}
        >
          <div style={{ position: 'relative', display: 'grid', placeItems: 'center' }}>
            {centerIsLive ? (
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  width: 72,
                  height: 72,
                  borderRadius: '50%',
                  background: 'rgb(var(--accent-primary))',
                  animation: 'tovisPulse 2.4s ease-out infinite',
                }}
              />
            ) : null}

            <button
              type="button"
              onClick={() => void handleCenterClick()}
              disabled={centerDisabled}
              aria-disabled={centerDisabled}
              aria-label={showCameraIcon ? 'Open camera' : rawLabel || 'Start'}
              title={title}
              data-active={centerIsLive ? 'true' : undefined}
              className="tovis-focus"
              style={{
                position: 'relative',
                width: 72,
                height: 72,
                borderRadius: '50%',
                padding: centerIsLive ? 3 : 0,
                // tenant-adaptive CTA gradient (rebrands per white-label tenant), not the brand-constant plume
                background: centerIsLive ? 'var(--cta)' : 'rgb(var(--bg-surface))',
                border: centerIsLive ? 'none' : '1.5px solid var(--line-strong)',
                boxShadow: centerIsLive ? '0 14px 32px var(--tovis-acc-shadow)' : 'none',
                cursor: centerDisabled ? 'not-allowed' : 'pointer',
              }}
            >
              <span
                style={{
                  display: 'grid',
                  placeItems: 'center',
                  width: '100%',
                  height: '100%',
                  borderRadius: '50%',
                  background: centerIsLive ? 'var(--tovis-coin)' : 'transparent',
                  color: centerIsLive ? 'rgb(var(--accent-primary))' : 'rgb(var(--text-muted))',
                }}
              >
                {showCameraIcon ? (
                  <Camera size={24} aria-hidden="true" />
                ) : (
                  <span
                    style={{
                      ...monoLabel,
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {label}
                  </span>
                )}
              </span>

              {/* eligible-booking count when picking */}
              {pickerCount > 1 ? (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    top: -4,
                    right: -4,
                    height: 20,
                    minWidth: 20,
                    padding: '0 4px',
                    borderRadius: 999,
                    background: 'rgb(var(--color-acid))',
                    color: 'rgb(var(--on-accent))',
                    border: '2px solid rgb(var(--bg-surface))',
                    ...monoLabel,
                    fontSize: 10,
                    fontWeight: 700,
                    lineHeight: '18px',
                    textAlign: 'center',
                  }}
                >
                  {pickerCount}
                </span>
              ) : null}
            </button>
          </div>
        </div>

        <NavItem
          label="Messages"
          href={ROUTES.messages}
          icon={<MessageCircle size={22} />}
          active={isActivePath(path, ROUTES.messages)}
          rightSlot={badge ? <BadgeDot label={badge} /> : null}
        />
        <NavItem
          label="Profile"
          href={ROUTES.profile}
          icon={<User size={22} />}
          active={isActivePath(path, ROUTES.profile)}
        />
      </nav>
    </div>
  )
}
