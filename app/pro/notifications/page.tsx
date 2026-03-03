// app/pro/notifications/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import MarkReadOnMount from './MarkReadOnMount'
import { getCurrentUser } from '@/lib/currentUser'
import { prisma } from '@/lib/prisma'
import { formatInTimeZone } from '@/lib/formatInTimeZone'
import { DEFAULT_TIME_ZONE, sanitizeTimeZone, getZonedParts } from '@/lib/timeZone'
import { NotificationType, Prisma, Role } from '@prisma/client'

export const dynamic = 'force-dynamic'

type NotifRow = {
  id: string
  type: NotificationType
  title: string
  body: string
  href: string
  createdAt: Date
  readAt: Date | null
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function spString(v: unknown): string {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return typeof v[0] === 'string' ? v[0] : ''
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

function parseNotificationType(raw: unknown): NotificationType | null {
  const s = spString(raw).trim().toUpperCase()
  if (s === NotificationType.BOOKING_REQUEST) return NotificationType.BOOKING_REQUEST
  if (s === NotificationType.BOOKING_UPDATE) return NotificationType.BOOKING_UPDATE
  if (s === NotificationType.BOOKING_CANCELLED) return NotificationType.BOOKING_CANCELLED
  if (s === NotificationType.REVIEW) return NotificationType.REVIEW
  return null
}

function typeLabel(t: NotificationType) {
  if (t === NotificationType.BOOKING_REQUEST) return 'Booking request'
  if (t === NotificationType.BOOKING_UPDATE) return 'Booking update'
  if (t === NotificationType.BOOKING_CANCELLED) return 'Booking cancelled'
  return 'New review'
}

function typeColor(t: NotificationType) {
  if (t === NotificationType.BOOKING_REQUEST) return 'hsl(24 95% 53%)'
  if (t === NotificationType.BOOKING_UPDATE) return 'hsl(221 83% 53%)'
  if (t === NotificationType.BOOKING_CANCELLED) return 'hsl(0 84% 60%)'
  return 'hsl(142 71% 45%)'
}

function safeInternalHref(raw: string): string {
  const s = (raw || '').trim()
  if (!s) return '/pro/notifications'
  if (!s.startsWith('/')) return '/pro/notifications'
  if (s.startsWith('//')) return '/pro/notifications'
  return s
}

function buildHref(base: string, q: Record<string, string | null | undefined>) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) {
    const val = typeof v === 'string' ? v.trim() : ''
    if (!val) continue
    sp.set(k, val)
  }
  const qs = sp.toString()
  return qs ? `${base}?${qs}` : base
}

function buildWhere(args: {
  professionalId: string
  type: NotificationType | null
  unreadOnly: boolean
}): Prisma.NotificationWhereInput {
  const where: Prisma.NotificationWhereInput = { professionalId: args.professionalId }
  if (args.type) where.type = args.type
  if (args.unreadOnly) where.readAt = null
  return where
}

async function loadNotificationsForPro(args: {
  professionalId: string
  type: NotificationType | null
  unreadOnly: boolean
  take: number
}): Promise<NotifRow[]> {
  const baseWhere = buildWhere({
    professionalId: args.professionalId,
    type: args.type,
    unreadOnly: false, // used for base; we apply readAt filters below
  })

  // Unread-only path (single query)
  if (args.unreadOnly) {
    const rows = await prisma.notification.findMany({
      where: { ...baseWhere, readAt: null },
      orderBy: { createdAt: 'desc' },
      take: args.take,
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        href: true,
        createdAt: true,
        readAt: true,
      },
    })

    return rows.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      href: n.href,
      createdAt: n.createdAt,
      readAt: n.readAt,
    }))
  }

  // Unread-first ordering (deterministic, no DB null-order dependence)
  const unread = await prisma.notification.findMany({
    where: { ...baseWhere, readAt: null },
    orderBy: { createdAt: 'desc' },
    take: args.take,
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      href: true,
      createdAt: true,
      readAt: true,
    },
  })

  const remaining = Math.max(0, args.take - unread.length)

  const read =
    remaining > 0
      ? await prisma.notification.findMany({
          where: { ...baseWhere, readAt: { not: null } },
          orderBy: { createdAt: 'desc' },
          take: remaining,
          select: {
            id: true,
            type: true,
            title: true,
            body: true,
            href: true,
            createdAt: true,
            readAt: true,
          },
        })
      : []

  return [...unread, ...read].map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    href: n.href,
    createdAt: n.createdAt,
    readAt: n.readAt,
  }))
}

function ymdKey(d: Date, timeZone: string) {
  const p = getZonedParts(d, timeZone)
  const mm = String(p.month).padStart(2, '0')
  const dd = String(p.day).padStart(2, '0')
  return `${p.year}-${mm}-${dd}`
}

function dayLabel(d: Date, timeZone: string, todayKey: string, yesterdayKey: string) {
  const key = ymdKey(d, timeZone)
  if (key === todayKey) return 'Today'
  if (key === yesterdayKey) return 'Yesterday'
  return formatInTimeZone(d, timeZone, { weekday: 'short', month: 'short', day: 'numeric' })
}

