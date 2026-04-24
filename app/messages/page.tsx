// app/messages/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  MessageThreadContextType,
  Role,
  WaitlistPreferenceType,
  WaitlistStatus,
  WaitlistTimeOfDay,
  type Prisma,
} from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

type SearchParamsShape = Record<string, string | string[] | undefined>

type PageProps = {
  searchParams?: SearchParamsShape | Promise<SearchParamsShape>
}

type InboxFilter = 'all' | 'bookings' | 'waitlists' | 'pros'

type InboxThread = {
  id: string
  contextType: MessageThreadContextType
  contextId: string
  bookingId: string | null
  serviceId: string | null
  offeringId: string | null
  waitlistEntryId: string | null
  lastMessageAt: Date | null
  lastMessagePreview: string | null
  updatedAt: Date
  client: {
    id: string
    firstName: string | null
    lastName: string | null
    avatarUrl: string | null
  } | null
  professional: {
    id: string
    businessName: string | null
    avatarUrl: string | null
  } | null
  participants: {
    lastReadAt: Date | null
  }[]
}

type BookingLookup = {
  id: string
  scheduledFor: Date | null
  service: {
    name: string | null
  } | null
}

type ServiceLookup = {
  id: string
  name: string | null
}

type OfferingLookup = {
  id: string
  title: string | null
  service: {
    name: string | null
  } | null
}

type WaitlistLookup = {
  id: string
  status: WaitlistStatus
  preferenceType: WaitlistPreferenceType
  specificDate: Date | null
  timeOfDay: WaitlistTimeOfDay | null
  windowStartMin: number | null
  windowEndMin: number | null
  service: {
    name: string | null
  } | null
}

type ThreadPresentation = {
  title: string
  avatarUrl: string | null
  initials: string
  eyebrow: string
  preview: string
  timeLabel: string
  isUnread: boolean
  isAccent: boolean
}

const inboxTabs: { key: InboxFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'bookings', label: 'Bookings' },
  { key: 'waitlists', label: 'Waitlists' },
  { key: 'pros', label: 'Pros' },
]

function pickOne(value: string | string[] | undefined): string {
  if (!value) return ''
  return Array.isArray(value) ? value[0] ?? '' : value
}

function readFilter(sp: SearchParamsShape): InboxFilter {
  const raw = pickOne(sp.filter).trim().toLowerCase()

  if (raw === 'bookings') return 'bookings'
  if (raw === 'waitlists') return 'waitlists'
  if (raw === 'pros') return 'pros'

  return 'all'
}

function hrefForFilter(filter: InboxFilter): string {
  return filter === 'all' ? '/messages' : `/messages?filter=${filter}`
}

function isPresentString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function mapById<TItem extends { id: string }>(items: TItem[]): Map<string, TItem> {
  const map = new Map<string, TItem>()

  for (const item of items) {
    map.set(item.id, item)
  }

  return map
}

function classNames(values: (string | false | null | undefined)[]): string {
  const classes: string[] = []

  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      classes.push(value)
    }
  }

  return classes.join(' ')
}

function formatPersonName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string {
  return [firstName, lastName].filter(isPresentString).join(' ').trim()
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(isPresentString)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : ''

  return `${first}${last}`.toUpperCase() || '?'
}

