// app/client/components/ProProfileLink.tsx
import React from 'react'

type Props = {
  proId?: string | null
  label: string
  className?: string
  title?: string
}

/**
 * Single source of truth for linking to a pro's public profile from client UI.
 * If proId is missing, we render plain text (no broken links).
 */
export default function ProProfileLink({ proId, label, className, title }: Props) {
  const cleanId = typeof proId === 'string' && proId.trim() ? proId.trim() : null
  const text = label?.trim() ? label.trim() : 'Professional'

  if (!cleanId) {
    return <span className={className} title={title}>{text}</span>
  }

  const href = `/professionals/${encodeURIComponent(cleanId)}`

  return (
    <a
      href={href}
      className={[
        className || '',
        'hover:underline underline-offset-4',
      ].join(' ').trim()}
      title={title || `View ${text}'s profile`}
      style={{ textDecorationThickness: 2 }}
    >
      {text}
    </a>
  )
}
