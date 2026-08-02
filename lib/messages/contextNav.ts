// lib/messages/contextNav.ts
//
// The thread header's deep link into the thread's OWN context — "View booking" /
// "View profile" (app/messages/thread/[id]/page.tsx). Pure: derived from the
// thread's context ids plus who is looking, with no lookup.
//
// It lives here rather than inline in the page so the viewer-dependence below has
// a test of its own, and so the iOS thread header (`MessageThread
// .contextDestination` in tovis-ios) has a named source of truth to stay level
// with instead of a rule buried in a server component.

import { MessageThreadContextType } from '@prisma/client'

export type ThreadContextNav = {
  href: string | null
  cta: string | null
}

const NO_NAV: ThreadContextNav = { href: null, cta: null }

/**
 * Where this thread's header context link points, or no link at all.
 *
 * BOOKING → the dual-role receipt at `/booking/{id}`, which either party may
 * open. SERVICE / OFFERING / WAITLIST deliberately get no link.
 *
 * PRO_PROFILE gets a link only for a CLIENT viewer. A PRO_PROFILE thread's
 * `contextId` IS the thread's professional, so the link is self-referential when
 * the viewer is that pro — "View profile" sent a pro to their own public page.
 * A pro's counterparty is the client, whose equivalent destination is the chart,
 * offered separately as "View client chart" (and access-gated). This is the same
 * rule the header's name/avatar link already applies via `counterpartyProId`.
 */
export function resolveThreadContextNav(thread: {
  contextType: MessageThreadContextType
  contextId: string
  bookingId: string | null
  viewerIsThreadPro: boolean
}): ThreadContextNav {
  if (thread.contextType === MessageThreadContextType.BOOKING && thread.bookingId) {
    return {
      href: `/booking/${encodeURIComponent(thread.bookingId)}`,
      cta: 'View booking',
    }
  }

  if (
    thread.contextType === MessageThreadContextType.PRO_PROFILE &&
    thread.contextId &&
    !thread.viewerIsThreadPro
  ) {
    return {
      href: `/professionals/${encodeURIComponent(thread.contextId)}`,
      cta: 'View profile',
    }
  }

  return NO_NAV
}
