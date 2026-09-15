// app/client/(gated)/_data/requireClientPage.ts
//
// The client-page auth gate, as a page-level call.
//
// ⚠️ `app/client/(gated)/layout.tsx` already redirects a signed-out visitor,
// and that is NOT enough on its own. A layout and the page beneath it render in
// parallel, so the page's own loaders still run and their output still reaches
// the response body — an anonymous `curl` of a gated route comes back 200 with
// the whole RSC payload in it, redirect and all. Checking here is what stops
// the page doing the work and shipping the answer.
//
// The client home has always done this (it is where this helper was lifted
// from) and `/pro/viral-requests` does the pro-side equivalent inline. This is
// the one copy, so a new gated page cannot quietly skip it.
import { Role } from '@prisma/client'
import { redirect } from 'next/navigation'

import { getCurrentUser } from '@/lib/currentUser'

type MaybeCurrentUser = Awaited<ReturnType<typeof getCurrentUser>>
type CurrentUser = NonNullable<MaybeCurrentUser>

export type ClientPageUser = CurrentUser & {
  role: 'CLIENT'
  clientProfile: NonNullable<CurrentUser['clientProfile']>
}

export function isClientPageUser(
  user: MaybeCurrentUser,
): user is ClientPageUser {
  return Boolean(user && user.role === Role.CLIENT && user.clientProfile?.id)
}

/**
 * The signed-in client, or a redirect to sign in and come back.
 *
 * `from` is the path to return to after login — pass the page's OWN path, not
 * a constant, or every gated page dumps the client on the home screen instead
 * of where they were going. The login screen re-sanitizes it.
 */
export async function requireClientPage(
  from: string,
): Promise<ClientPageUser> {
  const user = await getCurrentUser().catch(() => null)

  if (!isClientPageUser(user)) {
    redirect(`/login?from=${encodeURIComponent(from)}`)
  }

  return user
}
