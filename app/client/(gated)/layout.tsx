import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { getCurrentUser } from '@/lib/currentUser'
import { pathWithQueryFromHeaders } from '@/lib/requestPath'
import { RefreshOnFocus } from '@/app/_components/live/RefreshOnFocus'
import { LiveRefresh } from '@/app/_components/live/LiveRefresh'
import { liveChannelForUser } from '@/lib/live/broadcast'

export const dynamic = 'force-dynamic'

const CLIENT_HOME = '/client'

function loginHref(from: string): string {
  return `/login?from=${encodeURIComponent(from)}`
}

function verifyHref(next: string): string {
  return `/verify-phone?next=${encodeURIComponent(next)}`
}

export default async function ClientLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentUser().catch(() => null)

  if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
    // Send them back to the page they actually asked for, query included — a
    // signed-out tap on `/client/bookings/{id}?step=aftercare` has to survive
    // the login, or the aftercare prompt is a dead end. `?from=` is re-checked
    // by the login screen's sanitizer; this is not a widening of what it takes.
    const requestedPath = pathWithQueryFromHeaders(await headers(), CLIENT_HOME)
    redirect(loginHref(requestedPath))
  }

  if (user.sessionKind !== 'ACTIVE' || !user.isFullyVerified) {
    redirect(verifyHref(CLIENT_HOME))
  }

  const liveChannels = [liveChannelForUser(user.id)].filter(
    (c): c is string => Boolean(c),
  )

  return (
    <div className="min-h-dvh bg-bgPrimary text-textPrimary">
      <RefreshOnFocus />
      <LiveRefresh channels={liveChannels} />
      <div className="mx-auto w-full max-w-5xl px-4 pt-4">{children}</div>
    </div>
  )
}