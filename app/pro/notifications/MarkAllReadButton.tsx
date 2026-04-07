// app/pro/notifications/MarkAllReadButton.tsx

'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

type MarkAllReadButtonProps = {
  unreadCount: number
}

export default function MarkAllReadButton(
  props: MarkAllReadButtonProps,
) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const disabled = props.unreadCount <= 0 || isSubmitting

  async function handleClick() {
    if (disabled) return

    setIsSubmitting(true)

    try {
      const res = await fetch('/api/pro/notifications/mark-read', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        cache: 'no-store',
      })

      if (!res.ok) {
        setIsSubmitting(false)
        return
      }

      router.refresh()
    } catch {
      setIsSubmitting(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className={[
        'inline-flex items-center rounded-full border px-3 py-1.5 text-[12px] font-extrabold transition',
        disabled
          ? 'cursor-not-allowed border-surfaceGlass/10 bg-bgPrimary/20 text-textSecondary/70'
          : 'border-accentPrimary/35 bg-accentPrimary/12 text-textPrimary hover:border-accentPrimary/55',
      ].join(' ')}
      aria-disabled={disabled}
      aria-label={
        props.unreadCount > 0
          ? `Mark all ${props.unreadCount} unread notifications as read`
          : 'No unread notifications'
      }
    >
      {isSubmitting ? 'Marking…' : 'Mark all read'}
    </button>
  )
}