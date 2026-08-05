'use client'

// W5 follow-up: the pro's "ask for access" control.
//
// Before this, a pro who hit the chart refusal had nothing to press. The
// refusal copy already said "You can ask them for access" (chartAccessCopy.ts),
// which was true of the API and false of every surface a pro could reach — the
// exact shape of [[a-complete-feature-can-dead-end-at-its-entry-point]].
//
// Every terminal state is rendered as text, not as a disabled button: a control
// that cannot do anything still reads as a control the pro is failing to use.
// The one state with an action is the one where asking is actually allowed.

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/app/_components/ui'
import { readErrorMessage, safeJson } from '@/lib/http'

/** Mirrors `ChartShareRequestBlock['code']` — resolved server-side, never here. */
export type ChartShareBlockCode =
  | 'ALREADY_GRANTED'
  | 'REQUEST_PENDING'
  | 'DECLINED'
  | 'COOLDOWN'

type Props = {
  clientId: string
  /**
   * Why asking is refused right now, or null when it is allowed. Computed on
   * the server by `chartShareRequestBlock` — the SAME function the write path
   * runs, so this button can never offer an ask the POST would reject.
   */
  block: ChartShareBlockCode | null
}

const BLOCK_COPY: Record<ChartShareBlockCode, string> = {
  REQUEST_PENDING:
    'Asked — waiting on them. You’ll get a notification if they say yes.',
  // A "no" is final, and saying so plainly is the point. Offering a button here
  // would make the client's answer look negotiable.
  DECLINED: 'They declined to share their chart.',
  COOLDOWN:
    'They recently turned off chart sharing. You can ask again in a while.',
  // Unreachable from the refusal screen (a granted chart isn't refused), but
  // the map is total so a new code can never fall through to a live button.
  ALREADY_GRANTED: 'They already share their chart with you.',
}

export default function RequestChartAccessButton({ clientId, block }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  // `sent` covers this click; `block` covers every state the server already knew.
  if (sent) {
    return (
      <div className="text-[13px] font-semibold text-textSecondary">
        {BLOCK_COPY.REQUEST_PENDING}
      </div>
    )
  }

  if (block) {
    return (
      <div className="text-[13px] font-semibold text-textSecondary">
        {BLOCK_COPY[block]}
      </div>
    )
  }

  async function request() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/v1/pro/clients/${encodeURIComponent(clientId)}/chart-share`,
        {
          method: 'POST',
          headers: { Accept: 'application/json' },
        },
      )
      const data = await safeJson(res)
      if (!res.ok) {
        throw new Error(
          readErrorMessage(data) ?? 'Couldn’t send the request. Try again.',
        )
      }
      setSent(true)
      // Re-read the server state so a refresh doesn't show the pre-ask copy.
      router.refresh()
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : 'Couldn’t send the request. Try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button
          variant="primary"
          size="sm"
          disabled={busy}
          onClick={() => void request()}
        >
          {busy ? 'Asking…' : 'Request chart access'}
        </Button>
      </div>

      {error ? (
        <div className="text-[13px] font-semibold text-toneDanger">{error}</div>
      ) : null}
    </div>
  )
}
