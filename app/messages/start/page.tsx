// app/messages/start/page.tsx
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { MessageThreadContextType } from '@prisma/client'
import { getCurrentUser } from '@/lib/currentUser'
import { getServerOrigin } from '@/lib/serverOrigin'

export const dynamic = 'force-dynamic'

type SearchParamsShape = Record<string, string | string[] | undefined>

type PageProps = {
  searchParams?: SearchParamsShape | Promise<SearchParamsShape>
}

type ResolvedContext = {
  contextType: MessageThreadContextType
  contextId: string
}

type ResolvePayload = {
  contextType: MessageThreadContextType
  contextId: string
  createIfMissing: true
  professionalId?: string
  clientId?: string
}

type ResolveThreadResponse = {
  ok: true
  thread: {
    id: string
  }
}

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

function isResolveThreadResponse(value: unknown): value is ResolveThreadResponse {
  if (!isRecord(value)) return false
  if (value.ok !== true) return false
  if (!isRecord(value.thread)) return false

  return typeof value.thread.id === 'string' && value.thread.id.length > 0
}

async function readResolveResponse(res: Response): Promise<unknown> {
  return await res.json().catch(() => null)
}

export default async function MessagesStartPage(props: PageProps) {
  const user = await getCurrentUser().catch(() => null)

  if (!user) {
    redirect('/login?from=/messages/start')
  }

  const sp = await Promise.resolve(props.searchParams ?? {})
  const resolvedContext = resolveContextFromSearchParams(sp)

  if (!resolvedContext) {
    console.warn('[messages/start] missing context')
    redirect('/messages')
  }

  const professionalId = pickOne(sp.professionalId)
  const clientId = pickOne(sp.clientId)

  const origin = await getServerOrigin()

  if (!origin) {
    console.warn('[messages/start] missing origin')
    redirect('/messages')
  }

  const requestHeaders = await headers()
  const cookie = requestHeaders.get('cookie') ?? ''

  const payload: ResolvePayload = {
    contextType: resolvedContext.contextType,
    contextId: resolvedContext.contextId,
    createIfMissing: true,
    ...(professionalId ? { professionalId } : {}),
    ...(clientId ? { clientId } : {}),
  }

  const res = await fetch(`${origin}/api/messages/resolve`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      cookie,
    },
    body: JSON.stringify(payload),
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown fetch error'

    console.error('[messages/start] resolve request failed', {
      error: message,
    })

    return null
  })

  if (!res) {
    redirect('/messages')
  }

  const data = await readResolveResponse(res)

  if (!res.ok || !isResolveThreadResponse(data)) {
    console.warn('[messages/start] resolve failed', {
      status: res.status,
      ok: res.ok,
    })

    redirect('/messages')
  }

  redirect(`/messages/thread/${encodeURIComponent(data.thread.id)}`)
}