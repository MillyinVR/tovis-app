// app/messages/thread/[id]/page.tsx
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import ThreadClient from './ThreadClient'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: { id: string } | Promise<{ id: string }>
}

function upper(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

function fmtDayTime(d: Date) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}

export default async function MessageThreadPage(props: PageProps) {
  const user = await getCurrentUser().catch(() => null)
  if (!user) redirect('/login?from=/messages')

  const { id } = await Promise.resolve(props.params)
  if (!id) notFound()

  const thread = await prisma.messageThread.findUnique({
    where: { id },
    select: {
      id: true,
      contextType: true,
      contextId: true,
      bookingId: true,
      serviceId: true,
      offeringId: true,
      client: { select: { firstName: true, lastName: true, avatarUrl: true } },
      professional: { select: { businessName: true, avatarUrl: true } },
      participants: { where: { userId: user.id }, select: { userId: true }, take: 1 },
    },
  })

  if (!thread) notFound()
  if (!thread.participants.length) notFound()

  const initialMessages = await prisma.message.findMany({
    where: { threadId: id },
    orderBy: { createdAt: 'asc' },
    take: 60,
    select: {
      id: true,
      body: true,
      createdAt: true,
      senderUserId: true,
      attachments: { select: { id: true, url: true, mediaType: true } },
    },
  })

  const viewerRole = user.role
  const title =
    viewerRole === 'PRO'
      ? `${thread.client?.firstName || ''} ${thread.client?.lastName || ''}`.trim() || 'Client'
      : thread.professional?.businessName || 'Professional'

  // Context line + action link
  const ctx = upper(thread.contextType)
  let contextLine = 'Messages'
  let contextHref: string | null = null
  let contextCta: string | null = null

  if (ctx === 'BOOKING' && thread.bookingId) {
    const b = await prisma.booking.findUnique({
      where: { id: thread.bookingId },
      select: { id: true, scheduledFor: true, service: { select: { name: true } } },
    })
    const when = b?.scheduledFor ? fmtDayTime(new Date(b.scheduledFor)) : null
    const svc = b?.service?.name || null
    contextLine = ['Booking', svc, when].filter(Boolean).join(' · ')
    contextHref = `/booking/${encodeURIComponent(thread.bookingId)}`
    contextCta = 'View booking'
  } else if (ctx === 'SERVICE' && thread.serviceId) {
    const s = await prisma.service.findUnique({ where: { id: thread.serviceId }, select: { id: true, name: true } })
    contextLine = ['Service', s?.name].filter(Boolean).join(' · ')
    // If you have a service page route, use it. If not, we keep it null for now.
    // contextHref = `/services/${encodeURIComponent(thread.serviceId)}`
    contextHref = null
    contextCta = null
  } else if (ctx === 'OFFERING' && thread.offeringId) {
    const o = await prisma.professionalServiceOffering.findUnique({
      where: { id: thread.offeringId },
      select: { id: true, title: true, service: { select: { name: true } } },
    })
    contextLine = ['Offering', o?.title || o?.service?.name].filter(Boolean).join(' · ')
    // If you have an offering route, wire it here.
    contextHref = null
    contextCta = null
  } else if (ctx === 'PRO_PROFILE') {
    contextLine = 'Profile'
    contextHref = thread.contextId ? `/professionals/${encodeURIComponent(thread.contextId)}` : null
    contextCta = contextHref ? 'View profile' : null
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 text-textPrimary">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px] font-black text-textSecondary">{contextLine}</div>
          <h1 className="mt-1 truncate text-xl font-black">{title}</h1>

          {contextHref && contextCta ? (
            <div className="mt-2">
              <Link href={contextHref} className="text-[12px] font-black text-textPrimary hover:opacity-80">
                {contextCta} →
              </Link>
            </div>
          ) : null}
        </div>

        <Link href="/messages" className="text-[12px] font-black hover:opacity-80">
          ← Inbox
        </Link>
      </div>

      <ThreadClient threadId={id} myUserId={user.id} initialMessages={initialMessages as any} />
    </main>
  )
}
