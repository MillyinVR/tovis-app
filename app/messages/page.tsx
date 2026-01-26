// app/messages/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

function upper(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

function initialsFromName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const a = parts[0]?.[0] ?? ''
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : ''
  return (a + b).toUpperCase() || '?'
}

function formatPersonName(first?: string | null, last?: string | null) {
  return `${first || ''} ${last || ''}`.trim()
}

function fmtDayTime(d: Date) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}

function contextLabel(t: unknown) {
  const s = upper(t)
  if (s === 'BOOKING') return 'Booking'
  if (s === 'SERVICE') return 'Service'
  if (s === 'OFFERING') return 'Offering'
  if (s === 'PRO_PROFILE') return 'Profile'
  return 'Message'
}

export default async function MessagesInboxPage() {
  const user = await getCurrentUser().catch(() => null)
  if (!user) redirect('/login?from=/messages')

  const threads = await prisma.messageThread.findMany({
    where: { participants: { some: { userId: user.id } } },
    orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
    take: 60,
    select: {
      id: true,
      contextType: true,
      contextId: true,
      bookingId: true,
      serviceId: true,
      offeringId: true,
      lastMessageAt: true,
      lastMessagePreview: true,
      updatedAt: true,
      client: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      professional: { select: { id: true, businessName: true, avatarUrl: true } },
      participants: {
        where: { userId: user.id },
        select: { lastReadAt: true },
        take: 1,
      },
    },
  })

  // Helpful lookups to make context subtitles feel “real” without extra client work.
  const bookingIds = threads.map((t) => t.bookingId).filter(Boolean) as string[]
  const serviceIds = threads.map((t) => t.serviceId).filter(Boolean) as string[]
  const offeringIds = threads.map((t) => t.offeringId).filter(Boolean) as string[]

  const [bookingMap, serviceMap, offeringMap] = await Promise.all([
    bookingIds.length
      ? prisma.booking
          .findMany({
            where: { id: { in: bookingIds } },
            select: { id: true, scheduledFor: true, service: { select: { name: true } } },
          })
          .then((rows) => new Map(rows.map((r) => [r.id, r])))
      : Promise.resolve(new Map<string, any>()),

    serviceIds.length
      ? prisma.service
          .findMany({ where: { id: { in: serviceIds } }, select: { id: true, name: true } })
          .then((rows) => new Map(rows.map((r) => [r.id, r])))
      : Promise.resolve(new Map<string, any>()),

    offeringIds.length
      ? prisma.professionalServiceOffering
          .findMany({ where: { id: { in: offeringIds } }, select: { id: true, title: true, service: { select: { name: true } } } })
          .then((rows) => new Map(rows.map((r) => [r.id, r])))
      : Promise.resolve(new Map<string, any>()),
  ])

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 text-textPrimary">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[12px] font-black text-textSecondary">Messages</div>
          <h1 className="mt-1 text-xl font-black">Inbox</h1>
        </div>

        {/* Optional: role-based shortcut */}
        {user.role === 'PRO' ? (
          <Link href="/pro/bookings" className="text-[12px] font-black hover:opacity-80">
            ← Back to dashboard
          </Link>
        ) : (
          <Link href="/client/bookings" className="text-[12px] font-black hover:opacity-80">
            ← Back to dashboard
          </Link>
        )}
      </div>

      {threads.length === 0 ? (
        <div className="tovis-glass mt-4 rounded-card border border-white/10 bg-bgSecondary p-6">
          <div className="text-[13px] font-black">No messages yet</div>
          <div className="mt-2 text-[12px] font-semibold text-textSecondary">
            Once you message a pro (or they message you from a booking), you’ll see it here.
          </div>
          <div className="mt-4">
            <Link
              href="/looks"
              className="inline-flex rounded-full bg-accentPrimary px-5 py-3 text-[13px] font-black text-bgPrimary hover:bg-accentPrimaryHover"
            >
              Browse Looks
            </Link>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid gap-2">
          {threads.map((t) => {
            const lastReadAt = t.participants?.[0]?.lastReadAt ?? null
            const lastAt = (t.lastMessageAt ?? t.updatedAt) as Date
            const isUnread = Boolean(t.lastMessageAt && (!lastReadAt || new Date(lastReadAt) < new Date(t.lastMessageAt)))

            const viewerRole = user.role
            const title =
              viewerRole === 'PRO'
                ? formatPersonName(t.client?.firstName, t.client?.lastName) || 'Client'
                : t.professional?.businessName || 'Professional'

            const avatarUrl = viewerRole === 'PRO' ? t.client?.avatarUrl : t.professional?.avatarUrl
            const avatarFallback = initialsFromName(title)

            // Context subtitle
            let subtitle = contextLabel(t.contextType)
            const ctx = upper(t.contextType)

            if (ctx === 'BOOKING' && t.bookingId) {
              const b = bookingMap.get(t.bookingId)
              const svcName = b?.service?.name ? String(b.service.name) : null
              const when = b?.scheduledFor ? fmtDayTime(new Date(b.scheduledFor)) : null
              subtitle = [subtitle, svcName, when].filter(Boolean).join(' · ')
            } else if (ctx === 'SERVICE' && t.serviceId) {
              const s = serviceMap.get(t.serviceId)
              subtitle = [subtitle, s?.name].filter(Boolean).join(' · ')
            } else if (ctx === 'OFFERING' && t.offeringId) {
              const o = offeringMap.get(t.offeringId)
              const name = o?.title || o?.service?.name
              subtitle = [subtitle, name].filter(Boolean).join(' · ')
            } else if (ctx === 'PRO_PROFILE') {
              subtitle = 'Profile'
            }

            const preview = (t.lastMessagePreview || '').trim() || 'Say hi…'

            return (
              <Link
                key={t.id}
                href={`/messages/thread/${encodeURIComponent(t.id)}`}
                className="tovis-glass group rounded-card border border-white/10 bg-bgSecondary p-4 hover:border-white/20"
              >
                <div className="flex items-center gap-3">
                  <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full border border-white/10 bg-bgPrimary/35">
                    {avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[12px] font-black text-textPrimary">
                        {avatarFallback}
                      </div>
                    )}

                    {isUnread ? (
                      <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-accentPrimary ring-2 ring-bgSecondary" />
                    ) : null}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="truncate text-[13px] font-black">{title}</div>
                      <div className="shrink-0 text-[11px] font-semibold text-textSecondary">
                        {fmtDayTime(new Date(lastAt))}
                      </div>
                    </div>

                    <div className="mt-0.5 truncate text-[11px] font-semibold text-textSecondary">{subtitle}</div>

                    <div className={`mt-1 truncate text-[12px] font-semibold ${isUnread ? 'text-textPrimary' : 'text-textSecondary'}`}>
                      {preview}
                    </div>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </main>
  )
}
