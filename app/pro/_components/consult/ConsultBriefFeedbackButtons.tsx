'use client'

import { useState } from 'react'

import { Button } from '@/app/_components/ui'
import type {
  ConsultBriefFeedbackDTO,
  ConsultBriefFeedbackRatingDTO,
} from '@/lib/dto/consult'

export default function ConsultBriefFeedbackButtons({
  consultId,
  initialFeedback,
}: {
  consultId: string
  initialFeedback: ConsultBriefFeedbackDTO | null
}) {
  const [feedback, setFeedback] = useState(initialFeedback)
  const [pending, setPending] = useState<ConsultBriefFeedbackRatingDTO | null>(
    null,
  )
  const [failed, setFailed] = useState(false)

  if (feedback) {
    return (
      <p className="text-[12px] font-semibold text-textSecondary">
        Feedback recorded:{' '}
        <span className="text-textPrimary">
          {feedback.rating === 'ACCURATE_USEFUL' ? 'Accurate / useful' : 'Off'}
        </span>
      </p>
    )
  }

  async function submit(rating: ConsultBriefFeedbackRatingDTO) {
    if (pending) return
    setPending(rating)
    setFailed(false)
    try {
      const response = await fetch(
        `/api/v1/pro/consults/${encodeURIComponent(consultId)}/feedback`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ rating }),
        },
      )
      const payload: unknown = await response.json().catch(() => null)
      if (
        !response.ok ||
        !payload ||
        typeof payload !== 'object' ||
        !('feedback' in payload)
      ) {
        throw new Error('feedback unavailable')
      }
      const next = payload.feedback
      if (
        !next ||
        typeof next !== 'object' ||
        !('rating' in next) ||
        !('createdAt' in next) ||
        (next.rating !== 'ACCURATE_USEFUL' && next.rating !== 'OFF') ||
        typeof next.createdAt !== 'string'
      ) {
        throw new Error('feedback unavailable')
      }
      setFeedback({ rating: next.rating, createdAt: next.createdAt })
    } catch {
      setFailed(true)
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="grid gap-2">
      <p className="text-[12px] font-semibold text-textSecondary">
        Was this brief accurate and useful?
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending !== null}
          onClick={() => submit('ACCURATE_USEFUL')}
        >
          {pending === 'ACCURATE_USEFUL' ? 'Saving…' : 'Accurate / useful'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending !== null}
          onClick={() => submit('OFF')}
        >
          {pending === 'OFF' ? 'Saving…' : 'Off'}
        </Button>
      </div>
      {failed ? (
        <p className="text-[12px] font-semibold text-toneDanger">
          Feedback could not be saved. Try again.
        </p>
      ) : null}
    </div>
  )
}
