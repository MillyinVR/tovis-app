// app/messages/start/page.tsx
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getCurrentUser } from '@/lib/currentUser'
import { getServerOrigin } from '@/lib/serverOrigin'

export const dynamic = 'force-dynamic'

type SearchParamsShape = Record<string, string | string[] | undefined>
type PageProps = {
  searchParams?: SearchParamsShape | Promise<SearchParamsShape>
}

function pickOne(v: string | string[] | undefined) {
  if (!v) return ''
  return Array.isArray(v) ? v[0] ?? '' : v
}

export default async function MessagesStartPage(props: PageProps) {
  const user = await getCurrentUser().catch(() => null)
  if (!user) redirect('/login?from=/messages/start')

  const sp = await Promise.resolve(props.searchParams ?? {})

  // New style
  let contextType = pickOne(sp.contextType)
  let contextId = pickOne(sp.contextId)

  // Legacy fallback
  const kind = pickOne(sp.kind)
  const bookingId = pickOne(sp.bookingId)
  const offeringId = pickOne(sp.offeringId)
  const serviceId = pickOne(sp.serviceId)

  if (!contextType || !contextId) {
    if (kind === 'BOOKING' && bookingId) {
      contextType = 'BOOKING'
      contextId = bookingId
    } else if (kind === 'OFFERING' && offeringId) {
      contextType = 'OFFERING'
      contextId = offeringId
    } else if (kind === 'SERVICE' && serviceId) {
      contextType = 'SERVICE'
      contextId = serviceId
    } else if (kind === 'PRO' && pickOne(sp.professionalId)) {
      contextType = 'PRO_PROFILE'
      contextId = pickOne(sp.professionalId)
    }
  }

  const professionalId = pickOne(sp.professionalId)
  const clientId = pickOne(sp.clientId)

  if (!contextType || !contextId) {
    console.log('[messages/start] missing context', { contextType, contextId, sp })
    redirect('/messages')
  }

  const origin = await getServerOrigin()
  if (!origin) {
    console.log('[messages/start] missing origin')
    redirect('/messages')
  }

  const h = await headers()
  const cookie = h.get('cookie') ?? ''

  // ✅ Quick confirmation #1: do we actually have cookies here?
  console.log('[messages/start] cookie present?', { hasCookie: Boolean(cookie), cookieLen: cookie.length })

  const payload = {
    contextType,
    contextId,
    professionalId: professionalId || undefined,
    clientId: clientId || undefined,
  }

  console.log('[messages/start] resolve payload', { origin, payload })

  const res = await fetch(`${origin}/api/messages/resolve`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      cookie, // ✅ THIS is the fix
    },
    body: JSON.stringify(payload),
  })

  const data = await res.json().catch(() => null)

  if (!res.ok || data?.ok !== true || !data?.thread?.id) {
    console.log('[messages/start] resolve failed', { status: res.status, ok: res.ok, data })
    redirect('/messages')
  }

  redirect(`/messages/thread/${encodeURIComponent(data.thread.id)}`)
}
