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
import RemoteImage from '@/app/_components/media/RemoteImage'
import EmptyState from '@/app/_components/boundaries/EmptyState'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { initialsForName } from '@/lib/initials'
import { formatPublicProfileDisplayName } from '@/lib/profiles/publicProfileFormatting'
import { labelForWaitlistStatus } from '@/lib/waitlist/statusLabel'

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
    userId: string | null
    firstName: string | null
    lastName: string | null
    avatarUrl: string | null
  } | null
  professional: {
    id: string
    userId: string
    businessName: string | null
    firstName: string
    lastName: string
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

// Older links land context params on /messages directly; hand them to
// /messages/start, which owns param-driven thread resolution.
function buildStartRedirectQuery(sp: SearchParamsShape): string | null {
  const contextType = pickOne(sp.contextType).trim()
  const contextId = pickOne(sp.contextId).trim()

  if (!contextType || !contextId) return null

  const query = new URLSearchParams()
  query.set('contextType', contextType)
  query.set('contextId', contextId)

  const professionalId = pickOne(sp.professionalId).trim()
  const clientId = pickOne(sp.clientId).trim()

  if (professionalId) query.set('professionalId', professionalId)
  if (clientId) query.set('clientId', clientId)

  return query.toString()
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

// Deterministic brand-gradient fallback for avatars without a photo. Pairs are drawn from
// existing brand tokens (no hardcoded hex) and picked by a stable hash of the thread id, so a
// given thread always gets the same gradient. Purely visual — not derived from any live data.
const AVATAR_GRADIENTS: ReadonlyArray<readonly [string, string]> = [
  ['--accent-primary', '--iris'],
  ['--peacock-blue', '--accent-primary'],
  ['--iris', '--peacock-blue'],
  ['--amber', '--fern'],
]

function avatarGradientStyle(seed: string): { background: string } {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  }
  const fallback: readonly [string, string] = ['--accent-primary', '--iris']
  const [from, to] = AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length] ?? fallback
  return {
    background: `radial-gradient(130% 120% at 32% 20%, rgb(var(${from})), rgb(var(${to})))`,
  }
}

function formatPersonName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string {
  return [firstName, lastName].filter(isPresentString).join(' ').trim()
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
      return 'Waitlist'
    }

    const serviceName = waitlist.service?.name ?? null
    const status = labelForWaitlistStatus(waitlist.status)
    const preference = formatWaitlistPreference(waitlist)

    return ['Waitlist', status, serviceName, preference]
      .filter(isPresentString)
      .join(' — ')
  }

  if (thread.contextType === MessageThreadContextType.OFFERING) {
    const offering = thread.offeringId ? offeringMap.get(thread.offeringId) ?? null : null
    const name = offering?.title ?? offering?.service?.name ?? null

    return ['Service', name].filter(isPresentString).join(' — ')
  }

  if (thread.contextType === MessageThreadContextType.SERVICE) {
    const service = thread.serviceId ? serviceMap.get(thread.serviceId) ?? null : null

    return ['Service', service?.name].filter(isPresentString).join(' — ')
  }

  if (thread.contextType === MessageThreadContextType.PRO_PROFILE) {
    return 'Pro'
  }

  return 'Message'
}

