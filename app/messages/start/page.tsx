// app/messages/start/page.tsx
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

type PageProps = {
  searchParams?: Record<string, string | string[] | undefined>
}

function pickOne(v: string | string[] | undefined) {
  if (!v) return ''
  return Array.isArray(v) ? v[0] ?? '' : v
}

export default async function MessagesStartPage(props: PageProps) {
  const user = await getCurrentUser().catch(() => null)
  if (!user) redirect('/login?from=/messages/start')

  const sp = props.searchParams ?? {}

  const contextType = pickOne(sp.contextType)
  const contextId = pickOne(sp.contextId)

  // optional (depends on context)
  const professionalId = pickOne(sp.professionalId)
  const clientId = pickOne(sp.clientId)

  if (!contextType || !contextId) {
    redirect('/messages') // or a friendly error page
  }

  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? ''}/api/messages/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({
      contextType,
      contextId,
      professionalId: professionalId || undefined,
      clientId: clientId || undefined,
    }),
  })

  const data = await res.json().catch(() => null)

  if (!res.ok || !data?.ok || !data?.thread?.id) {
    // fallback: send them somewhere safe
    redirect('/messages')
  }

  redirect(`/messages/thread/${encodeURIComponent(data.thread.id)}`)
}