function formatRelativeTime(date: Date): string {
  const diffMs = Math.max(0, Date.now() - date.getTime())
  const diffMinutes = Math.floor(diffMs / 60000)

  if (diffMinutes < 1) return 'now'
  if (diffMinutes < 60) return `${diffMinutes}m`

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d`

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(date)
}

function formatShortDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(date)
}

function formatBookingTime(date: Date | null | undefined): string | null {
  if (!date) return null

  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function formatMinuteOfDay(value: number | null): string | null {
  if (value === null) return null

  const minutesInDay = 24 * 60
  const safeValue = ((value % minutesInDay) + minutesInDay) % minutesInDay
  const hour24 = Math.floor(safeValue / 60)
  const minute = safeValue % 60
  const hour12 = hour24 % 12 || 12
  const suffix = hour24 < 12 ? 'AM' : 'PM'

  return `${hour12}:${minute.toString().padStart(2, '0')} ${suffix}`
}

function formatWaitlistStatus(status: WaitlistStatus): string {
  if (status === WaitlistStatus.ACTIVE) return 'POSITION ACTIVE'
  if (status === WaitlistStatus.NOTIFIED) return 'NOTIFIED'
  if (status === WaitlistStatus.BOOKED) return 'BOOKED'
  if (status === WaitlistStatus.CANCELLED) return 'CANCELLED'

  return 'WAITLIST'
}

function formatWaitlistTimeOfDay(value: WaitlistTimeOfDay | null): string | null {
  if (value === WaitlistTimeOfDay.MORNING) return 'Morning'
  if (value === WaitlistTimeOfDay.AFTERNOON) return 'Afternoon'
  if (value === WaitlistTimeOfDay.EVENING) return 'Evening'

  return null
}

function formatWaitlistPreference(waitlist: WaitlistLookup): string | null {
  if (waitlist.preferenceType === WaitlistPreferenceType.ANY_TIME) {
    return 'Any time'
  }

  if (waitlist.preferenceType === WaitlistPreferenceType.TIME_OF_DAY) {
    return formatWaitlistTimeOfDay(waitlist.timeOfDay)
  }

  if (
    waitlist.preferenceType === WaitlistPreferenceType.SPECIFIC_DATE &&
    waitlist.specificDate
  ) {
    return formatShortDate(waitlist.specificDate)
  }

  if (waitlist.preferenceType === WaitlistPreferenceType.TIME_RANGE) {
    const start = formatMinuteOfDay(waitlist.windowStartMin)
    const end = formatMinuteOfDay(waitlist.windowEndMin)

    return [start, end].filter(isPresentString).join('–') || null
  }

  return null
}

function previewText(value: string | null): string {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : 'Say hi…'
}

function isThreadUnread(thread: InboxThread): boolean {
  const lastMessageAt = thread.lastMessageAt

  if (!lastMessageAt) {
    return false
  }

  const lastReadAt = thread.participants[0]?.lastReadAt ?? null

  if (!lastReadAt) {
    return true
  }

  return lastReadAt.getTime() < lastMessageAt.getTime()
}

function buildEyebrow(params: {
  thread: InboxThread
  bookingMap: Map<string, BookingLookup>
  serviceMap: Map<string, ServiceLookup>
  offeringMap: Map<string, OfferingLookup>
  waitlistMap: Map<string, WaitlistLookup>
}): string {
  const { thread, bookingMap, serviceMap, offeringMap, waitlistMap } = params

  if (thread.contextType === MessageThreadContextType.BOOKING) {
    const booking = thread.bookingId ? bookingMap.get(thread.bookingId) ?? null : null
    const serviceName = booking?.service?.name ?? null
    const when = formatBookingTime(booking?.scheduledFor)

    return ['BOOKING CONFIRMED', serviceName, when]
      .filter(isPresentString)
      .join(' — ')
  }

  if (thread.contextType === MessageThreadContextType.WAITLIST) {
    const waitlist = thread.waitlistEntryId
      ? waitlistMap.get(thread.waitlistEntryId) ?? null
      : null

    if (!waitlist) {
      return 'WAITLIST'
    }

    const serviceName = waitlist.service?.name ?? null
    const status = formatWaitlistStatus(waitlist.status)
    const preference = formatWaitlistPreference(waitlist)

    return ['WAITLIST', status, serviceName, preference]
      .filter(isPresentString)
      .join(' — ')
  }

  if (thread.contextType === MessageThreadContextType.OFFERING) {
    const offering = thread.offeringId ? offeringMap.get(thread.offeringId) ?? null : null
    const name = offering?.title ?? offering?.service?.name ?? null

    return ['SERVICE', name].filter(isPresentString).join(' — ')
  }

  if (thread.contextType === MessageThreadContextType.SERVICE) {
    const service = thread.serviceId ? serviceMap.get(thread.serviceId) ?? null : null

    return ['SERVICE', service?.name].filter(isPresentString).join(' — ')
  }

  if (thread.contextType === MessageThreadContextType.PRO_PROFILE) {
    return 'PRO'
  }

  return 'MESSAGE'
}

function buildThreadPresentation(params: {
  thread: InboxThread
  viewerRole: Role
  bookingMap: Map<string, BookingLookup>
  serviceMap: Map<string, ServiceLookup>
  offeringMap: Map<string, OfferingLookup>
  waitlistMap: Map<string, WaitlistLookup>
}): ThreadPresentation {
  const {
    thread,
    viewerRole,
    bookingMap,
    serviceMap,
    offeringMap,
    waitlistMap,
  } = params

  const title =
    viewerRole === Role.PRO
      ? formatPersonName(thread.client?.firstName, thread.client?.lastName) ||
        'Client'
      : thread.professional?.businessName || 'Professional'

  const avatarUrl =
    viewerRole === Role.PRO
      ? thread.client?.avatarUrl ?? null
      : thread.professional?.avatarUrl ?? null

  const lastActivityAt = thread.lastMessageAt ?? thread.updatedAt
  const eyebrow = buildEyebrow({
    thread,
    bookingMap,
    serviceMap,
    offeringMap,
    waitlistMap,
  })

  return {
    title,
    avatarUrl,
    initials: initialsFromName(title),
    eyebrow,
    preview: previewText(thread.lastMessagePreview),
    timeLabel: formatRelativeTime(lastActivityAt),
    isUnread: isThreadUnread(thread),
    isAccent:
      thread.contextType === MessageThreadContextType.BOOKING ||
      thread.contextType === MessageThreadContextType.OFFERING ||
      thread.contextType === MessageThreadContextType.WAITLIST,
  }
}

function whereForInboxFilter(params: {
  userId: string
  filter: InboxFilter
}): Prisma.MessageThreadWhereInput {
  const { userId, filter } = params

  const where: Prisma.MessageThreadWhereInput = {
    participants: { some: { userId } },
    lastMessageAt: { not: null },
  }

  if (filter === 'bookings') {
    where.contextType = MessageThreadContextType.BOOKING
  }

  if (filter === 'waitlists') {
    where.contextType = MessageThreadContextType.WAITLIST
  }

  if (filter === 'pros') {
    where.contextType = {
      in: [
        MessageThreadContextType.PRO_PROFILE,
        MessageThreadContextType.SERVICE,
        MessageThreadContextType.OFFERING,
      ],
    }
  }

  return where
}

async function findInboxThreads(params: {
  userId: string
  filter: InboxFilter
}): Promise<InboxThread[]> {
  const threads: InboxThread[] = await prisma.messageThread.findMany({
    where: whereForInboxFilter(params),
    orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
    take: 60,
    select: {
      id: true,
      contextType: true,
      contextId: true,
      bookingId: true,
      serviceId: true,
      offeringId: true,
      waitlistEntryId: true,
      lastMessageAt: true,
      lastMessagePreview: true,
      updatedAt: true,
      client: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          avatarUrl: true,
        },
      },
      professional: {
        select: {
          id: true,
          businessName: true,
          avatarUrl: true,
        },
      },
      participants: {
        where: { userId: params.userId },
        select: { lastReadAt: true },
        take: 1,
      },
    },
  })

  return threads
}

async function findBookingLookups(bookingIds: string[]): Promise<BookingLookup[]> {
  if (bookingIds.length === 0) return []

  return await prisma.booking.findMany({
    where: { id: { in: bookingIds } },
    select: {
      id: true,
      scheduledFor: true,
      service: { select: { name: true } },
    },
  })
}

async function findServiceLookups(serviceIds: string[]): Promise<ServiceLookup[]> {
  if (serviceIds.length === 0) return []

  return await prisma.service.findMany({
    where: { id: { in: serviceIds } },
    select: {
      id: true,
      name: true,
    },
  })
}

async function findOfferingLookups(
  offeringIds: string[],
): Promise<OfferingLookup[]> {
  if (offeringIds.length === 0) return []

  return await prisma.professionalServiceOffering.findMany({
    where: { id: { in: offeringIds } },
    select: {
      id: true,
      title: true,
      service: { select: { name: true } },
    },
  })
}

async function findWaitlistLookups(
  waitlistEntryIds: string[],
): Promise<WaitlistLookup[]> {
  if (waitlistEntryIds.length === 0) return []

  return await prisma.waitlistEntry.findMany({
    where: { id: { in: waitlistEntryIds } },
    select: {
      id: true,
      status: true,
      preferenceType: true,
      specificDate: true,
      timeOfDay: true,
      windowStartMin: true,
      windowEndMin: true,
      service: { select: { name: true } },
    },
  })
}

export default async function MessagesInboxPage(props: PageProps) {
  const user = await getCurrentUser().catch(() => null)

  if (!user) {
    redirect('/login?from=/messages')
  }

  const sp = await Promise.resolve(props.searchParams ?? {})
  const activeFilter = readFilter(sp)

  const threads = await findInboxThreads({
    userId: user.id,
    filter: activeFilter,
  })

  const bookingIds = threads
    .map((thread) => thread.bookingId)
    .filter(isPresentString)

  const serviceIds = threads
    .map((thread) => thread.serviceId)
    .filter(isPresentString)

  const offeringIds = threads
    .map((thread) => thread.offeringId)
    .filter(isPresentString)

  const waitlistEntryIds = threads
    .map((thread) => thread.waitlistEntryId)
    .filter(isPresentString)

  const [bookingRows, serviceRows, offeringRows, waitlistRows] =
    await Promise.all([
      findBookingLookups(bookingIds),
      findServiceLookups(serviceIds),
      findOfferingLookups(offeringIds),
      findWaitlistLookups(waitlistEntryIds),
    ])

  const bookingMap = mapById(bookingRows)
  const serviceMap = mapById(serviceRows)
  const offeringMap = mapById(offeringRows)
  const waitlistMap = mapById(waitlistRows)

  return (
    <main className="min-h-screen bg-bgPrimary text-textPrimary">
      <section className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col px-6 pb-28 pt-16">
        <header>
          <h1 className="font-serif text-[38px] font-black italic leading-none tracking-[-0.04em]">
            Inbox
          </h1>

          <nav
            className="mt-5 flex items-end gap-5"
            aria-label="Inbox filters"
          >
            {inboxTabs.map((tab) => {
              const active = tab.key === activeFilter

              return (
              <Link
                key={tab.key}
                href={hrefForFilter(tab.key)}
                aria-current={active ? 'page' : undefined}
                className={classNames([
                  'inline-flex border-b-[3px] pb-2 text-[13px] font-black transition hover:text-textPrimary',
                  active
                    ? '[border-bottom-color:rgb(var(--accent-primary))] text-textPrimary'
                    : '[border-bottom-color:transparent] text-textSecondary',
                ])}
              >
                {tab.label}
              </Link>
              )
            })}
          </nav>
        </header>

        <div className="mt-7">
          {threads.length === 0 ? (
            <div className="rounded-[22px] border border-white/10 bg-bgSecondary/40 px-5 py-6">
              <div className="text-[14px] font-black">
                {activeFilter === 'waitlists'
                  ? 'No waitlist messages yet'
                  : 'No messages yet'}
              </div>

              <p className="mt-2 text-[13px] font-semibold leading-5 text-textSecondary">
                {activeFilter === 'waitlists'
                  ? 'Waitlist conversations will show here once a waitlist thread has message activity.'
                  : 'Once a message thread has activity, it will show up here.'}
              </p>

              <Link
                href="/looks"
                className="mt-5 inline-flex rounded-full border-terra px-5 py-3 text-[13px] font-black text-bgPrimary hover:border-terraHover"
              >
                Browse Looks
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-white/10 border-y border-white/10">
              {threads.map((thread) => {
                const item = buildThreadPresentation({
                  thread,
                  viewerRole: user.role,
                  bookingMap,
                  serviceMap,
                  offeringMap,
                  waitlistMap,
                })

                return (
                  <Link
                    key={thread.id}
                    href={`/messages/thread/${encodeURIComponent(thread.id)}`}
                    className="group grid grid-cols-[64px_1fr_auto] gap-4 py-4 transition hover:bg-bgSecondary/25"
                  >
                    <div className="relative h-16 w-16 overflow-hidden rounded-full bg-bgSecondary">
                      {item.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.avatarUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-white/10 bg-bgSecondary">
                          <div className="absolute inset-0 rotate-45 bg-bgPrimary/35" />
                          <div className="absolute inset-0 border-terra/10" />
                          <span className="relative text-[13px] font-black text-textPrimary">
                            {item.initials}
                          </span>
                        </div>
                      )}

                      {item.isUnread ? (
                        <span
                          aria-hidden="true"
                          className="absolute right-0 top-0 h-4 w-6 rounded-bl-full rounded-tr-full border-terra"
                        />
                      ) : null}
                    </div>

                    <div className="min-w-0 pt-0.5">
                      <div className="truncate text-[15px] font-black leading-5">
                        {item.title}
                      </div>

                      <div
                        className={classNames([
                          'mt-0.5 truncate text-[11px] font-black uppercase leading-4',
                          item.isAccent
                            ? 'text-accentPrimary'
                            : 'text-textSecondary',
                        ])}
                      >
                        {item.eyebrow}
                      </div>

                      <div
                        className={classNames([
                          'mt-0.5 truncate text-[13px] leading-5',
                          item.isUnread
                            ? 'font-black text-textPrimary'
                            : 'font-semibold text-textSecondary',
                        ])}
                      >
                        {item.preview}
                      </div>
                    </div>

                    <div className="pt-1 text-right text-[11px] font-semibold text-textSecondary">
                      {item.timeLabel}
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </section>
    </main>
  )
}