function buildThreadPresentation(params: {
  thread: InboxThread
  viewerUserId: string
  bookingMap: Map<string, BookingLookup>
  serviceMap: Map<string, ServiceLookup>
  offeringMap: Map<string, OfferingLookup>
  waitlistMap: Map<string, WaitlistLookup>
}): ThreadPresentation {
  const {
    thread,
    viewerUserId,
    bookingMap,
    serviceMap,
    offeringMap,
    waitlistMap,
  } = params

  // Counterparty = the participant the viewer is NOT. Derive it from the
  // viewer's user id rather than their acting role, so a dual-role user (a pro
  // who also messages as a client via workspace switch) and admins always see
  // the other party — never their own name.
  const viewerIsThreadPro =
    thread.professional?.userId != null &&
    thread.professional.userId === viewerUserId

  const title = viewerIsThreadPro
    ? formatPersonName(thread.client?.firstName, thread.client?.lastName) ||
      'Client'
    : formatPublicProfileDisplayName({
        businessName: thread.professional?.businessName,
        firstName: thread.professional?.firstName,
        lastName: thread.professional?.lastName,
        fallback: 'Professional',
      })

  const avatarUrl = viewerIsThreadPro
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
    initials: initialsForName(title, '?'),
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
          userId: true,
          firstName: true,
          lastName: true,
          avatarUrl: true,
        },
      },
      professional: {
        select: {
          id: true,
          userId: true,
          businessName: true,
          firstName: true,
          lastName: true,
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

  const startQuery = buildStartRedirectQuery(sp)

  if (startQuery) {
    redirect(`/messages/start?${startQuery}`)
  }

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

  const viewerLabel = user.role === Role.PRO ? 'Pro' : 'Client'

  return (
    <main className="relative min-h-screen overflow-hidden bg-bgPrimary text-textPrimary">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[200px] bg-[linear-gradient(180deg,rgb(var(--accent-primary)/0.12),transparent)]"
      />
      <section className="relative mx-auto flex min-h-screen w-full max-w-none flex-col px-[22px] pb-28 pt-16 md:max-w-[480px] md:px-[34px] lg:max-w-[500px] lg:px-[40px]">
        <header>
          <div className="flex items-center justify-between">
            <h1 className="font-display text-[38px] font-bold italic leading-none tracking-[-0.04em] md:text-[42px] lg:text-[46px]">
              Inbox
            </h1>
            <span className="rounded-full border border-textPrimary/15 px-[11px] py-[6px] font-mono text-[10px] uppercase tracking-[0.14em] text-textMuted">
              {viewerLabel}
            </span>
          </div>

          <nav
            className="mt-[22px] flex items-end gap-[22px]"
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
                  'inline-flex border-b-[3px] pb-[9px] font-display text-[13px] font-bold transition hover:text-textPrimary',
                  active
                    ? '[border-bottom-color:rgb(var(--accent-primary))] text-textPrimary'
                    : '[border-bottom-color:transparent] text-textMuted',
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
            <EmptyState
              title={
                activeFilter === 'waitlists'
                  ? 'No waitlist messages yet'
                  : 'No messages yet'
              }
              description={
                activeFilter === 'waitlists'
                  ? 'Waitlist conversations will show here once a waitlist thread has message activity.'
                  : 'Once a message thread has activity, it will show up here.'
              }
              action={{ label: 'Browse Looks', href: '/looks' }}
            />
          ) : (
            <div className="border-t border-textPrimary/10">
              {threads.map((thread) => {
                const item = buildThreadPresentation({
                  thread,
                  viewerUserId: user.id,
                  bookingMap,
                  serviceMap,
                  offeringMap,
                  waitlistMap,
                })

                return (
                  <Link
                    key={thread.id}
                    href={`/messages/thread/${encodeURIComponent(thread.id)}`}
                    className="group grid grid-cols-[60px_1fr_auto] gap-[15px] border-b border-textPrimary/10 py-4 transition hover:bg-bgSecondary/25"
                  >
                    <div className="relative h-[60px] w-[60px]">
                      {item.avatarUrl ? (
                        <RemoteImage
                          src={item.avatarUrl ?? ''}
                          alt=""
                          className="h-[60px] w-[60px] rounded-full object-cover"
                          width={60}
                          height={60}
                        />
                      ) : (
                        <div
                          className="grid h-[60px] w-[60px] place-items-center rounded-full font-display text-[16px] font-bold text-onAccent"
                          style={avatarGradientStyle(thread.id)}
                        >
                          {item.initials}
                        </div>
                      )}

                      {item.isUnread ? (
                        <span
                          aria-hidden="true"
                          className="absolute right-px top-px h-[14px] w-[14px] rounded-full bg-accentPrimary ring-[2.5px] ring-bgPrimary"
                        />
                      ) : null}
                    </div>

                    <div className="min-w-0 pt-[2px]">
                      <div className="truncate font-display text-[15.5px] font-bold leading-5 tracking-[-0.01em]">
                        {item.title}
                      </div>

                      <div
                        className={classNames([
                          'mt-[3px] truncate font-mono text-[9.5px] font-bold uppercase leading-4 tracking-[0.06em]',
                          item.isAccent
                            ? 'text-accentPrimary'
                            : 'text-textMuted',
                        ])}
                      >
                        {item.eyebrow}
                      </div>

                      <div
                        className={classNames([
                          'mt-1 truncate text-[13px] leading-[1.35]',
                          item.isUnread
                            ? 'font-bold text-textPrimary'
                            : 'font-medium text-textMuted',
                        ])}
                      >
                        {item.preview}
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-[7px] pt-[3px]">
                      <span className="whitespace-nowrap font-mono text-[10.5px] text-textMuted">
                        {item.timeLabel}
                      </span>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}

          {activeFilter === 'waitlists' && threads.length > 0 ? (
            <div className="mt-[18px] text-center font-mono text-[10px] uppercase tracking-[0.1em] text-textMuted">
              Waitlist threads appear the moment a client joins
            </div>
          ) : null}
        </div>
      </section>
    </main>
  )
}