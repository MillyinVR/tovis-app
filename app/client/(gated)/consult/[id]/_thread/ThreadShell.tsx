'use client'

// P5a — the thread SHELL: layout, bubbles and the sticky CTA, and nothing about
// consults.
//
// Deliberately script-agnostic. The handoff says the pro-side mentor "reuses
// the same thread component with a different script", so anything that knows
// what a consult step IS belongs in the renderer above this, never here. What
// lives here is the chat geometry: who a bubble is from, where it sits, how a
// card is framed, and the behaviours that make a thread read as a CHAT rather
// than a form — the newest message sits at the bottom, a new one rises into
// place, the app shows "…" while it composes the next one, and the page follows
// the conversation down.
//
// Tori's call (2026-09-11): the consult shows ONE thing at a time. The script
// decides which messages are on screen (lib/consult/visibleThread.ts); the
// shell only has to land her on the newest one.

import { useEffect, useRef, type ReactNode } from 'react'

/** The app's own voice on the left; the client's own answers on the right. */
export type ThreadAuthor = 'APP' | 'CLIENT'

export const THREAD_BUTTON_PRIMARY =
  'rounded-xl bg-textPrimary px-4 py-2.5 text-sm font-black text-bgPrimary disabled:opacity-50'
export const THREAD_BUTTON_SECONDARY =
  'rounded-xl border border-surfaceGlass/20 px-4 py-2.5 text-sm font-bold text-textPrimary disabled:opacity-50'

/**
 * The mount animation every new message gets (app/globals.css). It is on the
 * bubble and the card rather than on the slot, so that when an answered step
 * collapses into its question-and-answer bubbles, THOSE rise into place — the
 * slot itself never remounts.
 */
export const THREAD_MESSAGE_ENTER = 'thread-message-enter'

/**
 * A spoken bubble.
 *
 * The app's side is a plain surface rather than the accent fill the client's
 * side gets: the accent is what "you said this" looks like everywhere else in
 * the product (messaging), and borrowing it for the app would make the app read
 * as the person you are talking to.
 */
export function ThreadBubble({
  author,
  children,
}: {
  author: ThreadAuthor
  children: ReactNode
}) {
  const mine = author === 'CLIENT'
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`${THREAD_MESSAGE_ENTER} ${
          mine
            ? 'max-w-[80%] rounded-2xl rounded-br-md bg-textPrimary px-4 py-2.5 text-sm font-semibold leading-6 text-bgPrimary'
            : 'max-w-[85%] rounded-2xl rounded-bl-md border border-surfaceGlass/10 bg-bgSurface px-4 py-2.5 text-sm leading-6 text-textPrimary'
        }`}
      >
        {children}
      </div>
    </div>
  )
}

/**
 * A card message — anything with controls in it.
 *
 * Wider than a bubble and squared off, because it is a thing to act on rather
 * than something said. `dimmed` is a card that is partly settled (one of two
 * agreements accepted): still readable, visibly done.
 */
export function ThreadCard({
  dimmed,
  children,
}: {
  dimmed?: boolean
  children: ReactNode
}) {
  return (
    <div
      className={`${THREAD_MESSAGE_ENTER} rounded-2xl border border-surfaceGlass/10 bg-bgSurface p-4 ${
        dimmed ? 'opacity-60' : ''
      }`}
    >
      {children}
    </div>
  )
}

/**
 * The "…" the app shows while it is saving her answer and composing the next
 * message. It is honest: it is on screen exactly while a write and the re-read
 * that follows it are in flight, and never on a timer.
 */
export function ThreadTyping() {
  return (
    <div className="flex justify-start" data-testid="consult-thread-typing">
      <div
        role="status"
        className={`${THREAD_MESSAGE_ENTER} flex items-center gap-1 rounded-2xl rounded-bl-md border border-surfaceGlass/10 bg-bgSurface px-4 py-3`}
      >
        <span className="sr-only">Working on it…</span>
        <span aria-hidden="true" className="thread-typing-dot h-1.5 w-1.5 rounded-full bg-textSecondary" />
        <span aria-hidden="true" className="thread-typing-dot h-1.5 w-1.5 rounded-full bg-textSecondary" />
        <span aria-hidden="true" className="thread-typing-dot h-1.5 w-1.5 rounded-full bg-textSecondary" />
      </div>
    </div>
  )
}

/**
 * The thread itself.
 *
 * The list is bottom-anchored like a messaging app: a short thread sits low on
 * the screen with the newest message nearest the CTA, and a long one scrolls.
 *
 * Following the conversation is keyed on `latestMessageId` and `openMessageId`
 * — the two things that change when a NEW message lands — and on `typing`.
 * 🔴 NOT on the message list itself. The analysis poll re-reads the thread
 * every few seconds; re-scrolling on every poll would yank the page out from
 * under a client who had scrolled back to re-read something.
 *
 * A new message that fits on screen is scrolled to its END, so it reads as the
 * latest line of the chat. One taller than the screen (a photo picker) is
 * scrolled to its START instead — landing on the bottom of a tall card would
 * hide the question it asks.
 */
