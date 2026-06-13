// app/pro/bookings/[id]/session/PendingActionButton.tsx
'use client'

import type { ReactNode } from 'react'
import { useFormStatus } from 'react-dom'

type ButtonVariant = 'primary' | 'ghost' | 'danger'

function Spinner() {
  return (
    <svg
      aria-hidden="true"
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      className="brand-pro-session-spinner"
    >
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  )
}

function TransitionBanner({ label }: { label: string }) {
  const { pending } = useFormStatus()
  if (!pending) return null

  return (
    <div className="brand-pro-session-transition-banner" role="status">
      <Spinner />
      {label}
    </div>
  )
}

export default function PendingActionButton({
  children,
  variant = 'primary',
  full = true,
  disabled = false,
  grow,
  pendingLabel,
  transitionLabel,
}: {
  children: ReactNode
  variant?: ButtonVariant
  full?: boolean
  disabled?: boolean
  grow?: 1 | 2
  pendingLabel?: string
  transitionLabel?: string
}) {
  const { pending } = useFormStatus()

  const isDisabled = disabled || pending

  return (
    <>
      {transitionLabel ? (
        <TransitionBanner label={transitionLabel} />
      ) : null}

      <button
        type="submit"
        className="brand-pro-session-button brand-focus"
        data-variant={variant}
        data-full={full}
        data-grow={grow}
        data-pending={pending || undefined}
        disabled={isDisabled}
        aria-disabled={isDisabled}
      >
        {pending ? (
          <>
            <Spinner />
            {pendingLabel ?? children}
          </>
        ) : (
          children
        )}
      </button>
    </>
  )
}