export default async function ProNotificationsPage(props: { searchParams?: SearchParams }) {
  const user = await getCurrentUser()
  if (!user || user.role !== Role.PRO || !user.professionalProfile) {
    redirect('/login?from=/pro/notifications')
  }

  const sp = (await props.searchParams) ?? {}

  const type = parseNotificationType(sp.type)
  const unreadOnly = parseUnreadOnly(sp.unread)
  const take = parseTake(sp.take)

  const timeZone = sanitizeTimeZone(user.professionalProfile.timeZone, DEFAULT_TIME_ZONE)

  const whereForCount = buildWhere({ professionalId: user.professionalProfile.id, type, unreadOnly })
  const [rows, matchCount, unreadCount] = await Promise.all([
    loadNotificationsForPro({ professionalId: user.professionalProfile.id, type, unreadOnly, take }),
    prisma.notification.count({ where: whereForCount }),
    prisma.notification.count({ where: { professionalId: user.professionalProfile.id, readAt: null } }),
  ])

  const now = new Date()
  const todayKey = ymdKey(now, timeZone)
  const yesterdayKey = ymdKey(new Date(now.getTime() - 24 * 60 * 60_000), timeZone)

  const grouped = (() => {
    const out: Array<{ key: string; label: string; items: NotifRow[] }> = []
    const byKey = new Map<string, NotifRow[]>()

    for (const n of rows) {
      const k = ymdKey(n.createdAt, timeZone)
      const arr = byKey.get(k) ?? []
      arr.push(n)
      byKey.set(k, arr)
    }

    // preserve order based on rows (already unread-first + createdAt desc within each bucket),
    // so we build groups in encounter order:
    const seen: string[] = []
    for (const n of rows) {
      const k = ymdKey(n.createdAt, timeZone)
      if (!seen.includes(k)) seen.push(k)
    }

    for (const k of seen) {
      const items = byKey.get(k) ?? []
      out.push({ key: k, label: dayLabel(items[0]?.createdAt ?? now, timeZone, todayKey, yesterdayKey), items })
    }

    return out
  })()

  const base = '/pro/notifications'
  const qsBase = {
    type: type ?? null,
    unread: unreadOnly ? '1' : null,
  }

  const takeNext = Math.min(200, take + 60)
  const canShowMore = rows.length >= take && matchCount > rows.length && takeNext > take

  const chips = [
    { label: 'All', href: buildHref(base, { type: null, unread: null, take: '60' }), active: !type && !unreadOnly },
    {
      label: `Unread${unreadCount ? ` (${unreadCount})` : ''}`,
      href: buildHref(base, { type: type ?? null, unread: '1', take: '60' }),
      active: unreadOnly,
    },
    {
      label: 'Requests',
      href: buildHref(base, { unread: unreadOnly ? '1' : null, type: NotificationType.BOOKING_REQUEST, take: '60' }),
      active: type === NotificationType.BOOKING_REQUEST,
    },
    {
      label: 'Updates',
      href: buildHref(base, { unread: unreadOnly ? '1' : null, type: NotificationType.BOOKING_UPDATE, take: '60' }),
      active: type === NotificationType.BOOKING_UPDATE,
    },
    {
      label: 'Cancelled',
      href: buildHref(base, { unread: unreadOnly ? '1' : null, type: NotificationType.BOOKING_CANCELLED, take: '60' }),
      active: type === NotificationType.BOOKING_CANCELLED,
    },
    {
      label: 'Reviews',
      href: buildHref(base, { unread: unreadOnly ? '1' : null, type: NotificationType.REVIEW, take: '60' }),
      active: type === NotificationType.REVIEW,
    },
  ] as const

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-4">
      <MarkReadOnMount />

      {/* Header */}
      <div className="sticky top-3 z-30 rounded-card border border-surfaceGlass/10 bg-bgSecondary/80 p-3 shadow-[0_18px_60px_rgb(0_0_0/0.55)] backdrop-blur-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-extrabold text-textSecondary">Pro</div>
            <h1 className="mt-0.5 truncate text-[16px] font-black text-textPrimary">Notifications</h1>
            <div className="mt-1 text-[11px] text-textSecondary">
              {matchCount ? (
                <>
                  Showing <span className="font-extrabold text-textPrimary">{rows.length}</span> of{' '}
                  <span className="font-extrabold text-textPrimary">{matchCount}</span>
                  {type ? <> • {typeLabel(type)}</> : null}
                  {unreadOnly ? <> • Unread only</> : null}
                </>
              ) : (
                'No notifications'
              )}
            </div>
          </div>

          <div className="shrink-0 rounded-full border border-surfaceGlass/12 bg-bgPrimary/30 px-3 py-1 text-[11px] font-black text-textSecondary">
            TZ: <span className="text-textPrimary">{timeZone}</span>
          </div>
        </div>

        {/* Chips */}
        <div className="mt-3 flex flex-wrap gap-2">
          {chips.map((c) => (
            <Link
              key={c.label}
              href={c.href}
              prefetch={false}
              className={[
                'inline-flex items-center rounded-full border px-3 py-1.5 text-[12px] font-extrabold transition',
                c.active
                  ? 'border-surfaceGlass/25 bg-bgPrimary text-textPrimary'
                  : 'border-surfaceGlass/10 bg-bgSecondary text-textSecondary hover:border-surfaceGlass/20 hover:text-textPrimary',
              ].join(' ')}
            >
              {c.label}
            </Link>
          ))}

          {/* Show more */}
          {canShowMore ? (
            <Link
              href={buildHref(base, { ...qsBase, take: String(takeNext) })}
              prefetch={false}
              className="ml-auto inline-flex items-center rounded-full border border-accentPrimary/35 bg-accentPrimary/12 px-3 py-1.5 text-[12px] font-extrabold text-textPrimary transition hover:border-accentPrimary/55 hover:bg-accentPrimary/16"
            >
              Show more
            </Link>
          ) : null}
        </div>
      </div>

      {/* Body */}
      <div className="mt-4 grid gap-4">
        {rows.length === 0 ? (
          <div className="rounded-card border border-surfaceGlass/10 bg-bgSecondary p-4">
            <div className="text-[14px] font-black text-textPrimary">You’re caught up.</div>
            <div className="mt-1 text-[12px] text-textSecondary">
              When booking requests, updates, cancellations, or reviews happen, they’ll show up here.
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href="/pro/calendar"
                className="inline-flex items-center rounded-full border border-surfaceGlass/15 bg-bgPrimary/35 px-3 py-2 text-[12px] font-extrabold text-textPrimary hover:border-surfaceGlass/25"
              >
                Go to calendar
              </Link>
              <Link
                href="/pro/messages"
                className="inline-flex items-center rounded-full border border-surfaceGlass/15 bg-bgPrimary/35 px-3 py-2 text-[12px] font-extrabold text-textPrimary hover:border-surfaceGlass/25"
              >
                Open messages
              </Link>
            </div>
          </div>
        ) : (
          grouped.map((g) => (
            <section key={g.key} className="grid gap-2">
              <div className="flex items-center justify-between">
                <div className="text-[12px] font-black text-textSecondary">{g.label}</div>
                <div className="text-[11px] text-textSecondary">{g.items.length} item{g.items.length === 1 ? '' : 's'}</div>
              </div>

              <div className="grid gap-2">
                {g.items.map((n) => {
                  const unread = !n.readAt
                  const href = safeInternalHref(n.href)

                  return (
                    <Link
                      key={n.id}
                      href={href}
                      prefetch={false}
                      className="group block rounded-card border border-surfaceGlass/10 bg-bgSecondary p-3 no-underline transition hover:border-surfaceGlass/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/15"
                      aria-label={`${typeLabel(n.type)}: ${n.title}`}
                    >
                      <div className="flex items-start gap-3">
                        {/* Type rail */}
                        <div className="mt-0.5 h-10 w-1.5 rounded-full" style={{ background: typeColor(n.type) }} />

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2">
                              <div className="truncate text-[12px] font-extrabold" style={{ color: typeColor(n.type) }}>
                                {typeLabel(n.type)}
                              </div>
                              {unread ? (
                                <span className="inline-flex items-center rounded-full border border-surfaceGlass/12 bg-bgPrimary/30 px-2 py-0.5 text-[10px] font-black text-textPrimary">
                                  Unread
                                </span>
                              ) : null}
                            </div>

                            <div className="shrink-0 text-[11px] text-textSecondary">
                              {formatInTimeZone(n.createdAt, timeZone, { hour: 'numeric', minute: '2-digit' })}
                            </div>
                          </div>

                          <div className="mt-1 truncate text-[13px] font-black text-textPrimary">{n.title}</div>

                          {n.body ? (
                            <div className="mt-1 line-clamp-2 text-[12px] text-textSecondary">{n.body}</div>
                          ) : null}

                          {/* subtle affordance */}
                          <div className="mt-2 text-[11px] font-extrabold text-textSecondary opacity-0 transition group-hover:opacity-100">
                            Open →
                          </div>
                        </div>
                      </div>
                    </Link>
                  )
                })}
              </div>
            </section>
          ))
        )}
      </div>

      {/* Footer controls */}
      {rows.length > 0 ? (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-2 text-[11px] text-textSecondary">
          <div>
            Unread first • Times shown in <span className="font-extrabold text-textPrimary">{timeZone}</span>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href={buildHref(base, { ...qsBase, take: '60' })}
              prefetch={false}
              className="rounded-full border border-surfaceGlass/12 bg-bgPrimary/25 px-3 py-1.5 font-extrabold text-textPrimary hover:border-surfaceGlass/20"
            >
              Reset view
            </Link>

            {canShowMore ? (
              <Link
                href={buildHref(base, { ...qsBase, take: String(takeNext) })}
                prefetch={false}
                className="rounded-full border border-accentPrimary/35 bg-accentPrimary/12 px-3 py-1.5 font-extrabold text-textPrimary hover:border-accentPrimary/55"
              >
                Show more
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  )
}