// app/client/me/@modal/_components/DismissModalButton.tsx
'use client'

import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'

type DismissModalButtonProps = {
  children?: ReactNode
  className?: string
  ariaLabel: string
  fallbackHref?: string
}

export default function DismissModalButton({
  children,
  className,
  ariaLabel,
  fallbackHref = '/client/me',
}: DismissModalButtonProps) {
  const router = useRouter()

  function handleClose() {
    if (window.history.length > 1) {
      router.back()
      return
    }

    router.push(fallbackHref)
  }

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={handleClose}
      className={className}
    >
      {children}
    </button>
  )
}