// app/messages/thread/[id]/page.tsx
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  MediaType,
  MessageThreadContextType,
} from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { liveChannelForUser } from '@/lib/live/broadcast'
import { assertProCanViewClient } from '@/lib/clientVisibility'
import { resolveThreadCounterparty } from '@/lib/messages/counterparty'
import { THREAD_MESSAGE_PAGE_SIZE, nextOlderCursor } from '@/lib/messages/paging'
import {
  MESSAGE_ATTACHMENT_BUCKET,
  signMessageAttachmentUrls,
} from '@/lib/messages/attachments'
import { labelForWaitlistStatus } from '@/lib/waitlist/statusLabel'
import { formatWaitlistPreferenceLabel } from '@/lib/waitlist/preferenceLabel'
import { DEFAULT_TIME_ZONE, formatInTimeZone, pickTimeZoneOrNull } from '@/lib/time'
import ThreadClient from './ThreadClient'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: { id: string } | Promise<{ id: string }>
}

type InitialMessageAttachment = {
  id: string
  url: string
  mediaType: 'IMAGE' | 'VIDEO'
}

type InitialMessage = {
  id: string
  body: string | null
  createdAt: string
  senderUserId: string
  attachments: InitialMessageAttachment[]
}

type ContextMeta = {
  line: string
  href: string | null
  cta: string | null
}

function isPresentString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function joinParts(parts: (string | null | undefined)[]): string {
  return parts.filter(isPresentString).join(' · ')
}

