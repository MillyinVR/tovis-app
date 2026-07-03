// app/client/(gated)/notifications/page.tsx
//
// The client notification center — the web counterpart of the native iOS
// NotificationsView and the mirror of the pro center (app/pro/notifications).
// Reads the client's own ClientNotification rows (unread first), grouped by day,
// with All / Unread / Bookings / Payments / Social filters, mark-all-read, and
// "show more". Marking read here writes the SAME rows the native app + the
// activity feed read, so every surface stays in step.
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentUser } from '@/lib/currentUser'
import { getBrandConfig } from '@/lib/brand'
import { prisma } from '@/lib/prisma'
import { formatInTimeZone } from '@/lib/formatInTimeZone'
import { DEFAULT_TIME_ZONE, getZonedParts } from '@/lib/timeZone'
import { NotificationEventKey, Prisma, Role } from '@prisma/client'

import ClientNotificationCard from './ClientNotificationCard'
import ClientMarkAllReadButton from './ClientMarkAllReadButton'

export const dynamic = 'force-dynamic'

type NotificationCategory = 'BOOKINGS' | 'PAYMENTS' | 'SOCIAL'

type NotifRow = {
  id: string
  eventKey: NotificationEventKey
  title: string
  body: string | null
  href: string
  createdAt: Date
  readAt: Date | null
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const CATEGORY_EVENT_KEYS: Record<
  NotificationCategory,
  readonly NotificationEventKey[]
> = {
  BOOKINGS: [
    NotificationEventKey.BOOKING_CONFIRMED,
    NotificationEventKey.BOOKING_RESCHEDULED,
    NotificationEventKey.BOOKING_CANCELLED_BY_CLIENT,
    NotificationEventKey.BOOKING_CANCELLED_BY_PRO,
    NotificationEventKey.BOOKING_CANCELLED_BY_ADMIN,
    NotificationEventKey.CONSULTATION_PROPOSAL_SENT,
    NotificationEventKey.CONSULTATION_APPROVED,
    NotificationEventKey.CONSULTATION_REJECTED,
    NotificationEventKey.CLIENT_CLAIM_INVITE,
    NotificationEventKey.APPOINTMENT_REMINDER,
    NotificationEventKey.AFTERCARE_READY,
    NotificationEventKey.LAST_MINUTE_OPENING_AVAILABLE,
  ],
  PAYMENTS: [
    NotificationEventKey.PAYMENT_COLLECTED,
    NotificationEventKey.PAYMENT_ACTION_REQUIRED,
    NotificationEventKey.PAYMENT_REFUNDED,
  ],
  SOCIAL: [
    NotificationEventKey.REVIEW_RECEIVED,
    NotificationEventKey.VIRAL_REQUEST_APPROVED,
    NotificationEventKey.LOOK_FOLLOWER_NEW,
    NotificationEventKey.CLIENT_FOLLOW,
    NotificationEventKey.LOOK_COMMENTED,
    NotificationEventKey.LOOK_COMMENT_REPLIED,
    NotificationEventKey.LOOK_LIKED,
    NotificationEventKey.LOOK_SAVED,
    NotificationEventKey.LOOK_NEW_FROM_FOLLOWED_PRO,
    NotificationEventKey.REFERRAL_TAP_RECEIVED,
    NotificationEventKey.REFERRAL_CONFIRMED,
    NotificationEventKey.REFERRAL_CONVERTED,
  ],
}

function spString(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : ''
  return ''
}

function parseTake(raw: unknown): number {
  const n = Number(spString(raw).trim() || '60')
  if (!Number.isFinite(n)) return 60
  return Math.max(20, Math.min(200, Math.trunc(n)))
}

function parseUnreadOnly(raw: unknown): boolean {
  const s = spString(raw).trim().toLowerCase()
  return s === '1' || s === 'true' || s === 'yes'
}

function parseNotificationCategory(raw: unknown): NotificationCategory | null {
  const s = spString(raw).trim().toUpperCase()
  if (s === 'BOOKINGS') return 'BOOKINGS'
  if (s === 'PAYMENTS') return 'PAYMENTS'
  if (s === 'SOCIAL') return 'SOCIAL'
  return null
}

function categoryLabel(category: NotificationCategory): string {
  if (category === 'BOOKINGS') return 'Bookings'
  if (category === 'PAYMENTS') return 'Payments'
  return 'Social'
}

function buildHref(
  base: string,
  query: Record<string, string | null | undefined>,
): string {
  const sp = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    const normalized = typeof value === 'string' ? value.trim() : ''
    if (!normalized) continue
    sp.set(key, normalized)
  }
  const qs = sp.toString()
  return qs ? `${base}?${qs}` : base
}

