'use client'

import { useCallback, useMemo, useState } from 'react'

import RemoteImage from '@/app/_components/media/RemoteImage'
import { cn } from '@/lib/utils'

/**
 * "Send my board to {pro}".
 *
 * 🔴 A DISCLOSURE, so it asks first and says exactly what the pro will see —
 * including, in as many words, when the board is private. The board's own
 * visibility never changes; sending is revocable and the card says so once sent.
 *
 * This is the same care the media-consent toggle gets, and for the same reason:
 * the client is widening who can see something of theirs, and a one-tap silent
 * share would be the wrong shape for that.
 */

export type SendableBoard = {
  id: string
  name: string
  itemCount: number
  visibility: 'PRIVATE' | 'SHARED'
  tileImageUrls: string[]
}

type Props = {
  bookingId: string
  proDisplayName: string
  boards: SendableBoard[]
  initialSharedBoardIds: string[]
  /** False once the appointment can no longer be prepared for. */
  writable: boolean
  /** The design promotes this above the checklist when the appointment is far out. */
  emphasis?: boolean
}

export default function SendBoardCard({
  bookingId,
  proDisplayName,
  boards,
  initialSharedBoardIds,
  writable,
  emphasis = false,
}: Props) {
  const [sharedIds, setSharedIds] = useState<Set<string>>(
    () => new Set(initialSharedBoardIds),
  )
  const [confirming, setConfirming] = useState<SendableBoard | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The board to offer: the first not-yet-sent one, else the first sent one so
  // the card can show its state and offer to take it back.
  const board = useMemo(() => {
    return boards.find((b) => !sharedIds.has(b.id)) ?? boards[0] ?? null
  }, [boards, sharedIds])

  const send = useCallback(
    async (target: SendableBoard, shared: boolean) => {
      setBusy(true)
      setError(null)
      try {
        const res = await fetch(
          `/api/v1/client/bookings/${encodeURIComponent(bookingId)}/board`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ boardId: target.id, shared }),
          },
        )
        const body = (await res.json().catch(() => null)) as {
          ok?: boolean
          error?: string
          sharedBoardIds?: string[]
        } | null

        if (!res.ok || !body?.ok) {
          setError(body?.error ?? 'Could not send your board. Try again.')
          return
        }
        if (Array.isArray(body.sharedBoardIds)) {
          setSharedIds(new Set(body.sharedBoardIds))
        }
        setConfirming(null)
      } catch {
        setError('Could not send your board. Check your connection.')
      } finally {
        setBusy(false)
      }
    },
    [bookingId],
  )

  if (!board) return null

  const isSent = sharedIds.has(board.id)
  const tiles = board.tileImageUrls.slice(0, emphasis ? 4 : 3)

  return (
    <section
      className={cn(
        'rounded-card p-4',
        emphasis
          ? 'border border-accentPrimary bg-accentPrimary/10'
          : 'border border-textPrimary/10 bg-bgPrimary',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold text-textPrimary">
            {emphasis ? `Send ${proDisplayName} your board` : 'Your inspiration board'}
          </h2>
          <p className="mt-1 text-[12px] text-textPrimary/60">
            {emphasis
              ? `There's time to change the plan. ${proDisplayName} reads boards before starting.`
              : `${board.name} · ${board.itemCount} ${board.itemCount === 1 ? 'look' : 'looks'}`}
          </p>
        </div>

        {!emphasis && tiles.length > 0 ? (
          <div className="flex flex-none gap-1">
            {tiles.map((url, i) => (
              <span
                key={`${url}-${i}`}
                className="h-[34px] w-[34px] overflow-hidden rounded-[9px] bg-textPrimary/10"
              >
                <RemoteImage
                  src={url}
                  alt=""
                  width={68}
                  height={68}
                  className="h-full w-full object-cover"
                />
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {emphasis && tiles.length > 0 ? (
        <div className="mt-3 grid grid-cols-4 gap-[6px]">
          {tiles.map((url, i) => (
            <span
              key={`${url}-${i}`}
              className="block h-[52px] overflow-hidden rounded-[10px] bg-textPrimary/10"
            >
              <RemoteImage
                src={url}
                alt=""
                width={104}
                height={104}
                className="h-full w-full object-cover"
              />
            </span>
          ))}
        </div>
      ) : null}

      {isSent ? (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-[13px] font-bold text-textPrimary">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              className="flex-none text-accentPrimary"
              aria-hidden
            >
              <path d="M5 13l4 4L19 7" />
            </svg>
            Sent to {proDisplayName}
          </p>
          {writable ? (
            <button
              type="button"
              onClick={() => void send(board, false)}
              disabled={busy}
              className="font-mono text-[10px] uppercase tracking-[0.14em] text-textPrimary/55 underline underline-offset-4 transition hover:text-textPrimary disabled:opacity-50"
            >
              Take it back
            </button>
          ) : null}
        </div>
      ) : writable ? (
        <button
          type="button"
          onClick={() => setConfirming(board)}
          disabled={busy}
          className="mt-3 w-full rounded-[12px] bg-accentPrimary px-4 py-3 text-[13px] font-bold text-onAccent transition hover:bg-accentPrimaryHover disabled:opacity-60"
        >
          Send my board to {proDisplayName}
        </button>
      ) : null}

      {confirming ? (
        <div className="mt-3 rounded-[13px] border border-textPrimary/15 bg-surfaceGlass/10 p-3">
          <p className="text-[13px] font-bold text-textPrimary">
            Send &ldquo;{confirming.name}&rdquo; to {proDisplayName}?
          </p>
          <p className="mt-1 text-[12px] leading-[1.5] text-textPrimary/65">
            {proDisplayName} will be able to see the{' '}
            {confirming.itemCount === 1
              ? '1 look'
              : `${confirming.itemCount} looks`}{' '}
            on this board, for this appointment.
            {confirming.visibility === 'PRIVATE'
              ? ' This board is private — sending it here does not make it public, and it stays private to everyone else.'
              : ''}{' '}
            You can take it back any time.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setConfirming(null)}
              disabled={busy}
              className="flex-1 rounded-[12px] border border-textPrimary/20 px-3 py-2 text-[12px] font-bold text-textPrimary transition hover:border-textPrimary/40 disabled:opacity-50"
            >
              Not now
            </button>
            <button
              type="button"
              onClick={() => void send(confirming, true)}
              disabled={busy}
              className="flex-1 rounded-[12px] bg-accentPrimary px-3 py-2 text-[12px] font-bold text-onAccent transition hover:bg-accentPrimaryHover disabled:opacity-60"
            >
              {busy ? 'Sending…' : 'Send it'}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="status" className="mt-3 text-[12px] font-semibold text-toneDanger">
          {error}
        </p>
      ) : null}
    </section>
  )
}
