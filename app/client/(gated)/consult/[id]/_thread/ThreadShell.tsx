'use client'

// P5a — the thread SHELL: layout, bubbles and the sticky CTA, and nothing about
// consults.
//
// Deliberately script-agnostic. The handoff says the pro-side mentor "reuses
// the same thread component with a different script", so anything that knows
// what a consult step IS belongs in the renderer above this, never here. What
// lives here is the chat geometry: who a bubble is from, where it sits, how a
// card is framed, and the one behaviour that makes a thread a thread — landing
// on the message that is waiting for you.

import { useEffect, useRef, type ReactNode } from 'react'

/** The app's own voice on the left; the client's own answers on the right. */
export type ThreadAuthor = 'APP' | 'CLIENT'

export const THREAD_BUTTON_PRIMARY =
  'rounded-xl bg-textPrimary px-4 py-2.5 text-sm font-black text-bgPrimary disabled:opacity-50'
export const THREAD_BUTTON_SECONDARY =
  'rounded-xl border border-surfaceGlass/20 px-4 py-2.5 text-sm font-bold text-textPrimary disabled:opacity-50'

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
        className={
          mine
            ? 'max-w-[80%] rounded-2xl rounded-br-md bg-textPrimary px-4 py-2.5 text-sm font-semibold leading-6 text-bgPrimary'
            : 'max-w-[85%] rounded-2xl rounded-bl-md border border-surfaceGlass/10 bg-bgSurface px-4 py-2.5 text-sm leading-6 text-textPrimary'
        }
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
 * than something said. `dimmed` is settled history: still readable, visibly
 * done, never removed (a thread you can't scroll back through is a wizard).
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
      className={`rounded-2xl border border-surfaceGlass/10 bg-bgSurface p-4 ${
        dimmed ? 'opacity-60' : ''
      }`}
    >
      {children}
    </div>
  )
}

/**
 * The thread itself.
 *
 * `openMessageId` is the whole resume story: on mount, and whenever the open
 * step moves, the thread scrolls that message into view. Everything before it
 * stays scrollable history.
 *
 * 🔴 The scroll is keyed on `openMessageId`, NOT on the message list. Re-running
 * it on every poll would yank the page out from under a client who had scrolled
 * back to re-read something, once every few seconds.
 */
export function ThreadShell({
  openMessageId,
  children,
  footer,
}: {
  openMessageId: string | null
  children: ReactNode
  /** The sticky CTA region. Rendered below the thread and pinned. */
  footer?: ReactNode
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!openMessageId) return
    const container = scrollRef.current
    if (!container) return
    const target = container.querySelector(
      `[data-thread-message="${CSS.escape(openMessageId)}"]`,
    )
    // 🔴 Feature-detected, not assumed. `scrollIntoView` is absent in jsdom, and
    // an unguarded call THROWS out of this effect — which does not just skip the
    // scroll, it takes the whole mount effect with it. Landing on the open step
    // is a nicety; the thread rendering at all is not.
    if (target instanceof HTMLElement && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [openMessageId])

  return (
    <div className="grid gap-4">
      <div ref={scrollRef} className="grid gap-3">
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
