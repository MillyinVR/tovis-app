// app/messages/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { MessageThreadContextType, Role } from '@prisma/client'
import RemoteImage from '@/app/_components/media/RemoteImage'
import EmptyState from '@/app/_components/boundaries/EmptyState'
import { LiveRefresh } from '@/app/_components/live/LiveRefresh'
import { RefreshOnFocus } from '@/app/_components/live/RefreshOnFocus'
import { liveChannelForUser } from '@/lib/live/broadcast'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { formatRelativeTimeCompact } from '@/lib/time'
import { initialsForName } from '@/lib/initials'
import { resolveThreadCounterparty } from '@/lib/messages/counterparty'
import {
  INBOX_THREADS_PAGE_SIZE,
  parseInboxFilter,
  resolveInboxEyebrows,
  whereForInboxFilter,
  type InboxEyebrow,
  type InboxFilter,
} from '@/lib/messages/inboxContext'

export const dynamic = 'force-dynamic'

type SearchParamsShape = Record<string, string | string[] | undefined>

type PageProps = {
  searchParams?: SearchParamsShape | Promise<SearchParamsShape>
}

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

function hrefForFilter(filter: InboxFilter): string {
  return filter === 'all' ? '/messages' : `/messages?filter=${filter}`
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

function buildThreadPresentation(params: {
  thread: InboxThread
  viewerUserId: string
  eyebrow: InboxEyebrow
}): ThreadPresentation {
  const { thread, viewerUserId, eyebrow } = params

  // Counterparty = the participant the viewer is NOT. Derive it from the
  // viewer's user id rather than their acting role, so a dual-role user (a pro
  // who also messages as a client via workspace switch) and admins always see
  // the other party — never their own name.
  const viewerIsThreadPro =
    thread.professional?.userId != null &&
    thread.professional.userId === viewerUserId

  const { title, avatarUrl } = resolveThreadCounterparty({
    viewerIsThreadPro,
    client: thread.client,
    professional: thread.professional,
  })

  const lastActivityAt = thread.lastMessageAt ?? thread.updatedAt

  return {
    title,
    avatarUrl,
    initials: initialsForName(title, '?'),
    eyebrow: eyebrow.eyebrow,
    preview: previewText(thread.lastMessagePreview),
    timeLabel: formatRelativeTimeCompact(lastActivityAt),
    isUnread: isThreadUnread(thread),
    isAccent: eyebrow.isAccentContext,
  }
}

async function findInboxThreads(params: {
  userId: string
  filter: InboxFilter
}): Promise<InboxThread[]> {
  const threads: InboxThread[] = await prisma.messageThread.findMany({
    where: whereForInboxFilter(params),
    orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
    take: INBOX_THREADS_PAGE_SIZE,
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

  const activeFilter = parseInboxFilter(pickOne(sp.filter))

  const threads = await findInboxThreads({
    userId: user.id,
    filter: activeFilter,
  })

  const eyebrowById = await resolveInboxEyebrows(threads)

  const viewerLabel = user.role === Role.PRO ? 'Pro' : 'Client'

  // Live-sync: this route sits outside the pro/client layouts (which mount
  // LiveRefresh), so mount it here — the send route pings this user's channel,
  // and router.refresh() re-runs the loader to slot the new thread/preview in.
  const liveChannel = liveChannelForUser(user.id)

  return (
    <main className="relative min-h-screen overflow-hidden bg-bgPrimary text-textPrimary">
      <RefreshOnFocus />
      {liveChannel ? <LiveRefresh channels={[liveChannel]} /> : null}
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
                  eyebrow: eyebrowById.get(thread.id) ?? {
                    eyebrow: 'Message',
                    isAccentContext: false,
                  },
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