export function ThreadShell({
  openMessageId,
  latestMessageId,
  typing,
  children,
  footer,
}: {
  openMessageId: string | null
  /** The last message on screen — a new one landing is what moves the page. */
  latestMessageId: string | null
  /** A write is in flight: show the "…" and keep it in view. */
  typing?: boolean
  children: ReactNode
  /** The sticky CTA region. Rendered below the thread and pinned. */
  footer?: ReactNode
}) {
  const listRef = useRef<HTMLDivElement | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)
  const landed = useRef(false)

  useEffect(() => {
    const end = endRef.current
    const list = listRef.current
    // 🔴 Feature-detected, not assumed. `scrollIntoView` is absent in jsdom, and
    // an unguarded call THROWS out of this effect — which does not just skip the
    // scroll, it takes the whole mount effect with it. Landing on the newest
    // message is a nicety; the thread rendering at all is not.
    if (!end || !list || typeof end.scrollIntoView !== 'function') return
    const newest =
      latestMessageId === null
        ? null
        : list.querySelector(`[data-thread-message="${CSS.escape(latestMessageId)}"]`)

    // Opening the thread lands INSTANTLY, the way a messaging app opens at the
    // bottom; a message that arrives while she is looking glides into place.
    const behavior: ScrollBehavior = landed.current ? 'smooth' : 'auto'
    landed.current = true

    const land = (how: ScrollBehavior) => {
      if (
        newest instanceof HTMLElement &&
        typeof newest.scrollIntoView === 'function' &&
        newest.offsetHeight > window.innerHeight * 0.7
      ) {
        newest.scrollIntoView({ block: 'start', behavior: how })
        return
      }
      end.scrollIntoView({ block: 'end', behavior: how })
    }
    land(behavior)

    // 🔴 The newest message can GROW after it lands: a card shows a crop of the
    // reference, and that photograph arrives from the network after the first
    // paint. A landing measured before the image was there leaves a tall card
    // half off screen. `load` does not bubble, but it can be captured on the
    // list, so each image that finishes inside the newest message re-lands —
    // instantly, since nothing has "arrived" from her point of view.
    const onLoad = (event: Event) => {
      if (
        newest instanceof HTMLElement &&
        event.target instanceof HTMLImageElement &&
        newest.contains(event.target)
      ) {
        land('auto')
      }
    }
    list.addEventListener('load', onLoad, true)
    return () => list.removeEventListener('load', onLoad, true)
  }, [openMessageId, latestMessageId])

  useEffect(() => {
    if (!typing) return
    const end = endRef.current
    if (!end || typeof end.scrollIntoView !== 'function') return
    // A nudge, not a jump: only as far as it takes to bring the "…" on screen.
    end.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [typing])

  return (
    <div className="grid gap-4">
      <div
        ref={listRef}
        className="flex min-h-[55dvh] flex-col justify-end gap-3"
        data-testid="consult-thread"
      >
        {children}
      </div>
      {/* 🔴 The offset is not decoration. The app shell mounts a FIXED bottom
          nav, and a sticky footer pinned to `bottom-0` pins to the bottom of the
          scrollport — which is UNDERNEATH that nav. Measured before this line
          existed: the CTA occupied y 759–803 with the nav at 759–839, so it was
          covered edge to edge and `elementFromPoint` at its own centre returned
          the nav, not the button. It rendered, it passed an in-viewport
          assertion, and it could not be pressed.

          `--app-footer-space` is the shell's own measurement of that nav
          (app/layout.tsx) and resolves to 0px wherever no footer is mounted, so
          this is unchanged for a signed-out visitor. Same offset the add-ons
          bar and the search map already use. */}
      {footer ? (
        <div
          style={{
            bottom:
              'max(var(--app-footer-space, 0px), env(safe-area-inset-bottom))',
          }}
          className="sticky -mx-1 border-t border-surfaceGlass/10 bg-bgPrimary px-1 pb-3 pt-3"
        >
          {footer}
        </div>
      ) : null}
      {/* The scroll target for "the newest message". It sits AFTER the sticky
          footer in flow, so scrolling it to the bottom edge leaves the footer
          in its natural place — above it — with the last message clear above
          that. The margin keeps it out from under the fixed nav. */}
      <div
        ref={endRef}
        aria-hidden="true"
        style={{ scrollMarginBottom: 'var(--app-footer-space, 0px)' }}
      />
    </div>
  )
}

/** Positions one message in the thread and gives the shell its scroll target. */
export function ThreadMessageSlot({
  id,
  children,
}: {
  id: string
  children: ReactNode
}) {
  return <div data-thread-message={id}>{children}</div>
}
