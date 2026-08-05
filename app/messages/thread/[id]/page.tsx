// app/messages/thread/[id]/page.tsx
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { MediaType } from '@prisma/client'
import ProfileIdentityLink from '@/app/_components/ProfileIdentityLink'
import { Avatar } from '@/app/_components/ui'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { liveChannelForUser } from '@/lib/live/broadcast'
import { getProClientVisibility } from '@/lib/clientVisibility'
import { resolveThreadContextNav } from '@/lib/messages/contextNav'
import { resolveThreadCounterparty } from '@/lib/messages/counterparty'
import {
  CLIENT_LINK_SELECT,
  clientIdentityHref,
  clientLinkTarget,
  proClientChartHref,
} from '@/lib/profiles/profileHrefs'
import { proPublicProfilePath } from '@/lib/routes'
import { THREAD_MESSAGE_PAGE_SIZE, nextOlderCursor } from '@/lib/messages/paging'
import {
  MESSAGE_ATTACHMENT_BUCKET,
  signMessageAttachmentUrls,
} from '@/lib/messages/attachments'
import { resolveInboxEyebrow } from '@/lib/messages/inboxContext'
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

function toInitialMessageMediaType(mediaType: MediaType): InitialMessageAttachment['mediaType'] {
  if (mediaType === MediaType.VIDEO) return 'VIDEO'
  return 'IMAGE'
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
          ...CLIENT_LINK_SELECT,
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
          handle: true,
          nameDisplay: true,
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

  const { title, avatarUrl } = resolveThreadCounterparty({
    viewerIsThreadPro,
    client: thread.client,
    professional: thread.professional,
  })

  // The counterparty's name/avatar tap through to their profile in BOTH
  // directions now. Viewer is the client → the pro's public profile (#829).
  // Viewer is the pro → the client's chart when they may open it, else the
  // client's public /u/[handle] page, else nothing (THE one rule).
  //
  // The chart link below is a separate, labelled affordance — it stays, because
  // it is the one that can also say "Request chart access". This is the
  // identity tap-through that #829 deliberately left for a follow-up.
  const counterpartyProId = viewerIsThreadPro
    ? null
    : thread.professional?.id ?? null

  // Seed the sender's read receipt so it doesn't flash in on the first poll.
  const initialCounterpartyLastReadAt =
    thread.participants.find((p) => p.userId !== user.id)?.lastReadAt?.toISOString() ??
    null

  // When the pro is viewing, offer a jump into the client's chart (the pro-only
  // record).
  //
  // W5 follow-up: this used to render NOTHING whenever the chart was refused —
  // which is precisely the state a pro needs a way out of. They are mid-thread
  // with someone whose record they cannot open, and the one surface that could
  // have offered "ask them" showed a blank space instead. That is what "the pros
  // don't have a request chart access button in the messages" was.
  //
  // The chart page now answers the CONTACT_ONLY tier with an honest refusal and
  // a Request access button, so the link is offered for BOTH tiers and only the
  // label changes. A pro with no relationship still gets nothing.
  //
  // One visibility read powers BOTH this labelled chart link and the header's
  // identity tap-through below — they answer different questions off the same
  // fact, and a second query could only make them disagree.
  const proClientVisibility =
    viewerIsThreadPro && thread.professional?.id && thread.client?.id
      ? await getProClientVisibility(thread.professional.id, thread.client.id)
      : null

  const clientChartLink = (() => {
    if (!proClientVisibility || !thread.client?.id) return null

    const href = proClientChartHref(thread.client.id)

    if (proClientVisibility.canViewClient) {
      return { href, label: 'View client chart →' }
    }
    if (proClientVisibility.canContactClient) {
      return { href, label: 'Request chart access →' }
    }
    return null
  })()

  // ONE href for the header, whichever way round the thread is: the pro's public
  // profile when the viewer is the client (#829), and the client's chart — or,
  // when that is closed, their public page — when the viewer is the pro (this
  // change). Either may be null, and null renders the name as plain text.
  const counterpartyHref = viewerIsThreadPro
    ? clientIdentityHref(
        clientLinkTarget(thread.client),
        proClientVisibility?.canViewClient === true,
      )
    : proPublicProfilePath(counterpartyProId)

  // Header eyebrow uses the SAME resolver as the inbox rows so the label a user
  // tapped never changes shape once the thread opens. Navigation (deep link into
  // the booking / pro profile) is a separate, thread-page-only affordance —
  // viewer-dependent, so it takes `viewerIsThreadPro` (see resolveThreadContextNav).
  const contextEyebrow = await resolveInboxEyebrow({
    id: thread.id,
    contextType: thread.contextType,
    bookingId: thread.bookingId,
    serviceId: thread.serviceId,
    offeringId: thread.offeringId,
    waitlistEntryId: thread.waitlistEntryId,
  })
  const contextNavMeta = resolveThreadContextNav({
    contextType: thread.contextType,
    contextId: thread.contextId,
    bookingId: thread.bookingId,
    viewerIsThreadPro,
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
              {contextEyebrow.eyebrow}
            </div>

            <div className="mt-[9px] flex min-w-0 items-center gap-3">
              <ProfileIdentityLink
                href={counterpartyHref}
                label={title}
                fallbackLabel={viewerIsThreadPro ? 'Client' : 'Professional'}
                underline={false}
                className="shrink-0 rounded-full"
                inertClassName="shrink-0"
              >
                <Avatar name={title} src={avatarUrl} size="lg" />
              </ProfileIdentityLink>

              <h1 className="min-w-0 truncate font-display text-[24px] font-bold leading-[1.05] tracking-[-0.02em] md:text-[26px] lg:text-[28px]">
                <ProfileIdentityLink
                  href={counterpartyHref}
                  label={title}
                  fallbackLabel={viewerIsThreadPro ? 'Client' : 'Professional'}
                  underline={false}
                  className="block truncate transition hover:opacity-80"
                  inertClassName="block truncate"
                />
              </h1>
            </div>

            {contextNavMeta.href && contextNavMeta.cta ? (
              <div className="mt-2">
                <Link
                  href={contextNavMeta.href}
                  className="font-display text-[12px] font-semibold text-accentPrimary hover:opacity-80"
                >
                  {contextNavMeta.cta} →
                </Link>
              </div>
            ) : null}

            {clientChartLink ? (
              <div className="mt-2">
                <Link
                  href={clientChartLink.href}
                  className="font-display text-[12px] font-semibold text-accentPrimary hover:opacity-80"
                >
                  {clientChartLink.label}
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