function formatDayTime(date: Date, timeZone: string): string {
  return formatInTimeZone(date, timeZone, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function toInitialMessageMediaType(mediaType: MediaType): InitialMessageAttachment['mediaType'] {
  if (mediaType === MediaType.VIDEO) return 'VIDEO'
  return 'IMAGE'
}

async function buildContextMeta(thread: {
  contextType: MessageThreadContextType
  contextId: string
  bookingId: string | null
  serviceId: string | null
  offeringId: string | null
  waitlistEntryId: string | null
}): Promise<ContextMeta> {
  if (thread.contextType === MessageThreadContextType.BOOKING && thread.bookingId) {
    const booking = await prisma.booking.findUnique({
      where: { id: thread.bookingId },
      select: {
        id: true,
        scheduledFor: true,
        locationTimeZone: true,
        location: { select: { timeZone: true } },
        service: { select: { name: true } },
      },
    })

    const bookingTz =
      pickTimeZoneOrNull(booking?.locationTimeZone) ??
      pickTimeZoneOrNull(booking?.location?.timeZone) ??
      DEFAULT_TIME_ZONE
    const when = booking?.scheduledFor ? formatDayTime(booking.scheduledFor, bookingTz) : null
    const serviceName = booking?.service?.name ?? null

    return {
      line: joinParts(['Booking', serviceName, when]) || 'Booking',
      href: `/booking/${encodeURIComponent(thread.bookingId)}`,
      cta: 'View booking',
    }
  }

  if (thread.contextType === MessageThreadContextType.WAITLIST && thread.waitlistEntryId) {
    const waitlist = await prisma.waitlistEntry.findUnique({
      where: { id: thread.waitlistEntryId },
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

    if (!waitlist) {
      return {
        line: 'Waitlist',
        href: null,
        cta: null,
      }
    }

    const status = labelForWaitlistStatus(waitlist.status)
    const preference = formatWaitlistPreferenceLabel({
      preferenceType: waitlist.preferenceType,
      specificDate: waitlist.specificDate,
      timeOfDay: waitlist.timeOfDay,
      windowStartMin: waitlist.windowStartMin,
      windowEndMin: waitlist.windowEndMin,
    })

    return {
      line: joinParts(['Waitlist', status, waitlist.service?.name, preference]) || 'Waitlist',
      href: null,
      cta: null,
    }
  }

  if (thread.contextType === MessageThreadContextType.SERVICE && thread.serviceId) {
    const service = await prisma.service.findUnique({
      where: { id: thread.serviceId },
      select: { id: true, name: true },
    })

    return {
      line: joinParts(['Service', service?.name]) || 'Service',
      href: null,
      cta: null,
    }
  }

  if (thread.contextType === MessageThreadContextType.OFFERING && thread.offeringId) {
    const offering = await prisma.professionalServiceOffering.findUnique({
      where: { id: thread.offeringId },
      select: {
        id: true,
        title: true,
        service: { select: { name: true } },
      },
    })

    return {
      line: joinParts(['Offering', offering?.title ?? offering?.service?.name]) || 'Offering',
      href: null,
      cta: null,
    }
  }

  if (thread.contextType === MessageThreadContextType.PRO_PROFILE) {
    const href = thread.contextId
      ? `/professionals/${encodeURIComponent(thread.contextId)}`
      : null

    return {
      line: 'Profile',
      href,
      cta: href ? 'View profile' : null,
    }
  }

  return {
    line: 'Messages',
    href: null,
    cta: null,
  }
}

export default async function MessageThreadPage(props: PageProps) {
  const user = await getCurrentUser().catch(() => null)

  if (!user) {
    redirect('/login?from=/messages')
  }

  const { id } = await Promise.resolve(props.params)

  if (!id) {
    notFound()
  }

  const thread = await prisma.messageThread.findUnique({
    where: { id },
    select: {
      id: true,
      contextType: true,
      contextId: true,
      bookingId: true,
      serviceId: true,
      offeringId: true,
      waitlistEntryId: true,
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
        select: { userId: true, lastReadAt: true },
      },
    },
  })

  if (!thread) {
    notFound()
  }

  if (!thread.participants.some((p) => p.userId === user.id)) {
    notFound()
  }

  // Load the LATEST page (newest → oldest), then reverse to ascending for
  // display. `initialNextCursor` points at the oldest of this page so
  // ThreadClient can page backwards ("load earlier") from the same boundary the
  // GET route uses; null when the whole history fit in one page.
  const messageRowsDesc = await prisma.message.findMany({
    where: { threadId: thread.id },
    orderBy: { createdAt: 'desc' },
    take: THREAD_MESSAGE_PAGE_SIZE,
    select: {
      id: true,
      body: true,
      createdAt: true,
      senderUserId: true,
      attachments: {
        select: {
          id: true,
          url: true,
          mediaType: true,
          storageBucket: true,
          storagePath: true,
        },
      },
    },
  })

  const messageRows = messageRowsDesc.slice().reverse()
  const initialNextCursor = nextOlderCursor(
    messageRowsDesc.map((m) => m.id),
    THREAD_MESSAGE_PAGE_SIZE,
  )
  const initialHasMore = Boolean(initialNextCursor)

  // Sign every private attachment across the page in one batch (same treatment
  // as the GET route); drop any that can't be signed rather than render broken.
  const signedAttachmentUrls = await signMessageAttachmentUrls(
    messageRows
      .flatMap((m) => m.attachments)
      .filter(
        (a) => a.storageBucket === MESSAGE_ATTACHMENT_BUCKET && a.storagePath,
      )
      .map((a) => a.storagePath as string),
  )

  function resolveAttachmentUrl(attachment: {
    url: string | null
    storageBucket: string | null
    storagePath: string | null
  }): string | null {
    if (attachment.storageBucket === MESSAGE_ATTACHMENT_BUCKET && attachment.storagePath) {
      return signedAttachmentUrls.get(attachment.storagePath) ?? null
    }
    return attachment.url
  }

  const initialMessages: InitialMessage[] = messageRows.map((message) => ({
    id: message.id,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
    senderUserId: message.senderUserId,
    attachments: message.attachments.flatMap((attachment) => {
      const url = resolveAttachmentUrl(attachment)
      if (!url) return []
      return [
        {
          id: attachment.id,
          url,
          mediaType: toInitialMessageMediaType(attachment.mediaType),
        },
      ]
    }),
  }))

  // Counterparty = the participant the viewer is NOT, derived from the viewer's
  // user id (not their acting role) so dual-role users and admins never see
  // their own name as the thread title.
  const viewerIsThreadPro =
    thread.professional?.userId != null &&
    thread.professional.userId === user.id

  const { title } = resolveThreadCounterparty({
    viewerIsThreadPro,
    client: thread.client,
    professional: thread.professional,
  })

  // Seed the sender's read receipt so it doesn't flash in on the first poll.
  const initialCounterpartyLastReadAt =
    thread.participants.find((p) => p.userId !== user.id)?.lastReadAt?.toISOString() ??
    null

  // When the pro is viewing, offer a jump into the client's chart (the pro-only
  // record), but only when the visibility SSOT actually grants access — so the
  // link never lands on a denied page.
  const clientChartHref =
    viewerIsThreadPro && thread.professional?.id && thread.client?.id
      ? (await assertProCanViewClient(thread.professional.id, thread.client.id))
          .ok
        ? `/pro/clients/${encodeURIComponent(thread.client.id)}`
        : null
      : null

  const contextMeta = await buildContextMeta({
    contextType: thread.contextType,
    contextId: thread.contextId,
    bookingId: thread.bookingId,
    serviceId: thread.serviceId,
    offeringId: thread.offeringId,
    waitlistEntryId: thread.waitlistEntryId,
  })

  return (
    <main className="relative min-h-screen overflow-hidden bg-bgPrimary text-textPrimary">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[180px] bg-[linear-gradient(180deg,rgb(var(--accent-primary)/0.12),transparent)]"
      />
      <section className="relative mx-auto flex min-h-screen w-full max-w-none flex-col px-[22px] pb-28 pt-12 md:max-w-[520px] md:px-[30px] lg:max-w-[540px] lg:px-[36px]">
        <header className="flex items-start justify-between gap-[14px]">
          <div className="min-w-0">
            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-textMuted">
              {contextMeta.line}
            </div>

            <h1 className="mt-[9px] truncate font-display text-[24px] font-bold leading-[1.05] tracking-[-0.02em] md:text-[26px] lg:text-[28px]">
              {title}
            </h1>

            {contextMeta.href && contextMeta.cta ? (
              <div className="mt-2">
                <Link
                  href={contextMeta.href}
                  className="font-display text-[12px] font-semibold text-accentPrimary hover:opacity-80"
                >
                  {contextMeta.cta} →
                </Link>
              </div>
            ) : null}

            {clientChartHref ? (
              <div className="mt-2">
                <Link
                  href={clientChartHref}
                  className="font-display text-[12px] font-semibold text-accentPrimary hover:opacity-80"
                >
                  View client chart →
                </Link>
              </div>
            ) : null}
          </div>

          <Link
            href="/messages"
            className="shrink-0 font-display text-[12px] font-semibold text-textMuted hover:text-textPrimary"
          >
            ← Inbox
          </Link>
        </header>

        <ThreadClient
          threadId={thread.id}
          myUserId={user.id}
          liveChannel={liveChannelForUser(user.id)}
          initialMessages={initialMessages}
          initialCounterpartyLastReadAt={initialCounterpartyLastReadAt}
          initialNextCursor={initialNextCursor}
          initialHasMore={initialHasMore}
        />
      </section>
    </main>
  )
}