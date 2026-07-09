'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { NotificationEventKey } from '@prisma/client'

type ClientNotificationCardProps = {
  id: string
  eventKey: NotificationEventKey
  title: string
  body: string
  href: string
  createdAtLabel: string
  unread: boolean
}

function eventKeyLabel(eventKey: NotificationEventKey): string {
  switch (eventKey) {
    case NotificationEventKey.BOOKING_CONFIRMED:
      return 'Confirmed'
    case NotificationEventKey.BOOKING_RESCHEDULED:
      return 'Rescheduled'
    case NotificationEventKey.BOOKING_CANCELLED_BY_CLIENT:
    case NotificationEventKey.BOOKING_CANCELLED_BY_PRO:
    case NotificationEventKey.BOOKING_CANCELLED_BY_ADMIN:
      return 'Cancelled'
    case NotificationEventKey.CONSULTATION_PROPOSAL_SENT:
    case NotificationEventKey.CONSULTATION_APPROVED:
    case NotificationEventKey.CONSULTATION_REJECTED:
      return 'Consultation'
    case NotificationEventKey.CLIENT_CLAIM_INVITE:
      return 'Invite'
    case NotificationEventKey.APPOINTMENT_REMINDER:
      return 'Reminder'
    case NotificationEventKey.AFTERCARE_READY:
      return 'Aftercare'
    case NotificationEventKey.LAST_MINUTE_OPENING_AVAILABLE:
      return 'Last-minute'
    case NotificationEventKey.PAYMENT_COLLECTED:
      return 'Payment'
    case NotificationEventKey.PAYMENT_ACTION_REQUIRED:
      return 'Action needed'
    case NotificationEventKey.PAYMENT_REFUNDED:
      return 'Refund'
    case NotificationEventKey.REVIEW_RECEIVED:
      return 'Review'
    case NotificationEventKey.LOOK_FOLLOWER_NEW:
    case NotificationEventKey.CLIENT_FOLLOW:
      return 'Follower'
    case NotificationEventKey.LOOK_COMMENTED:
    case NotificationEventKey.LOOK_COMMENT_REPLIED:
      return 'Comment'
    case NotificationEventKey.REFERRAL_TAP_RECEIVED:
    case NotificationEventKey.REFERRAL_CONFIRMED:
    case NotificationEventKey.REFERRAL_CONVERTED:
      return 'Referral'
    case NotificationEventKey.VIRAL_REQUEST_APPROVED:
      return 'Featured'
    case NotificationEventKey.MESSAGE_RECEIVED:
      return 'Message'
    default:
      return 'Update'
  }
}

function eventKeyBadgeClass(eventKey: NotificationEventKey): string {
  switch (eventKey) {
    case NotificationEventKey.BOOKING_CANCELLED_BY_CLIENT:
    case NotificationEventKey.BOOKING_CANCELLED_BY_PRO:
    case NotificationEventKey.BOOKING_CANCELLED_BY_ADMIN:
      return 'border-toneDanger/30 bg-toneDanger/10 text-textPrimary'
    case NotificationEventKey.PAYMENT_ACTION_REQUIRED:
      return 'border-toneWarn/30 bg-toneWarn/10 text-textPrimary'
    case NotificationEventKey.BOOKING_CONFIRMED:
    case NotificationEventKey.PAYMENT_COLLECTED:
    case NotificationEventKey.MESSAGE_RECEIVED:
      return 'border-accentPrimary/35 bg-accentPrimary/12 text-textPrimary'
    default:
      return 'border-surfaceGlass/14 bg-bgPrimary/40 text-textPrimary'
  }
}

// Notifications deep-link into the client app; keep it internal + same-origin.
function safeInternalHref(raw: string): string {
  const value = (raw || '').trim()
  if (!value) return '/client/notifications'
  if (!value.startsWith('/')) return '/client/notifications'
  if (value.startsWith('//')) return '/client/notifications'
  return value
}

function buildCardClass(unread: boolean): string {
  return [
    'group block rounded-card border p-3 no-underline transition',
    unread
      ? 'border-accentPrimary/20 bg-bgSecondary shadow-soft hover:border-accentPrimary/35'
      : 'border-surfaceGlass/10 bg-bgSecondary hover:border-surfaceGlass/20',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/25',
  ].join(' ')
}

function isModifiedClick(event: React.MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    event.button !== 0
  )
}

export default function ClientNotificationCard(props: ClientNotificationCardProps) {
  const router = useRouter()
  const href = safeInternalHref(props.href)

  const [isUnread, setIsUnread] = useState(props.unread)
  const [isMarkingRead, setIsMarkingRead] = useState(false)

  async function markReadBestEffort(): Promise<void> {
    if (!isUnread || isMarkingRead) return

    setIsMarkingRead(true)
    setIsUnread(false)

    try {
      const res = await fetch('/api/v1/client/notifications/read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [props.id] }),
        cache: 'no-store',
      })
      if (!res.ok) setIsUnread(true)
    } catch {
      setIsUnread(true)
    } finally {
      setIsMarkingRead(false)
    }
  }

  async function handleClick(event: React.MouseEvent<HTMLAnchorElement>) {
    if (isModifiedClick(event)) return
    event.preventDefault()
    await markReadBestEffort()
    router.push(href)
    router.refresh()
  }

  return (
    <Link
      href={href}
      prefetch={false}
      onClick={handleClick}
      className={buildCardClass(isUnread)}
      aria-label={`${eventKeyLabel(props.eventKey)}: ${props.title}`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={[
                  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.08em]',
                  eventKeyBadgeClass(props.eventKey),
                ].join(' ')}
              >
                {eventKeyLabel(props.eventKey)}
              </span>

              {isUnread ? (
                <span className="inline-flex items-center rounded-full border border-accentPrimary/25 bg-accentPrimary/10 px-2 py-0.5 text-[10px] font-black text-textPrimary">
                  Unread
                </span>
              ) : null}
            </div>

            <div className="shrink-0 text-[11px] text-textSecondary">
              {props.createdAtLabel}
            </div>
          </div>

          <div className="mt-2 truncate text-[13px] font-black text-textPrimary">
            {props.title}
          </div>

          {props.body ? (
            <div className="mt-1 line-clamp-2 text-[12px] text-textSecondary">
              {props.body}
            </div>
          ) : null}

          <div className="mt-2 text-[11px] font-extrabold text-textSecondary opacity-0 transition group-hover:opacity-100">
            Open details →
          </div>
        </div>
      </div>
    </Link>
  )
}