function buildWhere(args: {
  clientId: string
  category: NotificationCategory | null
  unreadOnly: boolean
}): Prisma.ClientNotificationWhereInput {
  const where: Prisma.ClientNotificationWhereInput = {
    clientId: args.clientId,
  }
  if (args.category) {
    where.eventKey = { in: [...CATEGORY_EVENT_KEYS[args.category]] }
  }
  if (args.unreadOnly) {
    where.readAt = null
  }
  return where
}

const ROW_SELECT = {
  id: true,
  eventKey: true,
  title: true,
  body: true,
  href: true,
  createdAt: true,
  readAt: true,
} satisfies Prisma.ClientNotificationSelect

async function loadNotificationsForClient(args: {
  clientId: string
  category: NotificationCategory | null
  unreadOnly: boolean
  take: number
}): Promise<NotifRow[]> {
  const baseWhere = buildWhere({
    clientId: args.clientId,
    category: args.category,
    unreadOnly: false,
  })

  // Unread-only: a single page of unread rows.
  if (args.unreadOnly) {
    return prisma.clientNotification.findMany({
      where: { ...baseWhere, readAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: args.take,
      select: ROW_SELECT,
    })
  }

  // Default: unread first, then fill the remainder with read rows.
  const unread = await prisma.clientNotification.findMany({
    where: { ...baseWhere, readAt: null },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: args.take,
    select: ROW_SELECT,
  })

  const remaining = Math.max(0, args.take - unread.length)
  const read =
    remaining > 0
      ? await prisma.clientNotification.findMany({
          where: { ...baseWhere, readAt: { not: null } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: remaining,
          select: ROW_SELECT,
        })
      : []

  return [...unread, ...read]
}

function ymdKey(date: Date, timeZone: string): string {
  const p = getZonedParts(date, timeZone)
  const mm = String(p.month).padStart(2, '0')
  const dd = String(p.day).padStart(2, '0')
  return `${p.year}-${mm}-${dd}`
}

function dayLabel(
  date: Date,
  timeZone: string,
  todayKey: string,
  yesterdayKey: string,
): string {
  const key = ymdKey(date, timeZone)
  if (key === todayKey) return 'Today'
  if (key === yesterdayKey) return 'Yesterday'
  return formatInTimeZone(date, timeZone, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

export default async function ClientNotificationsPage(props: {
  searchParams?: SearchParams
}) {
  const user = await getCurrentUser()
  const brand = getBrandConfig()

  if (!user || user.role !== Role.CLIENT || !user.clientProfile?.id) {
    redirect('/login?from=/client/notifications')
  }

  const clientId = user.clientProfile.id
  const sp = (await props.searchParams) ?? {}

  const category = parseNotificationCategory(sp.category)
  const unreadOnly = parseUnreadOnly(sp.unread)
  const take = parseTake(sp.take)
  // Clients have no stored timezone — group by the app default.
  const timeZone = DEFAULT_TIME_ZONE

  const whereForCount = buildWhere({ clientId, category, unreadOnly })

  const [rows, matchCount, unreadCount] = await Promise.all([
    loadNotificationsForClient({ clientId, category, unreadOnly, take }),
    prisma.clientNotification.count({ where: whereForCount }),
    prisma.clientNotification.count({
      where: { clientId, readAt: null },
    }),
  ])

  const now = new Date()
  const todayKey = ymdKey(now, timeZone)
  const yesterdayKey = ymdKey(
    new Date(now.getTime() - 24 * 60 * 60 * 1000),
    timeZone,
  )

  const grouped = (() => {
    const groups = new Map<string, NotifRow[]>()
    const order: string[] = []
    for (const row of rows) {
      const key = ymdKey(row.createdAt, timeZone)
      const existing = groups.get(key)
      if (!existing) {
        groups.set(key, [row])
        order.push(key)
      } else {
        existing.push(row)
      }
    }
    return order.map((key) => {
      const items = groups.get(key) ?? []
      const first = items[0]?.createdAt ?? now
      return {
        key,
        label: dayLabel(first, timeZone, todayKey, yesterdayKey),
        items,
      }
    })
  })()

  const base = '/client/notifications'
  const baseQuery = {
    category: category ?? null,
    unread: unreadOnly ? '1' : null,
  }

  const takeNext = Math.min(200, take + 60)
  const canShowMore =
    rows.length >= take && matchCount > rows.length && takeNext > take

  const chips = [
    {
      label: 'All',
      href: buildHref(base, { category: null, unread: null, take: '60' }),
      active: !category && !unreadOnly,
    },
    {
      label: `Unread${unreadCount ? ` (${unreadCount})` : ''}`,
      href: buildHref(base, {
        category: category ?? null,
        unread: '1',
        take: '60',
      }),
      active: unreadOnly,
    },
    {
      label: 'Bookings',
      href: buildHref(base, {
        unread: unreadOnly ? '1' : null,
        category: 'BOOKINGS',
        take: '60',
      }),
      active: category === 'BOOKINGS',
    },
    {
      label: 'Payments',
      href: buildHref(base, {
        unread: unreadOnly ? '1' : null,
        category: 'PAYMENTS',
        take: '60',
      }),
      active: category === 'PAYMENTS',
    },
    {
      label: 'Social',
      href: buildHref(base, {
        unread: unreadOnly ? '1' : null,
        category: 'SOCIAL',
        take: '60',
      }),
      active: category === 'SOCIAL',
    },
  ] as const

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-4">
      <div className="sticky top-3 z-30 rounded-card border border-surfaceGlass/10 bg-bgSecondary/85 p-3 shadow-soft backdrop-blur-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-textSecondary">
              {brand.displayName}
            </div>
            <h1 className="mt-1 truncate text-[18px] font-black text-textPrimary">
              Notifications
            </h1>
            <div className="mt-1 text-[11px] text-textSecondary">
              {matchCount ? (
                <>
                  Showing{' '}
                  <span className="font-extrabold text-textPrimary">
                    {rows.length}
                  </span>{' '}
                  of{' '}
                  <span className="font-extrabold text-textPrimary">
                    {matchCount}
                  </span>
                  {category ? <> • {categoryLabel(category)}</> : null}
                  {unreadOnly ? <> • Unread only</> : null}
                </>
              ) : (
                'No notifications yet'
              )}
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-2">
            <Link
              href="/client/settings#notifications"
              prefetch={false}
              className="rounded-full border border-surfaceGlass/12 bg-bgPrimary/35 px-3 py-1 text-[11px] font-black text-textSecondary transition hover:text-textPrimary"
            >
              Settings
            </Link>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {chips.map((chip) => (
            <Link
              key={chip.label}
              href={chip.href}
              prefetch={false}
              aria-current={chip.active ? 'page' : undefined}
              className={[
                'inline-flex items-center rounded-full border px-3 py-1.5 text-[12px] font-extrabold transition',
                chip.active
                  ? 'border-accentPrimary/35 bg-accentPrimary/12 text-textPrimary'
                  : 'border-surfaceGlass/10 bg-bgSecondary text-textSecondary hover:border-surfaceGlass/20 hover:text-textPrimary',
              ].join(' ')}
            >
              {chip.label}
            </Link>
          ))}

          {rows.length > 0 ? (
            <ClientMarkAllReadButton unreadCount={unreadCount} />
          ) : null}

          {canShowMore ? (
            <Link
              href={buildHref(base, { ...baseQuery, take: String(takeNext) })}
              prefetch={false}
              className="ml-auto inline-flex items-center rounded-full border border-accentPrimary/35 bg-accentPrimary/12 px-3 py-1.5 text-[12px] font-extrabold text-textPrimary transition hover:border-accentPrimary/55"
            >
              Show more
            </Link>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid gap-4">
        {rows.length === 0 ? (
          <div className="rounded-card border border-surfaceGlass/10 bg-bgSecondary p-5">
            <div className="text-[15px] font-black text-textPrimary">
              You’re all caught up.
            </div>
            <div className="mt-1 text-[12px] text-textSecondary">
              Booking confirmations, reminders, payments, and updates from your
              pros will appear here.
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href="/client"
                className="inline-flex items-center rounded-full border border-surfaceGlass/15 bg-bgPrimary/35 px-3 py-2 text-[12px] font-extrabold text-textPrimary transition hover:border-surfaceGlass/25"
              >
                Go home
              </Link>
              <Link
                href="/client/bookings"
                className="inline-flex items-center rounded-full border border-surfaceGlass/15 bg-bgPrimary/35 px-3 py-2 text-[12px] font-extrabold text-textPrimary transition hover:border-surfaceGlass/25"
              >
                My bookings
              </Link>
            </div>
          </div>
        ) : (
          grouped.map((group) => (
            <section key={group.key} className="grid gap-2">
              <div className="flex items-center justify-between">
                <div className="text-[12px] font-black text-textSecondary">
                  {group.label}
                </div>
                <div className="text-[11px] text-textSecondary">
                  {group.items.length} item{group.items.length === 1 ? '' : 's'}
                </div>
              </div>

              <div className="grid gap-2">
                {group.items.map((notification) => (
                  <ClientNotificationCard
                    key={notification.id}
                    id={notification.id}
                    eventKey={notification.eventKey}
                    title={notification.title}
                    body={notification.body ?? ''}
                    href={notification.href}
                    createdAtLabel={formatInTimeZone(
                      notification.createdAt,
                      timeZone,
                      { hour: 'numeric', minute: '2-digit' },
                    )}
                    unread={!notification.readAt}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </main>
  )
}
