'use client'

import { useCallback, useState, useTransition } from 'react'

import { cn } from '@/lib/utils'

/**
 * "Before you go" — the pro's checklist, ticked by the client.
 *
 * Optimistic: the box fills on tap and the bar moves, then the server confirms.
 * A refusal (the pro cancelled the appointment between render and tap) rolls the
 * row back and says why, rather than leaving a tick the server never stored.
 */

export type PrepChecklistItem = {
  id: string
  text: string
}

type Props = {
  bookingId: string
  items: PrepChecklistItem[]
  initialCheckedIds: string[]
  /** False once the appointment can no longer be prepared for — read-only. */
  writable: boolean
}

export default function PrepChecklistCard({
  bookingId,
  items,
  initialCheckedIds,
  writable,
}: Props) {
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(initialCheckedIds),
  )
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const done = items.filter((item) => checked.has(item.id)).length
  const total = items.length
  const allDone = total > 0 && done === total

  const toggle = useCallback(
    (itemId: string) => {
      if (!writable) return

      const next = new Set(checked)
      const nowChecked = !next.has(itemId)
      if (nowChecked) next.add(itemId)
      else next.delete(itemId)

      const previous = checked
      setChecked(next)
      setError(null)

      startTransition(() => {
        void (async () => {
          try {
            const res = await fetch(
              `/api/v1/client/bookings/${encodeURIComponent(bookingId)}/prep`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prepItemId: itemId, checked: nowChecked }),
              },
            )
            const body = (await res.json().catch(() => null)) as {
              ok?: boolean
              error?: string
              checkedItemIds?: string[]
            } | null

            if (!res.ok || !body?.ok) {
              // Roll back to what the server actually holds.
              setChecked(previous)
              setError(body?.error ?? 'Could not save that. Try again.')
              return
            }

            if (Array.isArray(body.checkedItemIds)) {
              setChecked(new Set(body.checkedItemIds))
            }
          } catch {
            setChecked(previous)
            setError('Could not save that. Check your connection.')
          }
        })()
      })
    },
    [bookingId, checked, writable],
  )

  if (total === 0) return null

  return (
    <section className="rounded-card border border-textPrimary/10 bg-bgPrimary p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-bold text-textPrimary">Before you go</h2>
        <span className="font-mono text-[10px] font-bold tracking-[0.14em] text-accentPrimary tabular-nums">
          {done} OF {total} DONE
        </span>
      </div>

      <div className="mt-3 h-[3px] overflow-hidden rounded-full bg-textPrimary/10">
        <div
          className="h-full rounded-full bg-accentPrimary transition-[width] duration-300"
          style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }}
        />
      </div>

      <ul className="mt-3 flex flex-col">
        {items.map((item) => {
          const isDone = checked.has(item.id)
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => toggle(item.id)}
                disabled={!writable}
                aria-pressed={isDone}
                data-testid="prep-row"
                className={cn(
                  'flex w-full items-start gap-3 py-2 text-left transition',
                  writable ? 'cursor-pointer' : 'cursor-default',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'mt-[1px] grid h-[22px] w-[22px] flex-none place-items-center rounded-[7px] border transition',
                    isDone
                      ? 'border-accentPrimary bg-accentPrimary text-onAccent'
                      : 'border-textPrimary/25 bg-transparent',
                  )}
                >
                  {isDone ? (
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                    >
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  ) : null}
                </span>
                <span
                  className={cn(
                    'text-[13px] leading-[1.4]',
                    isDone
                      ? 'text-textPrimary/45 line-through'
                      : 'text-textPrimary',
                  )}
                >
                  {item.text}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {allDone ? (
        <p className="mt-3 flex items-center gap-2 rounded-[13px] border border-accentPrimary bg-accentPrimary/10 px-3 py-3 text-[13px] font-bold text-textPrimary">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            className="flex-none text-accentPrimary"
            aria-hidden
          >
            <path d="M5 13l4 4L19 7" />
          </svg>
          You&rsquo;re ready. Just turn up.
        </p>
      ) : done === 0 && writable ? (
        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-textPrimary/45">
          Tap a line as you do it
        </p>
      ) : null}

      {error ? (
        <p role="status" className="mt-3 text-[12px] font-semibold text-toneDanger">
          {error}
        </p>
      ) : null}
    </section>
  )
}
