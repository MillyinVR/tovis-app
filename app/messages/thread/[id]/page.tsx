// app/messages/thread/[id]/page.tsx
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  MediaType,
  MessageThreadContextType,
  Role,
  WaitlistPreferenceType,
  WaitlistStatus,
  WaitlistTimeOfDay,
} from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
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

function formatPersonName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string {
  return [firstName, lastName].filter(isPresentString).join(' ').trim()
}

function formatDayTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function formatShortDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
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
  if (status === WaitlistStatus.ACTIVE) return 'Position active'
  if (status === WaitlistStatus.NOTIFIED) return 'Notified'
  if (status === WaitlistStatus.BOOKED) return 'Booked'
  if (status === WaitlistStatus.CANCELLED) return 'Cancelled'

  return 'Waitlist'
}

function formatWaitlistTimeOfDay(value: WaitlistTimeOfDay | null): string | null {
  if (value === WaitlistTimeOfDay.MORNING) return 'Morning'
  if (value === WaitlistTimeOfDay.AFTERNOON) return 'Afternoon'
  if (value === WaitlistTimeOfDay.EVENING) return 'Evening'

  return null
}

function formatWaitlistPreference(params: {
  preferenceType: WaitlistPreferenceType
  specificDate: Date | null
  timeOfDay: WaitlistTimeOfDay | null
  windowStartMin: number | null
  windowEndMin: number | null
}): string | null {
  if (params.preferenceType === WaitlistPreferenceType.ANY_TIME) {
    return 'Any time'
  }

  if (params.preferenceType === WaitlistPreferenceType.TIME_OF_DAY) {
    return formatWaitlistTimeOfDay(params.timeOfDay)
  }

  if (
    params.preferenceType === WaitlistPreferenceType.SPECIFIC_DATE &&
    params.specificDate
  ) {
    return formatShortDate(params.specificDate)
  }

  if (params.preferenceType === WaitlistPreferenceType.TIME_RANGE) {
    const start = formatMinuteOfDay(params.windowStartMin)
    const end = formatMinuteOfDay(params.windowEndMin)

    return joinParts([start, end])
  }

  return null
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
        service: { select: { name: true } },
      },
    })

    const when = booking?.scheduledFor ? formatDayTime(booking.scheduledFor) : null
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

    const status = formatWaitlistStatus(waitlist.status)
    const preference = formatWaitlistPreference({
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
          firstName: true,
          lastName: true,
          avatarUrl: true,
        },
      },
      professional: {
        select: {
          businessName: true,
          avatarUrl: true,
        },
      },
      participants: {
        where: { userId: user.id },
        select: { userId: true },
        take: 1,
      },
    },
  })

  if (!thread) {
    notFound()
  }

  if (thread.participants.length === 0) {
    notFound()
  }

  const messageRows = await prisma.message.findMany({
    where: { threadId: thread.id },
    orderBy: { createdAt: 'asc' },
    take: 60,
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
        },
      },
    },
  })

  const initialMessages: InitialMessage[] = messageRows.map((message) => ({
    id: message.id,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
    senderUserId: message.senderUserId,
    attachments: message.attachments.map((attachment) => ({
      id: attachment.id,
      url: attachment.url,
      mediaType: toInitialMessageMediaType(attachment.mediaType),
    })),
  }))

  const title =
    user.role === Role.PRO
      ? formatPersonName(thread.client?.firstName, thread.client?.lastName) || 'Client'
      : thread.professional?.businessName || 'Professional'

  const contextMeta = await buildContextMeta({
    contextType: thread.contextType,
    contextId: thread.contextId,
    bookingId: thread.bookingId,
    serviceId: thread.serviceId,
    offeringId: thread.offeringId,
    waitlistEntryId: thread.waitlistEntryId,
  })

  return (
    <main className="min-h-screen bg-bgPrimary text-textPrimary">
      <section className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col px-6 pb-28 pt-12">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-black uppercase tracking-[0.12em] text-textSecondary">
              {contextMeta.line}
            </div>

            <h1 className="mt-2 truncate text-[24px] font-black leading-tight">
              {title}
            </h1>

            {contextMeta.href && contextMeta.cta ? (
              <div className="mt-2">
                <Link
                  href={contextMeta.href}
                  className="text-[12px] font-black text-textPrimary hover:opacity-80"
                >
                  {contextMeta.cta} →
                </Link>
              </div>
            ) : null}
          </div>

          <Link
            href="/messages"
            className="shrink-0 text-[12px] font-black text-textSecondary hover:text-textPrimary"
          >
            ← Inbox
          </Link>
        </header>

        <ThreadClient
          threadId={thread.id}
          myUserId={user.id}
          initialMessages={initialMessages}
        />
      </section>
    </main>
  )
}