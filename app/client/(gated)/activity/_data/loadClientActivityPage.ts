// app/client/(gated)/activity/_data/loadClientActivityPage.ts
import 'server-only'

import { redirect } from 'next/navigation'

import { NotificationEventKey } from '@prisma/client'

import { getCurrentUser } from '@/lib/currentUser'
import { prisma } from '@/lib/prisma'
import {
  ACTIVITY_FEED_EVENT_KEYS,
  listClientActivity,
  type ClientActivityItem,
} from '@/lib/notifications/activityFeed'

type CurrentUserResult = Awaited<ReturnType<typeof getCurrentUser>>

type AuthedClientUser = NonNullable<CurrentUserResult> & {
  role: 'CLIENT'
  clientProfile: { id: string }
}

function isAuthedClientUser(
  user: CurrentUserResult | null,
): user is AuthedClientUser {
  return Boolean(
    user &&
      user.role === 'CLIENT' &&
      user.clientProfile &&
      typeof user.clientProfile.id === 'string' &&
      user.clientProfile.id.trim(),
  )
}

export type ClientActivityPageData = {
  items: ClientActivityItem[]
  unreadCount: number
  /** The event keys "Mark all read" should clear (the activity allowlist). */
  markReadEventKeys: NotificationEventKey[]
}

export async function loadClientActivityPage(): Promise<ClientActivityPageData> {
  // The (gated) layout already enforces an active, verified CLIENT session; this
  // is a belt-and-suspenders guard matching the Me-page loader.
  const user = await getCurrentUser().catch(() => null)
  if (!isAuthedClientUser(user)) {
    redirect('/login?from=/client/activity')
  }

  const feed = await listClientActivity(prisma, {
    clientId: user.clientProfile.id,
  })

  return {
    items: feed.items,
    unreadCount: feed.unreadCount,
    markReadEventKeys: [...ACTIVITY_FEED_EVENT_KEYS],
  }
}
