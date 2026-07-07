'use client'

// Owner-only event-date payoff + editor on a board detail page
// (personalization spec §7–8): shows the "42 days until your wedding"
// countdown the captured date powers, and keeps the date trivially editable
// ("wedding date moves" is the spec's canonical edit case). Talks to
// PATCH /api/v1/boards/[id].

import { useState } from 'react'
import type { BoardType } from '@prisma/client'

import { cn } from '@/lib/utils'
import {
  BOARD_EVENT_NOUNS,
  boardTypeWantsEventDate,
  daysUntilEvent,
} from '@/lib/boards/context'

function countdownCopy(days: number, noun: string): string | null {
  if (days < 0) return null
  if (days === 0) return `Today’s the day — it’s ${noun}!`
  if (days === 1) return `1 day until ${noun}`
  return `${days} days until ${noun}`
}

type BoardEventCountdownProps = {
  boardId: string
  type: BoardType
  /** `YYYY-MM-DD` or null when no date is set. */
  initialEventDate: string | null
}

export default function BoardEventCountdown({
  boardId,
  type,
  initialEventDate,
}: BoardEventCountdownProps) {
  const [eventDate, setEventDate] = useState<string | null>(initialEventDate)
  const [draft, setDraft] = useState(initialEventDate ?? '')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!boardTypeWantsEventDate(type)) return null

  const noun = BOARD_EVENT_NOUNS[type] ?? 'the big day'
  const days = eventDate ? daysUntilEvent(eventDate, new Date()) : null
  const countdown = days !== null ? countdownCopy(days, noun) : null

  async function save(next: string | null) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/boards/${encodeURIComponent(boardId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventDate: next }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(data?.error || 'Could not update the date.')
      }
      setEventDate(next)
      setDraft(next ?? '')
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the date.')
    } finally {
      setBusy(false)
    }
  }

  const buttonClass = cn(
    'inline-flex min-h-9 items-center rounded-full border border-white/10 bg-bgPrimary px-3 py-1.5',
    'text-[12px] font-bold text-textPrimary transition hover:border-white/20',
    'disabled:cursor-not-allowed disabled:opacity-60',
  )

  return (
    <section className="mt-3 rounded-card border border-white/10 bg-bgSecondary p-4">
      {editing ? (
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="date"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label={`Date of ${noun}`}
            className={cn(
              'rounded-card border border-white/10 bg-bgPrimary px-3 py-2',
              'text-[13px] text-textPrimary outline-none transition focus:border-white/20',
            )}
          />
          <button
            type="button"
            disabled={busy || !draft}
            onClick={() => save(draft)}
            className={buttonClass}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          {eventDate ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => save(null)}
              className={buttonClass}
            >
              Clear
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setEditing(false)
              setDraft(eventDate ?? '')
              setError(null)
            }}
            className="text-[12px] font-bold text-textSecondary transition hover:text-textPrimary"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 text-[13px] font-bold text-textPrimary">
            {countdown ?? (
              <span className="text-textSecondary">
                {eventDate
                  ? `Hope ${noun} was everything you wanted.`
                  : `Add the date of ${noun} to get a countdown and better timing.`}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className={buttonClass}
          >
            {eventDate ? 'Edit date' : 'Add date'}
          </button>
        </div>
      )}

      {error ? (
        <div className="mt-2 text-[12px] text-toneDanger">{error}</div>
      ) : null}
    </section>
  )
}
