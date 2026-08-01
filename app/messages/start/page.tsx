// app/messages/start/page.tsx
import { redirect } from 'next/navigation'
import { MessageThreadContextType } from '@prisma/client'
import { getCurrentUser } from '@/lib/currentUser'
import { resolveMessageThread } from '@/lib/messagesResolve'

export const dynamic = 'force-dynamic'

type SearchParamsShape = Record<string, string | string[] | undefined>

type PageProps = {
  searchParams?: SearchParamsShape | Promise<SearchParamsShape>
}

type ResolvedContext = {
  contextType: MessageThreadContextType
  contextId: string
}

function pickOne(value: string | string[] | undefined): string {
  if (!value) return ''
  return Array.isArray(value) ? value[0] ?? '' : value
}

function normalizeContextType(value: string): MessageThreadContextType | null {
  const normalized = value.trim().toUpperCase()

  if (normalized === MessageThreadContextType.BOOKING) {
    return MessageThreadContextType.BOOKING
  }

  if (normalized === MessageThreadContextType.SERVICE) {
    return MessageThreadContextType.SERVICE
  }

  if (normalized === MessageThreadContextType.OFFERING) {
    return MessageThreadContextType.OFFERING
  }

  if (normalized === MessageThreadContextType.PRO_PROFILE) {
    return MessageThreadContextType.PRO_PROFILE
  }

  if (normalized === MessageThreadContextType.WAITLIST) {
    return MessageThreadContextType.WAITLIST
  }

  return null
}

function resolveContextFromSearchParams(sp: SearchParamsShape): ResolvedContext | null {
  const directContextType = normalizeContextType(pickOne(sp.contextType))
  const directContextId = pickOne(sp.contextId)

  if (directContextType && directContextId) {
    return {
      contextType: directContextType,
      contextId: directContextId,
    }
  }

  const kind = pickOne(sp.kind).trim().toUpperCase()

  const bookingId = pickOne(sp.bookingId)
  const serviceId = pickOne(sp.serviceId)
  const offeringId = pickOne(sp.offeringId)
  const professionalId = pickOne(sp.professionalId)
  const waitlistEntryId = pickOne(sp.waitlistEntryId) || pickOne(sp.waitlistId)

  if (kind === MessageThreadContextType.BOOKING && bookingId) {
    return {
      contextType: MessageThreadContextType.BOOKING,
      contextId: bookingId,
    }
  }

  if (kind === MessageThreadContextType.SERVICE && serviceId) {
    return {
      contextType: MessageThreadContextType.SERVICE,
      contextId: serviceId,
    }
  }

  if (kind === MessageThreadContextType.OFFERING && offeringId) {
    return {
      contextType: MessageThreadContextType.OFFERING,
      contextId: offeringId,
    }
  }

  if (kind === MessageThreadContextType.WAITLIST && waitlistEntryId) {
    return {
      contextType: MessageThreadContextType.WAITLIST,
      contextId: waitlistEntryId,
    }
  }

  if (kind === 'PRO' && professionalId) {
    return {
      contextType: MessageThreadContextType.PRO_PROFILE,
      contextId: professionalId,
    }
  }

  if (waitlistEntryId) {
    return {
      contextType: MessageThreadContextType.WAITLIST,
      contextId: waitlistEntryId,
    }
  }

  return null
}

/**
 * The path to come back to after signing in — INCLUDING the params.
 *
 * `/messages/start` is nothing but a resolver over its query string: without
 * the params it resolves no context and bounces to `/messages`. So a bare
 * `from=/messages/start` sends the user back to a page that immediately forgets
 * who they wanted to message.
 *
 * That was survivable while every entry point was already behind auth. W7 puts
 * a **Message** button on Discover — a public, unauthenticated surface — so a
 * signed-out visitor tapping it is now the common case, not the edge one.
 */
function startPathWithParams(sp: SearchParamsShape): string {
  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(sp)) {
    const single = pickOne(value)
    if (single) params.set(key, single)
  }

  const query = params.toString()
  return query ? `/messages/start?${query}` : '/messages/start'
}

export default async function MessagesStartPage(props: PageProps) {
  const user = await getCurrentUser().catch(() => null)

  const sp = await Promise.resolve(props.searchParams ?? {})

  if (!user) {
    redirect(`/login?from=${encodeURIComponent(startPathWithParams(sp))}`)
  }

  const resolvedContext = resolveContextFromSearchParams(sp)

  if (!resolvedContext) {
    redirect('/messages')
  }

  const professionalId = pickOne(sp.professionalId).trim()
  const clientId = pickOne(sp.clientId).trim()

  const outcome = await resolveMessageThread({
    viewer: user,
    input: {
      contextType: resolvedContext.contextType,
      contextId: resolvedContext.contextId,
      createIfMissing: true,
      ...(professionalId ? { professionalId } : {}),
      ...(clientId ? { clientId } : {}),
    },
  })

  if (!outcome.ok) {
    redirect('/messages')
  }

  if (!outcome.thread) {
    redirect('/messages')
  }

  redirect(`/messages/thread/${encodeURIComponent(outcome.thread.id)}`)
}
